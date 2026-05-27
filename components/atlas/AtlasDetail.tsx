import Image from "next/image";
import Link from "next/link";
import {
  type AtlasEntry,
  BODY_PART_LABELS,
  MODALITY_LABELS,
  SPECIES_LABELS,
} from "@/lib/atlas";
import { CASES } from "@/lib/cases";
import { AtlasCard } from "./AtlasCard";

// Cross-link helper — if an atlas slug also exists as a case slug
// (true for every CUVET-internal entry by construction), return the
// matching ImagingCase so AtlasDetail can offer "open in DICOM viewer".
// Static lookup against CASES — no fetch, no network, no client work.
function matchingCase(slug: string) {
  return CASES.find((c) => c.slug === slug);
}

/**
 * AtlasDetail — single atlas-entry detail view.
 *
 * Layout:
 *  - Breadcrumb back to /atlas
 *  - Title (species + part + view)
 *  - Big image (full-width on mobile, capped at ~800px on desktop)
 *  - Description (1-2 sentence neutral anatomy summary)
 *  - Learning landmarks (bullet list)
 *  - License + attribution + credibility
 *  - "Related cases" — body-part-matched cross-link to /cases (Agent B owns)
 *  - Related atlas entries — peers in the same body_part
 *
 * Renders cleanly even when optional fields (learning_landmarks,
 * source_url, etc.) are absent — Day-1 entries don't all have every
 * field populated.
 */
