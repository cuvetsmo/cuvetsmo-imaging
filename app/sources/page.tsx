import type { Metadata } from "next";
import Link from "next/link";
import { sourcesByTier, type DataSource } from "@/lib/sources";

export const metadata: Metadata = {
  title: "Data + learning sources",
  description:
    "The open veterinary radiology datasets and learning portals that power Imaging Lab — VetXRay (Zenodo), Mendeley VHS, VET DICOM Library, IVRA OER, CEG Interactive Radiographic Viewer. Licenses, citations, and how we use each.",
  openGraph: {
    title: "Imaging Lab — Data + learning sources",
    description:
      "The open vet radiology resources behind Imaging Lab. CC BY 4.0 datasets we ship, plus free portals we link out to.",
    type: "website",
    url: "https://imaging.cuvetsmo.com/sources",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "CUVETSMO Imaging Sources" }],
  },
  alternates: { canonical: "https://imaging.cuvetsmo.com/sources" },
};

// Server component — the source registry is static, no client state.
// Grouped into two visual tiers so the redistribution distinction is
// obvious before you read the body text: "ship" carries a green badge
// and lives in the top section; "external" carries a violet badge and
// sits below.
export default function SourcesPage() {
  const { ship, external, pending } = sourcesByTier();

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-10 text-[var(--color-text)]">
      <header className="mb-10">
        <p className="text-[11px] uppercase tracking-widest text-[var(--color-tool-violet)] mb-2">
          Open data + learning
        </p>
        <h1 className="text-3xl sm:text-4xl font-semibold mb-3">
          Data and learning sources
        </h1>
        <p className="text-[var(--color-text-muted)] leading-relaxed max-w-2xl">
          Imaging Lab รวมเฉพาะข้อมูลที่ใบอนุญาตให้ redistribute ได้
          (CC BY 4.0) ส่วนแหล่งเรียนรู้อื่น ๆ ที่ฟรีแต่ไม่มี open license
          ชัดเจน เราลิงก์ออกแทน — เปิดในเบราว์เซอร์แล้วฝึกที่นั่นได้เลย.
        </p>
      </header>

      {/* Tier 1 — datasets we ship */}
      <section aria-labelledby="ship-heading" className="mb-12">
        <div className="flex items-baseline justify-between mb-4">
          <h2 id="ship-heading" className="text-lg font-semibold">
            <span className="text-[var(--color-finalized)]">●</span>{" "}
            ที่เรา ship อยู่ในเว็บ
          </h2>
          <span className="text-xs text-[var(--color-text-faint)]">
            CC BY 4.0 · redistribute ได้
          </span>
        </div>
        <p className="text-sm text-[var(--color-text-muted)] mb-5 leading-relaxed">
          ภาพและข้อมูลด้านล่างนี้ลงทะเบียนใน <code className="text-[var(--color-tool-cyan)]">/public/cases</code> และ atlas ของเรา
          พร้อม attribution ตรงตามที่เจ้าของกำหนด.
        </p>
        <ul className="space-y-4">
          {ship.map((src) => (
            <SourceCard key={src.id} src={src} />
          ))}
        </ul>
      </section>

      {/* Tier 2 — external link-out */}
      <section aria-labelledby="external-heading" className="mb-12">
        <div className="flex items-baseline justify-between mb-4">
          <h2 id="external-heading" className="text-lg font-semibold">
            <span className="text-[var(--color-tool-violet)]">◆</span>{" "}
            แหล่งเรียนรู้ภายนอก (ลิงก์ออก)
          </h2>
          <span className="text-xs text-[var(--color-text-faint)]">
            ฟรี · ไม่มี open license ชัดเจน
          </span>
        </div>
        <p className="text-sm text-[var(--color-text-muted)] mb-5 leading-relaxed">
          แหล่งด้านล่างเปิดให้ใช้ฟรีแต่ไม่ได้ระบุใบอนุญาตให้ redistribute
          เราจึงลิงก์ออก ไม่ mirror ภาพมาในเว็บ — เปิดที่หน้าต้นทางแล้ว
          drop ไฟล์กลับเข้า viewer ของเราได้ตามปกติ.
        </p>
        <ul className="space-y-4">
          {external.map((src) => (
            <SourceCard key={src.id} src={src} />
          ))}
        </ul>
      </section>

      {/* Tier 3 — pending approval (transparency about future cuvet cases) */}
      {pending.length > 0 && (
        <section aria-labelledby="pending-heading" className="mb-12">
          <div className="flex items-baseline justify-between mb-4">
            <h2 id="pending-heading" className="text-lg font-semibold">
              <span className="text-[var(--color-active-red)]">○</span>{" "}
              รอ approval (โชว์เพื่อโปร่งใส)
            </h2>
            <span className="text-xs text-[var(--color-text-faint)]">
              ยังไม่ ship · ห้ามอู้ว่า ship แล้ว
            </span>
          </div>
          <p className="text-sm text-[var(--color-text-muted)] mb-5 leading-relaxed">
            แหล่งด้านล่างนี้ถูก scaffold ใน codebase แล้ว แต่ยังไม่มีเคสจริง
            ลง production จนกว่า PII scrub + per-case approval จะครบ.
            แสดงในหน้านี้เพื่อ disclose roadmap ตรงไปตรงมา.
          </p>
          <ul className="space-y-4">
            {pending.map((src) => (
              <SourceCard key={src.id} src={src} />
            ))}
          </ul>
        </section>
      )}

      {/* Footer note — license literacy crib */}
      <aside className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-5 py-4 text-sm text-[var(--color-text-muted)] leading-relaxed">
        <p className="text-[var(--color-text)] font-medium mb-2">
          ทำไมแยกเป็น 2 tier?
        </p>
        <p className="mb-2">
          <strong className="text-[var(--color-finalized)]">CC BY 4.0</strong> = ใช้ซ้ำได้รวมถึง remix และ commercial use
          ตราบใดที่ให้ credit ผู้สร้างเดิม. เราจึงคัดบางส่วนมา convert
          เป็น DICOM และฝัง attribution ไว้ในไฟล์ + ในการ์ดเคส.
        </p>
        <p>
          <strong className="text-[var(--color-tool-violet)]">ฟรี ≠ open license</strong> — บางแหล่ง “เปิดให้ใช้” แต่ไม่ได้
          ระบุใบอนุญาตเป็นลายลักษณ์อักษร เราเลยลิงก์ออกแทน mirror.
          การทำตามใบอนุญาตที่ระบุ &gt; ความสะดวกของเว็บเรา.
        </p>
      </aside>

      <div className="mt-10 flex flex-wrap gap-3">
        <Link href="/cases" className="vmx-btn vmx-btn-primary vmx-btn-sm">
          ดู case library
        </Link>
        <Link href="/atlas" className="vmx-btn vmx-btn-ghost vmx-btn-sm">
          ดู anatomy atlas
        </Link>
        <Link href="/about" className="vmx-btn vmx-btn-ghost vmx-btn-sm">
          กลับ About
        </Link>
      </div>
    </div>
  );
}

