"use client";

/**
 * ShareReceiverClient — drains the IDB share inbox on mount and runs
 * the SAME bulk-import pipeline LabHome uses (parse → organize →
 * persist), then redirects home so the user sees their new study in
 * RecentImports.
 *
 * Why a separate page instead of inlining in LabHome?
 *
 *   The PWA Share Target spec POSTs to a URL the service worker
 *   intercepts. After stashing the files in IDB, the SW redirects to
 *   a SEPARATE page so the user gets a clear progress UI ("รับไฟล์...")
 *   instead of LabHome's home screen briefly flashing before the
 *   import starts. The dedicated page also gives us a clean place to
 *   render the iOS-unsupported / no-files / error states without
 *   polluting LabHome.
 *
 * Pipeline (mirrors LabHome.runBulkImport):
 *   1. Read `?ts=` query → drainShareInbox(id) → File[]
 *   2. ingestFileList (magic-byte filter + zip unpack)
 *   3. parseDicomBatch (header tag extraction)
 *   4. organizeIntoStudies
 *   5. saveBatch (IDB persist)
 *   6. dispatchEvent('cuvi:imports-changed') so RecentImports rehydrates
 *   7. router.replace('/') so back-button doesn't return to this page
 *
 * Error handling: each phase has an isolated try/catch so a parse
 * failure on a single corrupt file doesn't drop us to a blank screen.
 * The whole-flow error surfaces under the progress bar with a "ลองอีก
 * ครั้ง" link back to the home dropzone.
 *
 * iOS Safari note: Safari does not implement the share_target manifest
 * field as of 2026-05. If a user lands here via deep link (no inbox
 * row), we explain the limitation and route them to the home dropzone.
 */

import { useEffect, useState, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  drainShareInbox,
  entryToFiles,
  type InboxEntry,
} from "@/lib/dicom/share-inbox";
import {
  ingestFileList,
  MAX_BATCH_FILES,
  type BulkIngestProgress,
} from "@/lib/dicom/bulk-import";
import { parseDicomBatch } from "@/lib/dicom/parse-pool";
import { organizeIntoStudies } from "@/lib/dicom/study-organizer";
import { saveBatch } from "@/lib/dicom/dicom-store";

type Phase =
  | "reading_inbox"
  | "discovering"
  | "parsing"
  | "organizing"
  | "persisting"
  | "done"
  | "empty"
  | "error";

interface UiState {
  phase: Phase;
  filesFound: number;
  filesTotal: number;
  currentSource: string;
  errorMessage?: string;
  // For the 'done' summary card
  studyCount?: number;
  imageCount?: number;
  // Inbox metadata that might be useful to surface
  shareTitle?: string;
}

