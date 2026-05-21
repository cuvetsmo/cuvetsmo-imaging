'use client';
import { useState, useCallback, useEffect, useRef, Suspense, lazy } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useMediaQuery } from '../../lib/dicom/use-media-query.js';
import { CrosshairPattern } from '../CrosshairPattern';
import OnboardingTour, { HelpButton, useOnboardingTour } from './OnboardingTour.jsx';
import BulkDropzone from './BulkDropzone.jsx';
import BulkProgressPanel from './BulkProgressPanel.jsx';
import {
  ingestDropPayload,
  ingestFileList,
  MAX_BATCH_FILES,
  MAX_SIDE_BY_SIDE,
} from '../../lib/dicom/bulk-import.ts';
// Agent 🅱 — worker pool that parses DICOM headers in parallel.
import { parseDicomBatch } from '../../lib/dicom/parse-pool.ts';
// Agent 🅲 — pure Study/Series grouping over a flat DicomFileMeta[].
import { organizeIntoStudies } from '../../lib/dicom/study-organizer.ts';
// Agent 🅳 — IndexedDB-backed persistence + custom-event refresh signal.
import { saveBatch } from '../../lib/dicom/dicom-store.ts';

const DicomViewport = lazy(() => import('./DicomViewport.jsx'));
const TagInspector = lazy(() => import('./TagInspector.jsx'));

// Sister-agent component — the persistent studies panel below the
// dropzone. Lazy-loaded so its dicom-store + IndexedDB code stays out
// of the initial chunk. RecentImports itself lazy-loads StudyTree
// (Agent 🅲) internally, so this is the single mount point for the
// Study/Series tree on the home page. Avoids the double-mount that
// having both a "session-only" StudyTree and a "persisted" one in
// RecentImports would create.
const RecentImports = lazy(() =>
  import('./RecentImports.jsx').catch(() => ({ default: () => null }))
);

const RECENT_KEY = 'cuvi-recent-files';
const RECENT_MAX = 5;
// The legacy 2-file cap only applies to the side-by-side VIEWER pane
// grid, not to the import pipeline. Import path uses MAX_BATCH_FILES.
const MAX_FILES = MAX_SIDE_BY_SIDE;

// Peek at a DataTransferItemList to see if any item is a directory.
// Used to decide whether the "skipped non-DICOM" tally is meaningful —
// for folder drops the input count is 1 item but the discovered count
// is N files, so the subtraction would give a nonsense negative number.
function hasAnyDirectoryEntry(items) {
  if (!items) return false;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind !== 'file') continue;
    const entry = it.webkitGetAsEntry?.();
    if (entry?.isDirectory) return true;
  }
  return false;
}