// Individual source card — pure presentational. Tier styling is owned
// by the parent's section so the same card renders in both contexts
// without prop-drilling colors.
function SourceCard({ src }: { src: DataSource }) {
  // Tier → badge color (green ship · violet external · red pending).
  const badgeColor =
    src.tier === "ship"
      ? "text-[var(--color-finalized)] border-[var(--color-finalized)]/40 bg-[var(--color-finalized)]/[0.08]"
      : src.tier === "pending"
        ? "text-[var(--color-active-red)] border-[var(--color-active-red)]/40 bg-[var(--color-active-red)]/[0.08]"
        : "text-[var(--color-tool-violet)] border-[var(--color-tool-violet)]/40 bg-[var(--color-tool-violet)]/[0.08]";

  return (
    <li
      id={src.id}
      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-5 hover:border-[var(--color-border-bright)] transition-colors"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <h3 className="text-base font-semibold text-[var(--color-text)] leading-snug">
          {src.title}
        </h3>
        <span
          className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-medium uppercase tracking-wide ${badgeColor}`}
        >
          {src.license}
        </span>
      </div>

      <p className="text-xs text-[var(--color-text-faint)] mb-3 italic">
        {src.attribution}
      </p>

      <p className="text-sm text-[var(--color-text-muted)] leading-relaxed mb-3">
        {src.summary}
      </p>

      <div className="rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] px-3 py-2.5 mb-3">
        <p className="text-[11px] uppercase tracking-wider text-[var(--color-text-faint)] mb-1">
          วิธีที่เราใช้
        </p>
        <p className="text-sm text-[var(--color-text)] leading-relaxed">
          {src.how_we_use_it}
        </p>
      </div>

      {src.redistribution_note && (
        <p className="text-xs text-[var(--color-text-muted)] mb-3 leading-relaxed">
          <span className="text-[var(--color-text-faint)]">หมายเหตุการ redistribute — </span>
          {src.redistribution_note}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 text-xs">
        {src.tier !== "pending" && (
          <a
            href={src.url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-[var(--color-tool-cyan)] hover:text-[#7DDCEF] hover:underline underline-offset-2"
          >
            เปิดต้นทาง
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M7 17 17 7" />
              <path d="M7 7h10v10" />
            </svg>
          </a>
        )}
        {src.doi && (
          <span className="text-[var(--color-text-faint)]">
            DOI:{" "}
            <a
              href={`https://doi.org/${src.doi}`}
              target="_blank"
              rel="noreferrer noopener"
              className="text-[var(--color-text-muted)] hover:text-[var(--color-tool-cyan)] hover:underline underline-offset-2"
            >
              {src.doi}
            </a>
          </span>
        )}
        <span className="text-[var(--color-text-faint)]">
          ใช้ใน:{" "}
          <span className="text-[var(--color-text-muted)]">
            {src.surfaces.join(" · ")}
          </span>
        </span>
        <span className="ml-auto text-[var(--color-text-faint)]">
          verified {src.last_verified}
        </span>
      </div>
    </li>
  );
}