export default function ShareReceiverClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Use a ref to ensure StrictMode double-invoke / fast refresh doesn't
  // double-import. Once we've started a real run, future mounts no-op.
  const startedRef = useRef(false);

  // Parse query params synchronously so we can seed initial state with
  // the error branch (avoids a setState-in-effect cascading render).
  const errorParam = searchParams.get("error");
  const tsParam = searchParams.get("ts");

  const [ui, setUi] = useState<UiState>(() => {
    if (errorParam) {
      return {
        phase: "error",
        filesFound: 0,
        filesTotal: 0,
        currentSource: "",
        errorMessage:
          errorParam === "stash_failed"
            ? "Service worker เก็บไฟล์ไม่สำเร็จ — ลอง share ใหม่อีกครั้ง"
            : "เกิดข้อผิดพลาดในการรับไฟล์",
      };
    }
    return {
      phase: "reading_inbox",
      filesFound: 0,
      filesTotal: 0,
      currentSource: "",
    };
  });

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    // Error branch already seeded into initial state; nothing to do.
    if (errorParam) return;

    let cancelled = false;
    const abort = new AbortController();

    const ts = tsParam ? Number(tsParam) : null;

    void (async () => {
      // 1. Drain inbox
      let entry: InboxEntry | null = null;
      try {
        entry = await drainShareInbox(Number.isFinite(ts) ? ts : null);
      } catch (err) {
        if (cancelled) return;
        setUi({
          phase: "error",
          filesFound: 0,
          filesTotal: 0,
          currentSource: "",
          errorMessage: `อ่าน inbox ไม่สำเร็จ: ${
            (err as Error)?.message ?? "unknown"
          }`,
        });
        return;
      }

      if (!entry || entry.files.length === 0) {
        if (cancelled) return;
        setUi({
          phase: "empty",
          filesFound: 0,
          filesTotal: 0,
          currentSource: "",
        });
        return;
      }

      const files = entryToFiles(entry);
      const shareTitle =
        entry.title && entry.title.length > 0 ? entry.title : undefined;

      // Wrap File[] back into a FileList-like for ingestFileList. The
      // function only iterates + reads `.name` / `.size` / bytes, so a
      // synthetic object with `length` + numeric indexing is enough.
      const filelist = filesAsFileList(files);

      // 2. Discover (magic byte filter / zip unpack)
      setUi({
        phase: "discovering",
        filesFound: 0,
        filesTotal: files.length,
        currentSource: shareTitle ?? "",
        shareTitle,
      });

      let discovered: File[] = [];
      try {
        discovered = await ingestFileList(filelist, {
          signal: abort.signal,
          onProgress: (status: BulkIngestProgress) => {
            if (cancelled) return;
            setUi((prev) => ({
              ...prev,
              phase: status.phase === "unzipping" ? "discovering" : "discovering",
              filesFound: status.filesFound,
              filesTotal: status.filesTotal || files.length,
              currentSource: status.currentSource,
            }));
          },
        });
      } catch (err) {
        if (cancelled) return;
        setUi({
          phase: "error",
          filesFound: 0,
          filesTotal: 0,
          currentSource: "",
          errorMessage: `Discover failed: ${
            (err as Error)?.message ?? "unknown"
          }`,
          shareTitle,
        });
        return;
      }

      if (discovered.length === 0) {
        if (cancelled) return;
        setUi({
          phase: "error",
          filesFound: 0,
          filesTotal: files.length,
          currentSource: "",
          errorMessage:
            "ไฟล์ที่ share มาไม่ใช่ DICOM — ตรวจ magic byte (offset 128) แล้วไม่เจอ DICM. รองรับ .dcm / .dicom / .zip ที่บรรจุไฟล์ DICOM",
          shareTitle,
        });
        return;
      }

      // Cap to MAX_BATCH_FILES (5000) to match LabHome's guardrail.
      const batch =
        discovered.length > MAX_BATCH_FILES
          ? discovered.slice(0, MAX_BATCH_FILES)
          : discovered;

      // 3. Parse headers
      setUi({
        phase: "parsing",
        filesFound: 0,
        filesTotal: batch.length,
        currentSource: "",
        shareTitle,
      });

      let metas: Awaited<ReturnType<typeof parseDicomBatch>> = [];
      try {
        metas = await parseDicomBatch(batch, {
          signal: abort.signal,
          onProgress: (done, total, latest) => {
            if (cancelled) return;
            setUi((prev) => ({
              ...prev,
              phase: "parsing",
              filesFound: done,
              filesTotal: total,
              currentSource: latest?.fileHandle?.name ?? "",
            }));
          },
        });
      } catch (err) {
        if (cancelled) return;
        setUi({
          phase: "error",
          filesFound: 0,
          filesTotal: batch.length,
          currentSource: "",
          errorMessage: `Parse failed: ${
            (err as Error)?.message ?? "unknown"
          }`,
          shareTitle,
        });
        return;
      }

      if (metas.length === 0) {
        if (cancelled) return;
        setUi({
          phase: "error",
          filesFound: 0,
          filesTotal: batch.length,
          currentSource: "",
          errorMessage: `อ่าน DICOM header ไม่สำเร็จ 0/${batch.length} — ไฟล์อาจ corrupt หรือเป็น non-Part-10 DICOM`,
          shareTitle,
        });
        return;
      }

      // 4. Organize
      setUi({
        phase: "organizing",
        filesFound: metas.length,
        filesTotal: metas.length,
        currentSource: "",
        shareTitle,
      });
      const studies = organizeIntoStudies(metas);

      // 5. Persist
      setUi({
        phase: "persisting",
        filesFound: metas.length,
        filesTotal: metas.length,
        currentSource: `${studies.length} stud${
          studies.length === 1 ? "y" : "ies"
        }`,
        shareTitle,
      });

      try {
        await saveBatch(metas);
      } catch (err) {
        // Persist failure: don't drop into a hard error — the user
        // can still browse files in this session by going home and
        // re-dropping. But we should signal the issue.
        if (cancelled) return;
        setUi({
          phase: "error",
          filesFound: metas.length,
          filesTotal: metas.length,
          currentSource: "",
          errorMessage: `บันทึก offline ไม่สำเร็จ: ${
            (err as Error)?.message ?? "unknown"
          } — ลองล้าง IndexedDB หรือใช้ browser อื่น`,
          shareTitle,
        });
        return;
      }

      // 6. Fire the rehydrate signal so RecentImports on the home
      //    page picks up the new studies the moment we land there.
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("cuvi:imports-changed"));
      }

      if (cancelled) return;
      setUi({
        phase: "done",
        filesFound: metas.length,
        filesTotal: metas.length,
        currentSource: "",
        studyCount: studies.length,
        imageCount: metas.length,
        shareTitle,
      });

      // 7. Auto-redirect home after a short victory beat so the user
      //    sees the success summary, then lands on RecentImports with
      //    their new study at the top of the list. `router.replace`
      //    (not push) means back-button skips this transient page.
      window.setTimeout(() => {
        if (!cancelled) router.replace("/");
      }, 1500);
    })();

    return () => {
      cancelled = true;
      try {
        abort.abort();
      } catch {
        /* noop */
      }
    };
    // searchParams + router are stable refs from next/navigation hooks;
    // we don't want them in deps because we only run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:py-16">
      <header className="mb-8">
        <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-faint)]">
          PWA Share Target
        </p>
        <h1 className="mt-2 text-2xl sm:text-3xl font-semibold text-[var(--color-text)]">
          รับไฟล์ DICOM
        </h1>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          ไฟล์ที่ share มาจะถูก import เข้า Imaging Lab โดยอัตโนมัติ ไม่ส่ง
          ออกจากเครื่องคุณ
        </p>
      </header>

      <PhasePanel ui={ui} />

      <FooterActions ui={ui} />
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────