export default function LabHome() {
  const isMobile = useMediaQuery('(max-width: 600px)');
  // Side-by-side viewer state — unchanged. Capped at MAX_FILES (=2)
  // because the grid layout only renders two panes.
  const [files, setFiles] = useState([]);
  const [error, setError] = useState(null);
  const [recent, setRecent] = useState([]);

  // Phase-4 bulk import state. `bulkProgress` is non-null only while
  // an import is in flight; the BulkProgressPanel renders off this
  // value. Persisted studies render in <RecentImports>, which hydrates
  // from IndexedDB after each `saveBatch` (via the
  // `cuvi:imports-changed` event). We don't keep a separate
  // session-only StudyTree state — the persisted view IS the session
  // view (avoids the double-StudyTree-mount that Agent 🅰 and 🅳
  // would otherwise both produce).
  const [bulkProgress, setBulkProgress] = useState(null);
  const abortRef = useRef(null);

  // 3-step onboarding tour (replaces the old "ยินดีต้อนรับ" welcome card).
  // Auto-launches on first visit (key `cuvi-tour-completed-v1`), manually
  // re-triggerable via the HelpButton in the bottom-right.
  const { open: tourOpen, openTour, closeTour } = useOnboardingTour();

  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      if (raw) setRecent(JSON.parse(raw));
    } catch { /* corrupt JSON; ignore */ }
  }, []);

  const addToRecent = useCallback((f) => {
    if (!f) return;
    const entry = { name: f.name, size: f.size, lastModified: f.lastModified || Date.now() };
    setRecent((prev) => {
      const next = [entry, ...prev.filter((p) => !(p.name === entry.name && p.size === entry.size))].slice(0, RECENT_MAX);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* quota */ }
      return next;
    });
  }, []);

  /**
   * Bulk-import pipeline — single entry point for any drop / pick /
   * folder-pick. Pulls DICOM-only Files from the payload (folder
   * traversal, ZIP unpack, magic-byte filter) and hands them off:
   *   - 1-2 files → also feed the side-by-side viewer state (legacy)
   *   - 3+ files → bulk-only flow, StudyTree below the dropzone
   *
   * The actual parse (DICOM tag extraction) is Agent B's worker pool;
   * the StudyTree (Agent C) and RecentImports (Agent D) read from
   * `importedFiles` once parse completes. While this Promise is in
   * flight, BulkProgressPanel is visible and ESC cancels via the
   * AbortController.
   */
  const runBulkImport = useCallback(
    async (kind, payload) => {
      // Abort any prior in-flight import (re-dropping mid-parse)
      if (abortRef.current) {
        try { abortRef.current.abort(); } catch { /* noop */ }
      }
      const controller = new AbortController();
      abortRef.current = controller;
      const signal = controller.signal;

      setError(null);
      setBulkProgress({
        phase: 'discovering',
        filesFound: 0,
        filesTotal: 0,
        currentSource: '',
      });

      let discovered = [];
      try {
        if (kind === 'drop') {
          discovered = await ingestDropPayload(payload, {
            signal,
            onProgress: (status) => setBulkProgress(status),
          });
        } else {
          // 'pick' (file input) or 'folder' (webkitdirectory input)
          discovered = await ingestFileList(payload, {
            signal,
            onProgress: (status) => setBulkProgress(status),
          });
        }
      } catch (err) {
        if (!signal.aborted) {
          setError(`Import failed: ${err?.message || 'unknown error'}`);
        }
        setBulkProgress(null);
        abortRef.current = null;
        return;
      }

      if (signal.aborted) {
        setBulkProgress(null);
        abortRef.current = null;
        return;
      }

      if (discovered.length === 0) {
        setError('ไม่พบไฟล์ DICOM ในรายการที่ลากมา (ตรวจ magic byte แล้วไม่ผ่าน)');
        setBulkProgress(null);
        abortRef.current = null;
        return;
      }

      // Cap at MAX_BATCH_FILES to prevent runaway ingest
      let batch = discovered;
      let skippedHardCap = 0;
      if (batch.length > MAX_BATCH_FILES) {
        skippedHardCap = batch.length - MAX_BATCH_FILES;
        batch = batch.slice(0, MAX_BATCH_FILES);
      }

      // Update recent-files history. We only record the first few names
      // (not all 5000 of a PACS dump) — recent is a UI hint, not a
      // replay store.
      for (const f of batch.slice(0, RECENT_MAX)) addToRecent(f);

      // For tiny batches (1-2 files), also seed the legacy side-by-side
      // viewer so single-file users get the familiar "drop → view"
      // experience. Larger batches stay on the home page with the
      // RecentImports panel as the navigator. Done BEFORE parse so
      // the viewer can start rendering Cornerstone while the worker
      // pool churns through the headers in the background.
      if (batch.length <= MAX_FILES) {
        setFiles(batch);
      }

      // ── Phase 4 pipeline: parse → organize → persist → broadcast ──
      //
      // We DO NOT block the discovered-but-not-yet-parsed batch from
      // viewer-mode entry above. The viewer reads the File directly via
      // Cornerstone, independent of the worker pool's header metadata.
      // The pool feeds the StudyTree / RecentImports panels which need
      // grouped Study[] data, not raw bytes.
      setBulkProgress({
        phase: 'parsing',
        filesFound: 0,
        filesTotal: batch.length,
        currentSource: '',
      });

      let metas = [];
      try {
        metas = await parseDicomBatch(batch, {
          signal,
          onProgress: (done, total, latest) => {
            setBulkProgress({
              phase: 'parsing',
              filesFound: done,
              filesTotal: total,
              currentSource: latest?.fileHandle?.name || '',
            });
          },
        });
      } catch (err) {
        if (!signal.aborted) {
          setError(`Parse failed: ${err?.message || 'unknown error'}`);
        }
        setBulkProgress(null);
        abortRef.current = null;
        return;
      }

      if (signal.aborted) {
        setBulkProgress(null);
        abortRef.current = null;
        return;
      }

      // If every file failed to parse (e.g. all corrupt / not real
      // DICOM despite the magic byte) we still want the UI to recover
      // cleanly. Show the count mismatch as a message rather than
      // dropping the user back to an empty home screen with no clue.
      if (metas.length === 0) {
        setError(`Parse: 0 / ${batch.length} ไฟล์อ่าน DICOM header สำเร็จ — ลองตรวจไฟล์ต้นทาง`);
        setBulkProgress(null);
        abortRef.current = null;
        return;
      }

      // Group flat DicomFileMeta[] → Study → Series tree (Agent 🅲).
      setBulkProgress({
        phase: 'organizing',
        filesFound: metas.length,
        filesTotal: metas.length,
        currentSource: '',
      });
      const studies = organizeIntoStudies(metas);

      // Persist to IndexedDB (Agent 🅳). The store dedupes by
      // sopInstanceUid so re-dropping the same files is idempotent.
      try {
        await saveBatch(metas);
        // Notify RecentImports (sibling) so it rehydrates from IDB.
        // Listener registered in RecentImports.useEffect's onChange.
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('cuvi:imports-changed'));
        }
      } catch (err) {
        // Don't fail the whole import if persistence fails — the user
        // can still view the files in this session. Just warn.
        console.warn('[LabHome] saveBatch failed', err);
        setError(
          `บันทึก offline ไม่สำเร็จ: ${err?.message || 'unknown'} (ภาพยังเปิดดูใน session นี้ได้)`
        );
      }

      // Build any user-facing skip message. We only count "non-DICOM
      // skipped" for the FLAT branches (file-input pick or loose-file
      // drop) — folder traversal and ZIP unpack already swallow non-
      // DICOM entries silently, and the input-count there is wildly
      // different from the discovered count (1 folder = 200 files).
      const parts = [];
      const isFlatBranch =
        kind === 'pick' ||
        (kind === 'drop' &&
          payload &&
          (!payload.items || !hasAnyDirectoryEntry(payload.items)) &&
          !Array.from(payload?.files || []).some((f) => /\.zip$/i.test(f.name)));
      if (isFlatBranch) {
        const inputCount =
          kind === 'drop' ? payload?.files?.length || 0 : payload?.length || 0;
        const skippedNonDicom = Math.max(0, inputCount - discovered.length);
        if (skippedNonDicom > 0) parts.push(`ข้าม non-DICOM ${skippedNonDicom} ไฟล์`);
      }
      const parseFailed = batch.length - metas.length;
      if (parseFailed > 0) parts.push(`อ่าน header ไม่สำเร็จ ${parseFailed} ไฟล์`);
      if (skippedHardCap > 0)
        parts.push(`เกิน batch cap ${MAX_BATCH_FILES} (ตัดทิ้ง ${skippedHardCap})`);
      if (parts.length > 0) setError(parts.join(' · '));

      setBulkProgress({
        phase: 'done',
        filesFound: metas.length,
        filesTotal: metas.length,
        currentSource:
          studies.length === 1
            ? `${studies.length} study · ${metas.length} images`
            : `${studies.length} studies · ${metas.length} images`,
      });

      // Auto-dismiss the progress panel after a short pause so the
      // user can see the final "done" count.
      setTimeout(() => {
        setBulkProgress((p) => (p && p.phase === 'done' ? null : p));
      }, 1100);

      abortRef.current = null;
    },
    [addToRecent]
  );

  const cancelImport = useCallback(() => {
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch { /* noop */ }
    }
    setBulkProgress(null);
    abortRef.current = null;
  }, []);

  const handleDrop = useCallback(
    (dataTransfer) => {
      runBulkImport('drop', dataTransfer);
    },
    [runBulkImport]
  );

  const handlePick = useCallback(
    (fileList) => {
      runBulkImport('pick', fileList);
    },
    [runBulkImport]
  );

  const handlePickFolder = useCallback(
    (fileList) => {
      runBulkImport('folder', fileList);
    },
    [runBulkImport]
  );

  const clearRecent = useCallback(() => {
    setRecent([]);
    try { localStorage.removeItem(RECENT_KEY); } catch { /* noop */ }
  }, []);

  const removeRecentAt = useCallback((idx) => {
    setRecent((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      try {
        if (next.length === 0) localStorage.removeItem(RECENT_KEY);
        else localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch { /* noop */ }
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setFiles([]);
    setError(null);
  }, []);

  const removeFileAt = useCallback((idx) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const firstFile = files[0];

  // ── VIEWER MODE ──
  if (files.length > 0) {
    return (
      <div className="mx-auto max-w-7xl px-3 sm:px-5 py-4">
        <div className="flex justify-between items-center mb-3 gap-2 flex-wrap">
          <div className="text-sm text-[var(--color-text-muted)] font-mono">
            {files.length === 1
              ? `${firstFile.name} — ${(firstFile.size / 1024).toFixed(0)} KB`
              : `Study (${files.length} views): ${files.map(f => f.name).join(' + ')}`}
          </div>
          <button onClick={reset} className="vmx-btn vmx-btn-ghost vmx-btn-sm">← Back to drop zone</button>
        </div>

        <div style={files.length >= 2 ? studyGridStyle : undefined}>
          {files.map((f, idx) => (
            <ViewerPane
              key={`${f.name}-${f.size}-${f.lastModified || 0}`}
              file={f}
              index={idx}
              canRemove={files.length > 1}
              onRemove={() => removeFileAt(idx)}
            />
          ))}
        </div>
      </div>
    );
  }

  // ── HOME / WORKSPACE ──
  //
  // 2026-05-20 hero redesign. The previous "the page IS the tool" layout
  // (compact title + giant empty dropzone + 2 mode cards) tested poorly:
  // the dropzone read as a placeholder rather than a product, the 4 pills
  // (DICOM/Norberg/VHS/Occlusion) looked like clickable CTAs but weren't,
  // and visitors had no preview of what the viewer actually does.
  //
  // New flow follows the OHIF.org landing pattern (see
  // sessions/2026-05-20 imaging redesign): three-noun hero + a stylised
  // preview of the viewer running a Norberg case on the right, with two
  // explicit CTAs (Sample case as primary, your-own-file as secondary
  // that scrolls down to the existing dropzone). The dropzone itself
  // moves below the hero where it makes sense as a follow-up action
  // rather than the headline.
  return (
    <>
    <div className="relative imaging-hero-bg">
      {/* Faint DICOM crosshair grid wash behind everything — kept as clinical signature on top of the new mesh gradient */}
      <CrosshairPattern className="z-0" opacity={0.028} />

      <div className="relative z-10 mx-auto max-w-6xl px-4 sm:px-6 pt-12 sm:pt-20 pb-10">
        {/* ──── HERO ──── */}
        <section className="grid grid-cols-1 lg:grid-cols-[1.05fr_1fr] gap-10 lg:gap-14 items-center mb-16 sm:mb-20">
          {/* Left: copy + CTAs */}
          <div>
            <p className="imaging-eyebrow mb-5">
              CUVETSMO Imaging Lab · for Y4–Y6 reading clinics
            </p>
            <h1 className="imaging-display text-[2.5rem] sm:text-5xl lg:text-[3.75rem] text-[var(--color-text)] mb-6">
              Radiographs,<br />
              <span
                style={{
                  background: 'linear-gradient(96deg, #5ACCE6 0%, #A78BFA 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >un-blackboxed.</span>
            </h1>
            <p className="text-[15px] sm:text-base text-[var(--color-text-muted)] leading-relaxed mb-8 max-w-[28rem]">
              เปิดภาพ DICOM ของหมา-แมวใน browser · Norberg + VHS วาดเอง วัดเอง · ไม่ขึ้น server, ไม่ต้อง login.
              <br />
              <span className="text-[var(--color-text-faint)]">A diagnostic-reading tool designed for learners, not for hospital dashboards.</span>
            </p>

            <div className="flex flex-wrap gap-3">
              <Link href="/cases" data-tour="sample-case-cta" className="imaging-btn imaging-btn-primary">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                เปิด sample case
              </Link>
              <a
                href="#dropzone"
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById('dropzone')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                className="imaging-btn imaging-btn-ghost"
              >
                หรือลากไฟล์ DICOM
                <span aria-hidden style={{ display: 'inline-block', transform: 'translateY(1px)' }}>↓</span>
              </a>
            </div>

            {/* Capability strip — animated breathing dots */}
            <ul className="mt-8 flex flex-wrap gap-x-5 gap-y-2.5 text-[12px] text-[var(--color-text-muted)] font-mono">
              <li className="flex items-center gap-2"><span aria-hidden className="imaging-cap-dot" /> Norberg angle</li>
              <li className="flex items-center gap-2"><span aria-hidden className="imaging-cap-dot" /> VHS · vertebral heart score</li>
              <li className="flex items-center gap-2"><span aria-hidden className="imaging-cap-dot" /> Image occlusion editor</li>
              <li className="flex items-center gap-2"><span aria-hidden className="imaging-cap-dot finalized" /> ไม่ขึ้น server</li>
            </ul>
          </div>

          {/* Right: stylised viewer preview · static SVG, not a live viewer.
              Mimics the chrome of the real DicomViewport (toolbar, viewport
              frame, measurement readout) with a canine pelvis sketch + Norberg
              angle overlay drawn in. Labelled as "Sample · Illustrative" so
              we never imply this is a real diagnostic radiograph. */}
          <ViewerPreview />
        </section>

        {/* ──── DROPZONE ────
            Phase 4 swap: the inline <label> is replaced by <BulkDropzone />.
            The new component accepts loose files, folders (webkitdirectory),
            and ZIP archives, with no hard cap on file count (capped by
            MAX_BATCH_FILES = 5000 in lib/dicom/bulk-import.ts, applied in
            runBulkImport above). Side-by-side viewer pane still caps at
            MAX_FILES=2 inside the viewer branch above. */}
        <section id="dropzone" className="mb-12 scroll-mt-20">
          <div className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
            <h2 className="text-[13px] font-mono uppercase tracking-[0.18em] text-[var(--color-text)] flex items-center gap-2">
              <span className="text-[var(--color-tool-violet)]">02 /</span> Free Mode — ลาก DICOM, โฟลเดอร์, หรือ ZIP
            </h2>
            <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-[var(--color-text-faint)]">
              Educational tool · not for clinical decisions
            </span>
          </div>

          <BulkDropzone
            onDrop={handleDrop}
            onPick={handlePick}
            onPickFolder={handlePickFolder}
            busy={!!bulkProgress && bulkProgress.phase !== 'done'}
          />

          {error && (
            <p className="text-[var(--color-active-red)] text-sm text-center mt-4 font-mono">{error}</p>
          )}

          {/* RecentImports (Agent 🅳) — IndexedDB-backed history of past
              imports. Mounts <StudyTree> (Agent 🅲) internally for the
              persisted view, so this is the single Study tree on the
              home page. Since our pipeline now calls saveBatch() on
              every successful import + dispatches cuvi:imports-changed,
              the current session's imports show up here without a
              separate "session-only" tree. `key={importBatchKey}` would
              force a remount on every batch which fights its internal
              hydration state — we let the custom event drive refresh
              instead. */}
          <div className="mt-6">
            <Suspense fallback={null}>
              <RecentImports
                onOpenInstance={(meta) => {
                  // meta is a DicomFileMeta — `.fileHandle` is the
                  // reconstructed File (or live File for this session).
                  // ViewerPane reads .name + .size + .lastModified off
                  // a File, so unwrap before handing it over.
                  const f = meta?.fileHandle;
                  if (f) setFiles([f]);
                }}
                onOpenStudy={(study) => {
                  // Flatten all series → instances → fileHandle, then
                  // cap at the side-by-side viewer's 2-pane limit. For
                  // bigger studies the user uses the per-instance row.
                  const files = [];
                  for (const s of study?.series || []) {
                    for (const meta of s?.instances || []) {
                      if (meta?.fileHandle) files.push(meta.fileHandle);
                      if (files.length >= MAX_FILES) break;
                    }
                    if (files.length >= MAX_FILES) break;
                  }
                  if (files.length > 0) setFiles(files);
                }}
              />
            </Suspense>
          </div>
        </section>

        {/* ──── TOOL TILES ────
            Custom SVG illustrations for each lab feature. Each tile lifts +1px
            on hover, reveals a cyan gradient ring, and the illustration color
            shifts to brand cyan. Replaces the old generic icon+text card. */}
        <section className="mb-6">
          <h2 className="text-[13px] font-mono uppercase tracking-[0.18em] text-[var(--color-text)] mb-4 flex items-center gap-2">
            <span className="text-[var(--color-tool-violet)]">03 /</span> Other modes
          </h2>
          <div data-tour="tool-tiles" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ToolTile
              href="/cases"
              title="Case Library"
              desc="Curated CC-BY radiographs across X-ray, CT, MR, US"
              meta="16 cases, grows weekly"
              art={
                /* Real Pollinations-generated canine skeleton lateral · cropped to fit tile */
                <div className="relative w-[110px] h-[68px] rounded-md overflow-hidden bg-black ring-1 ring-[var(--color-border-bright)]">
                  <Image
                    src="/illustrations/tile-cases.jpg"
                    alt=""
                    fill
                    sizes="110px"
                    className="object-cover"
                  />
                </div>
              }
            />
            <ToolTile
              href="/occlusion"
              title="Image Occlusion"
              desc="Anki-style masks · cover-the-anatomy active recall"
              meta="works on PNG + DICOM"
              art={
                /* Real radiograph base + SVG occlusion masks overlaid · shows the tool's actual behavior */
                <div className="relative w-[110px] h-[68px] rounded-md overflow-hidden bg-black ring-1 ring-[var(--color-border-bright)]">
                  <Image
                    src="/illustrations/tile-occlusion.jpg"
                    alt=""
                    fill
                    sizes="110px"
                    className="object-cover"
                  />
                  {/* Cyan occlusion masks overlaid · shows the tool action */}
                  <svg
                    className="absolute inset-0 w-full h-full"
                    viewBox="0 0 110 68"
                    aria-hidden="true"
                  >
                    <rect x="22" y="20" width="30" height="14" rx="2" fill="#5ACCE6" opacity="0.88" />
                    <rect x="60" y="34" width="28" height="14" rx="2" fill="#5ACCE6" opacity="0.88" />
                    <circle cx="37" cy="27" r="1" fill="#000" opacity="0.4" />
                    <circle cx="74" cy="41" r="1" fill="#000" opacity="0.4" />
                  </svg>
                </div>
              }
            />
          </div>
        </section>

        {recent.length > 0 && (
          <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 text-sm">
            <div className="flex items-center justify-between mb-2">
              <strong className="text-[var(--color-text)] text-xs uppercase tracking-wider">Recent files</strong>
              <button
                onClick={clearRecent}
                className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-tool-cyan)] underline"
              >
                ล้าง
              </button>
            </div>
            <div className="text-xs text-[var(--color-text-muted)] mb-2">
              File blobs ไม่ persist ข้าม session — เห็นรายการที่นี่แล้วลากไฟล์เดิมจาก disk เพื่อ re-open
            </div>
            <ul className="divide-y divide-[var(--color-border)]">
              {recent.map((r, i) => (
                <li key={i} className="py-2 flex items-center justify-between gap-2 text-xs text-[var(--color-text-muted)]">
                  <span className="truncate flex-1 font-mono">
                    <span className="text-[var(--color-text)]">{r.name}</span>
                    {' '}— {(r.size / 1024).toFixed(0)} KB,{' '}
                    {new Date(r.lastModified).toLocaleString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })}
                  </span>
                  <button
                    onClick={() => removeRecentAt(i)}
                    aria-label="ลบไฟล์นี้จากประวัติ"
                    className="w-5 h-5 text-[var(--color-text-muted)] hover:text-[var(--color-active-red)]"
                  >×</button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Quiet footnote, replaces the old centered hero subhead */}
        <p className="mt-8 text-[11px] text-[var(--color-text-muted)] text-center">
          New here?{' '}
          <button
            type="button"
            onClick={openTour}
            className="text-[var(--color-tool-cyan)] hover:underline"
          >
            ทบทวน tour ↻
          </button>
          {' · '}
          <Link href="/about" className="text-[var(--color-tool-cyan)] hover:underline">Read what this lab does ↗</Link>
        </p>
      </div>
    </div>

    {/* 3-step onboarding tour — auto-launches on first visit, manually
        re-triggerable via the help button or the "ทบทวน tour" footer link. */}
    <OnboardingTour open={tourOpen} onClose={closeTour} />
    <HelpButton onOpen={openTour} hidden={tourOpen} />

    {/* Bulk import progress — fixed-position, shown while a folder /
        zip / multi-file batch is being discovered + parsed. ESC cancels.
        Auto-dismisses 1.1s after reaching `done`. */}
    <BulkProgressPanel progress={bulkProgress} onCancel={cancelImport} />
    </>
  );
}

/**
 * ViewerPreview — static SVG mockup of the DICOM viewer shown in the hero.
 *
 * Drawing a stylised canine pelvis with the Norberg angle overlay already
 * applied. NOT a real radiograph — labelled "Sample · Illustrative" so
 * visitors don't mistake it for a diagnostic image. We avoid using a real
 * patient X-ray here because licensing CC-BY vet radiographs takes effort
 * and the stylised version reads cleanly as "this is what the tool does".
 *
 * The chrome (toolbar row + viewport frame + measurement readout) mimics
 * the real DicomViewport so visitors recognise the workspace they'll get
 * after they click "Open sample case" / drop a file.
 */
function ViewerPreview() {
  return (
    <div
      className="relative rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-3)] shadow-xl overflow-hidden"
      role="img"
      aria-label="Preview of the DICOM viewer showing a canine pelvis with Norberg angle overlay drawn — illustrative, not a real radiograph"
    >
      {/* Toolbar row */}
      <div className="flex items-center justify-between px-3 py-2 bg-[var(--color-surface-2)] border-b border-[var(--color-border)] text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-finalized)]" aria-hidden />
          <span className="font-mono">cu-001 · canine pelvis · VD</span>
        </div>
        <div className="flex items-center gap-3 font-mono">
          <span>W/L</span>
          <span>Pan</span>
          <span className="text-[var(--color-tool-cyan)]">∠ Norberg</span>
          <span>↕ Stack</span>
        </div>
      </div>

      {/* Viewport · real radiograph image + measurement overlay drawn on top.
          The image is an AI-generated stylised canine lateral (Pollinations.ai
          Flux seed=11) showing dog body w/ ribcage + spine + pelvis visible.
          Not a true diagnostic radiograph — "Sample · Illustrative" badge
          makes this explicit. Overlay coordinates tuned to the visible pelvis
          area (lower-left) of the lateral image; easy to nudge if the source
          image is swapped later. */}
      <div className="relative aspect-[5/4] bg-[var(--color-surface-3)]">
        {/* Base radiograph image */}
        <Image
          src="/illustrations/hero-pelvis.jpg"
          alt=""
          fill
          sizes="(min-width: 1024px) 480px, 100vw"
          className="object-cover"
          priority
        />

        {/* Measurement overlay SVG — drawn on top using viewBox 500x400 so
            coordinates can be tuned by eye against the image. */}
        <svg
          viewBox="0 0 500 400"
          preserveAspectRatio="xMidYMid meet"
          className="absolute inset-0 w-full h-full pointer-events-none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          {/* Subtle dark vignette so the metadata text reads on busy areas */}
          <defs>
            <radialGradient id="overlay-vignette" cx="50%" cy="50%" r="80%">
              <stop offset="55%" stopColor="rgba(0,0,0,0)" />
              <stop offset="100%" stopColor="rgba(0,0,0,0.6)" />
            </radialGradient>
          </defs>
          <rect width="500" height="400" fill="url(#overlay-vignette)" />

          {/* Norberg overlay — femoral heads + acetabular rims positioned
              over the visible pelvis area in the lower-left of the image.
              Not anatomically rigorous (the image is lateral, Norberg needs
              VD); kept as a stylised "this is what the tool does" demo. */}
          {/* Cyan baseline · femoral head to femoral head */}
          <line x1="105" y1="245" x2="170" y2="245" stroke="#5ACCE6" strokeWidth="2" />
          {/* Angle lines · femoral head → acetabular rim */}
          <line x1="105" y1="245" x2="88" y2="220" stroke="#5ACCE6" strokeWidth="2" />
          <line x1="170" y1="245" x2="187" y2="220" stroke="#5ACCE6" strokeWidth="2" />
          {/* Acetabular rim dots */}
          <circle cx="88" cy="220" r="3.5" fill="#5ACCE6" />
          <circle cx="187" cy="220" r="3.5" fill="#5ACCE6" />
          {/* Femoral head center dots */}
          <circle cx="105" cy="245" r="3.5" fill="#5ACCE6" />
          <circle cx="170" cy="245" r="3.5" fill="#5ACCE6" />
          {/* Angle arcs */}
          <path d="M 120 233 A 14 14 0 0 0 117 244" fill="none" stroke="#5ACCE6" strokeWidth="1.5" />
          <path d="M 155 233 A 14 14 0 0 1 158 244" fill="none" stroke="#5ACCE6" strokeWidth="1.5" />

          {/* Numeric readouts — floated above the angle area, drop-shadow for contrast */}
          <g fontFamily="ui-monospace, monospace" fontWeight="600">
            <text x="35" y="208" fontSize="12" fill="#5ACCE6">L: 108°</text>
            <text x="200" y="208" fontSize="12" fill="#5ACCE6">R: 105°</text>
          </g>

          {/* Top-left DICOM metadata · monospace, kept on dark area */}
          <g fontFamily="ui-monospace, monospace" fontSize="9" fill="#D4D4D8">
            <text x="12" y="22">MRN: 12345678</text>
            <text x="12" y="36">Modality: DX</text>
            <text x="12" y="50">Acquired: 2026-05-20</text>
          </g>
          <g fontFamily="ui-monospace, monospace" fontSize="9" fill="#D4D4D8" textAnchor="end">
            <text x="488" y="22">WW: 4096</text>
            <text x="488" y="36">WL: 2048</text>
            <text x="488" y="50">Px: 0.142mm</text>
          </g>

          {/* Bottom-right scale ruler — gives visual sense of measurement */}
          <g stroke="#D4D4D8" strokeWidth="1" opacity="0.75">
            <line x1="370" y1="380" x2="470" y2="380" />
            <line x1="370" y1="376" x2="370" y2="384" />
            <line x1="395" y1="378" x2="395" y2="382" />
            <line x1="420" y1="376" x2="420" y2="384" />
            <line x1="445" y1="378" x2="445" y2="382" />
            <line x1="470" y1="376" x2="470" y2="384" />
          </g>
          <text x="420" y="395" textAnchor="middle" fontSize="9" fontFamily="ui-monospace, monospace" fill="#D4D4D8">10 mm</text>
        </svg>

        {/* Floating "Sample · Illustrative" badge — makes it explicit the image
            is AI-generated, not a real diagnostic radiograph. */}
        <div className="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded bg-[rgba(0,0,0,0.7)] backdrop-blur-sm px-2 py-1 text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] border border-[var(--color-border-bright)]">
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-tool-cyan)]" aria-hidden />
          Sample · Illustrative
        </div>
      </div>

      {/* Footer · measurement readout strip · mirrors the real viewer chrome */}
      <div className="flex items-center justify-between px-3 py-2 bg-[var(--color-surface-2)] border-t border-[var(--color-border)] text-[10px] font-mono text-[var(--color-text-muted)]">
        <span>∠ Norberg · L 108° / R 105°</span>
        <span className="text-[var(--color-tool-cyan)]">Open sample case →</span>
      </div>
    </div>
  );
}

/**
 * ToolTile — tactile feature tile with custom SVG illustration on the right.
 *
 * Hover behavior comes from the .imaging-tool-tile CSS class:
 *   - Lifts 2px
 *   - Cyan gradient ring reveals around border
 *   - art color shifts from text-muted → tool-cyan
 *   - arrow shifts 3px right + colors to cyan
 *
 * The `art` slot receives an inline SVG that uses `currentColor` so the tile
 * can control the line color via the .imaging-tile-art class.
 */
function ToolTile({ href, title, desc, meta, art }) {
  return (
    <Link href={href} className="imaging-tool-tile group">
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="font-semibold text-[var(--color-text)] tracking-tight text-[15px]">{title}</span>
          {meta && (
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-text-faint)]">
              {meta}
            </span>
          )}
        </div>
        <div className="text-[13px] text-[var(--color-text-muted)] leading-relaxed">{desc}</div>
      </div>
      <div className="imaging-tile-art self-center">
        {art}
      </div>
      <svg
        width="16" height="16" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" strokeWidth="1.75"
        strokeLinecap="round" strokeLinejoin="round"
        className="imaging-tile-arrow"
        aria-hidden="true"
      >
        <path d="M5 12h14M13 5l7 7-7 7" />
      </svg>
    </Link>
  );
}

// Single viewer pane wrapper — file label + DicomViewport + Tag panel.
function ViewerPane({ file, index, canRemove, onRemove }) {
  const [showTags, setShowTags] = useState(false);
  return (
    <div style={paneStyle}>
      <div style={paneHeaderStyle}>
        <span>
          <strong>View {index + 1}:</strong>{' '}
          <span style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>{file.name}</span>
        </span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            onClick={() => setShowTags((s) => !s)}
            className="vmx-btn vmx-btn-ghost vmx-btn-sm"
            title="ดู DICOM tags ทั้งหมด"
          >
            Info
          </button>
          {canRemove && (
            <button
              onClick={onRemove}
              aria-label="Remove this view"
              style={removePaneBtnStyle}
              title="ปิด view นี้"
            >✕</button>
          )}
        </div>
      </div>
      <Suspense fallback={<div style={loadingFallbackStyle}>กำลังโหลด viewer...</div>}>
        <DicomViewport file={file} caseId={null} syncEnabled={false} />
      </Suspense>
      {showTags && (
        <Suspense fallback={null}>
          <TagInspector file={file} onClose={() => setShowTags(false)} />
        </Suspense>
      )}
    </div>
  );
}

const studyGridStyle = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 12,
};
const paneStyle = {
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  background: 'var(--color-surface-2)',
  padding: 8,
};
const paneHeaderStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  marginBottom: 8, padding: '4px 6px', fontSize: '0.85rem', color: 'var(--color-text-muted)',
  flexWrap: 'wrap', gap: 6,
};
const removePaneBtnStyle = {
  width: 24, height: 24, borderRadius: 4,
  border: '1px solid var(--color-border)',
  background: 'var(--color-surface-2)',
  cursor: 'pointer', color: 'var(--color-text-muted)',
  fontSize: '0.85rem', lineHeight: 1, padding: 0,
};
const loadingFallbackStyle = {
  padding: 40, textAlign: 'center', color: 'var(--color-text-muted)',
};