export function AtlasDetail({
  entry,
  related,
}: {
  entry: AtlasEntry;
  related: AtlasEntry[];
}) {
  const species = SPECIES_LABELS[entry.species];
  const part = BODY_PART_LABELS[entry.body_part];
  const modality = MODALITY_LABELS[entry.modality];

  return (
    <article>
      {/* Breadcrumb */}
      <nav className="mb-4 text-[11px] font-mono uppercase tracking-wider text-[var(--color-text-faint)]">
        <Link href="/atlas" className="hover:text-[var(--color-tool-cyan)]">
          Atlas
        </Link>{" "}
        <span aria-hidden>›</span>{" "}
        <span className="text-[var(--color-text-muted)]">{species}</span>{" "}
        <span aria-hidden>›</span>{" "}
        <span className="text-[var(--color-text-muted)]">{part}</span>
      </nav>

      {/* Header — title carries species/part/view, metadata strip only
          adds the modality detail not already in the headline. Avoids
          the double-stamp antipattern where the same 3 facets repeat. */}
      <header className="mb-6">
        <h1 className="imaging-display text-2xl sm:text-3xl text-[var(--color-text)] mb-2">
          {species} {part} — {entry.view}
        </h1>
        <div className="text-[12px] font-mono text-[var(--color-tool-cyan)]">
          {modality}
        </div>
      </header>

      {/* Big image — viewer-style chrome (black BG, hairline border, scale ruler optional) */}
      <figure className="mb-6">
        <div className="relative rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-3)] overflow-hidden shadow-xl">
          <div className="relative aspect-[4/3] bg-black">
            <Image
              src={entry.image_path}
              alt={`${species} ${part} ${entry.view} radiograph — atlas reference`}
              fill
              sizes="(min-width: 1024px) 800px, 100vw"
              className="object-contain"
              priority
            />
          </div>
          {/* Footer strip — viewer-style metadata. Atlas is 100% real
              (Palm directive 2026-05-26) so the badge is always green/cyan,
              never violet AI. Color matches the per-tile badge in
              AtlasCard's getCredBadge() — keep in lockstep. */}
          <div className="flex items-center justify-between px-3 py-2 bg-[var(--color-surface-2)] border-t border-[var(--color-border)] text-[10px] font-mono text-[var(--color-text-muted)]">
            <span>
              {entry.modality} · {species} · {part} · {entry.view}
            </span>
            {entry.credibility === "peer-reviewed" ? (
              <span className="text-[var(--color-tool-cyan)]">✓ Peer-reviewed reference</span>
            ) : (
              <span className="text-[var(--color-finalized)]">✓ {entry.credibility} reference</span>
            )}
          </div>
        </div>
      </figure>

      {/* Description */}
      <section className="mb-6">
        <h2 className="text-[13px] font-mono uppercase tracking-[0.18em] text-[var(--color-text)] mb-3 flex items-center gap-2">
          <span className="text-[var(--color-tool-violet)]">01 /</span> What&apos;s visible
        </h2>
        <p className="text-[15px] text-[var(--color-text-muted)] leading-relaxed">
          {entry.description}
        </p>
      </section>

      {/* Learning landmarks */}
      {entry.learning_landmarks && entry.learning_landmarks.length > 0 && (
        <section className="mb-8">
          <h2 className="text-[13px] font-mono uppercase tracking-[0.18em] text-[var(--color-text)] mb-3 flex items-center gap-2">
            <span className="text-[var(--color-tool-violet)]">02 /</span> Landmarks
          </h2>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-[14px] text-[var(--color-text-muted)]">
            {entry.learning_landmarks.map((lm, i) => (
              <li
                key={i}
                className="flex items-start gap-2.5 leading-relaxed"
              >
                <span
                  aria-hidden
                  className="text-[var(--color-tool-cyan)] font-mono text-[11px] mt-0.5 shrink-0"
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span>{lm}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* License + attribution panel */}
      <section className="mb-8">
        <h2 className="text-[13px] font-mono uppercase tracking-[0.18em] text-[var(--color-text)] mb-3 flex items-center gap-2">
          <span className="text-[var(--color-tool-violet)]">03 /</span> Source &amp; license
        </h2>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 text-[13px] text-[var(--color-text-muted)] leading-relaxed">
          <dl className="grid grid-cols-[100px_1fr] gap-x-3 gap-y-2 font-mono text-[12px]">
            <dt className="text-[var(--color-text-faint)] uppercase tracking-wider">
              License
            </dt>
            <dd className="text-[var(--color-text)]">{entry.license}</dd>

            <dt className="text-[var(--color-text-faint)] uppercase tracking-wider">
              Credibility
            </dt>
            <dd>
              {/* Color matches the per-tile badge in AtlasCard:
                  cyan = peer-reviewed (most rigorous · Zenodo)
                  green = community / open-textbook / cuvet-internal
                  Stay in lockstep with getCredBadge in AtlasCard. */}
              <span
                className={
                  entry.credibility === "peer-reviewed"
                    ? "text-[var(--color-tool-cyan)]"
                    : "text-[var(--color-finalized)]"
                }
              >
                {entry.credibility}
              </span>
            </dd>

            {entry.attribution && (
              <>
                <dt className="text-[var(--color-text-faint)] uppercase tracking-wider">
                  Attribution
                </dt>
                <dd className="text-[var(--color-text-muted)]">{entry.attribution}</dd>
              </>
            )}

            {entry.source_url && (
              <>
                <dt className="text-[var(--color-text-faint)] uppercase tracking-wider">
                  Source
                </dt>
                <dd>
                  <a
                    href={entry.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--color-tool-cyan)] hover:underline"
                  >
                    {entry.source_url} ↗
                  </a>
                </dd>
              </>
            )}
          </dl>

        </div>
      </section>

      {/* Related cases — direct link to the matching DICOM case when the
          atlas slug doubles as a case slug (CUVET-internal entries),
          plus a body-part-filtered fallback to /cases. */}
      <section className="mb-8">
        <h2 className="text-[13px] font-mono uppercase tracking-[0.18em] text-[var(--color-text)] mb-3 flex items-center gap-2">
          <span className="text-[var(--color-tool-violet)]">04 /</span> Next — apply to a case
        </h2>
        {(() => {
          const matched = matchingCase(entry.slug);
          if (matched) {
            return (
              <Link
                href={`/cases/${matched.slug}`}
                className="imaging-tool-tile group mb-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className="font-semibold text-[var(--color-text)] tracking-tight text-[15px]">
                      Open in DICOM viewer — {matched.title}
                    </span>
                    <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-finalized)]">
                      paired case
                    </span>
                  </div>
                  <div className="text-[13px] text-[var(--color-text-muted)] leading-relaxed">
                    Same anonymized radiograph wrapped as DICOM —
                    practice Norberg / VHS / Length measurements live on this image.
                  </div>
                </div>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="imaging-tile-arrow"
                  aria-hidden="true"
                >
                  <path d="M5 12h14M13 5l7 7-7 7" />
                </svg>
              </Link>
            );
          }
          return null;
        })()}
        <Link
          href={`/cases?body=${encodeURIComponent(entry.body_part)}`}
          className="imaging-tool-tile group"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 mb-1">
              <span className="font-semibold text-[var(--color-text)] tracking-tight text-[15px]">
                Clinical case library — {part}
              </span>
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-text-faint)]">
                read abnormal next
              </span>
            </div>
            <div className="text-[13px] text-[var(--color-text-muted)] leading-relaxed">
              Now that you have a baseline for normal {part.toLowerCase()},
              open a case from the library to spot what&apos;s different.
            </div>
          </div>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="imaging-tile-arrow"
            aria-hidden="true"
          >
            <path d="M5 12h14M13 5l7 7-7 7" />
          </svg>
        </Link>
      </section>

      {/* Related atlas entries — peers in same body_part */}
      {related.length > 0 && (
        <section className="mb-8">
          <h2 className="text-[13px] font-mono uppercase tracking-[0.18em] text-[var(--color-text)] mb-3 flex items-center gap-2">
            <span className="text-[var(--color-tool-violet)]">05 /</span> Other {part.toLowerCase()} views
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {related.map((r) => (
              <AtlasCard key={r.id} entry={r} />
            ))}
          </div>
        </section>
      )}

      {/* Back link */}
      <div className="mt-10 pt-6 border-t border-[var(--color-border)]">
        <Link
          href="/atlas"
          className="text-[12px] font-mono uppercase tracking-wider text-[var(--color-text-muted)] hover:text-[var(--color-tool-cyan)]"
        >
          ← Back to atlas grid
        </Link>
      </div>
    </article>
  );
}