function PhasePanel({ ui }: { ui: UiState }) {
  if (ui.phase === "empty") return <EmptyState />;
  if (ui.phase === "error") return <ErrorState ui={ui} />;
  if (ui.phase === "done") return <DoneState ui={ui} />;
  return <ProgressState ui={ui} />;
}

function ProgressState({ ui }: { ui: UiState }) {
  const label = phaseLabel(ui.phase);
  const pct =
    ui.filesTotal > 0
      ? Math.min(100, Math.round((ui.filesFound / ui.filesTotal) * 100))
      : 0;

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-xl border border-[var(--color-border)] bg-black/30 p-5 sm:p-6"
    >
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-[var(--color-text)]">{label}</span>
        {ui.filesTotal > 0 ? (
          <span className="tabular-nums text-[var(--color-text-muted)]">
            {ui.filesFound} / {ui.filesTotal}
          </span>
        ) : null}
      </div>

      {/* Real progress bar — driven by parse-pool callbacks, not faked. */}
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
        <div
          className="h-full rounded-full bg-[var(--color-tool-cyan)] transition-[width] duration-200"
          style={{ width: `${pct}%` }}
          aria-hidden
        />
      </div>

      {ui.shareTitle ? (
        <p className="mt-4 text-xs text-[var(--color-text-faint)]">
          จาก share intent:{" "}
          <span className="text-[var(--color-text-muted)]">
            {ui.shareTitle}
          </span>
        </p>
      ) : null}

      {ui.currentSource ? (
        <p className="mt-2 truncate text-xs text-[var(--color-text-faint)]">
          {ui.currentSource}
        </p>
      ) : null}
    </div>
  );
}

function DoneState({ ui }: { ui: UiState }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-xl border border-[var(--color-border-tool)] bg-[var(--color-tool-cyan)]/5 p-5 sm:p-6"
    >
      <p className="text-sm font-medium text-[var(--color-tool-cyan)]">
        Import สำเร็จ
      </p>
      <p className="mt-2 text-sm text-[var(--color-text)]">
        {ui.studyCount ?? 0}{" "}
        {ui.studyCount === 1 ? "study" : "studies"} ·{" "}
        {ui.imageCount ?? 0} images
      </p>
      <p className="mt-3 text-xs text-[var(--color-text-muted)]">
        กำลังพาไปหน้า Recent Imports...
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-xl border border-[var(--color-border)] bg-black/30 p-5 sm:p-6"
    >
      <p className="text-sm font-medium text-[var(--color-text)]">
        ยังไม่มีไฟล์ใน inbox
      </p>
      <p className="mt-2 text-sm text-[var(--color-text-muted)]">
        หน้านี้รับไฟล์ DICOM ที่ share มาจาก app อื่น (เช่น file manager,
        PACS browser, email attachment) บน Android Chrome / Edge
      </p>
      <div className="mt-4 rounded-md border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200/80">
        <p className="font-medium">iOS Safari ไม่รองรับ</p>
        <p className="mt-1 text-amber-200/60">
          Apple ยังไม่ implement PWA Share Target API (ตรวจครั้งล่าสุด
          2026-05) — ผู้ใช้ iPhone ต้อง drag &amp; drop ไฟล์ที่หน้าหลัก
          โดยตรง
        </p>
      </div>
    </div>
  );
}

function ErrorState({ ui }: { ui: UiState }) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-red-500/30 bg-red-500/5 p-5 sm:p-6"
    >
      <p className="text-sm font-medium text-red-300">Import ไม่สำเร็จ</p>
      <p className="mt-2 text-sm text-[var(--color-text-muted)]">
        {ui.errorMessage ?? "เกิดข้อผิดพลาดที่ไม่รู้สาเหตุ"}
      </p>
    </div>
  );
}

function FooterActions({ ui }: { ui: UiState }) {
  if (ui.phase === "done") return null;
  return (
    <div className="mt-6 flex flex-wrap items-center gap-3 text-sm">
      <Link
        href="/"
        className="rounded-md border border-[var(--color-border-bright)] px-3 py-1.5 text-[var(--color-text)] transition-colors hover:border-[var(--color-tool-cyan)] hover:text-[var(--color-tool-cyan)]"
      >
        ไปหน้าหลัก
      </Link>
      <Link
        href="/about"
        className="px-1 py-1.5 text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-tool-cyan)]"
      >
        เกี่ยวกับ PWA Share Target
      </Link>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function phaseLabel(phase: Phase): string {
  switch (phase) {
    case "reading_inbox":
      return "อ่าน inbox...";
    case "discovering":
      return "ค้นหาไฟล์ DICOM (magic byte)...";
    case "parsing":
      return "อ่าน DICOM header...";
    case "organizing":
      return "จัดกลุ่มเป็น Study / Series...";
    case "persisting":
      return "บันทึก offline...";
    default:
      return "...";
  }
}

/**
 * Convert File[] into a FileList-like object that ingestFileList()
 * accepts. We use `Object.defineProperty` for indexed access because
 * a plain object with numeric keys works for the iteration patterns
 * inside ingestFileList (which only uses `.length` + `Array.from`).
 */
function filesAsFileList(files: File[]): FileList {
  // The simplest reliable path: DataTransfer can build a synthetic
  // FileList in modern browsers (Chrome 73+, Edge, Firefox 62+).
  if (typeof DataTransfer !== "undefined") {
    try {
      const dt = new DataTransfer();
      for (const f of files) dt.items.add(f);
      return dt.files;
    } catch {
      /* fall through to manual shim */
    }
  }
  // Manual shim — matches the surface ingestFileList actually uses.
  const arr = files.slice();
  const shim = {
    get length() {
      return arr.length;
    },
    item(i: number) {
      return arr[i] ?? null;
    },
    [Symbol.iterator]() {
      return arr[Symbol.iterator]();
    },
  } as unknown as FileList;
  for (let i = 0; i < arr.length; i++) {
    Object.defineProperty(shim, i, {
      value: arr[i],
      enumerable: true,
      configurable: true,
    });
  }
  return shim;
}
