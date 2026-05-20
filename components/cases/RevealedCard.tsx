'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import type { ImagingCase } from '@/lib/cases';

type Confidence = 1 | 2 | 3 | 4 | 5;
type Recall = NonNullable<ImagingCase['recall']>;

type Props = {
  studentNotes: string;
  confidence: Confidence;
  recall: Recall | undefined;
  currentSlug: string;
  // ── Phase 3 lesion-spot CTA (added 2026-05-21) ──
  // Optional · when both `canSpotLesion` is true AND `onTrySpotting` is
  // provided, we render a "📍 Try spot-the-finding mode" button above
  // the footer. Cases without lesion_regions skip the CTA entirely.
  canSpotLesion?: boolean;
  onTrySpotting?: () => void;
};

const PROB_LABEL: Record<NonNullable<Recall['ddx'][number]['probability']>, string> = {
  high: 'High',
  mid: 'Mid',
  low: 'Low',
};

// Tailwind arbitrary classes per probability — uses the existing theme
// tokens. Keep these as pre-computed strings (not template-built at
// runtime) so the Tailwind JIT picks them up at build time.
const PROB_CHIP: Record<NonNullable<Recall['ddx'][number]['probability']>, string> = {
  high: 'border-[var(--color-tool-cyan)] bg-[rgba(90,204,230,0.16)] text-[var(--color-tool-cyan)]',
  mid: 'border-[var(--color-border-bright)] bg-[rgba(90,204,230,0.08)] text-[var(--color-tool-cyan)]/80',
  low: 'border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text-muted)]',
};

export function RevealedCard({
  studentNotes,
  confidence,
  recall,
  currentSlug,
  canSpotLesion,
  onTrySpotting,
}: Props) {
  // Heuristic "what you got right" highlighter. Splits the expert
  // findings into tokens, then for each finding bullet flags it if ANY
  // token (3+ chars) appears in the student's notes (case-insensitive).
  // This is a HINT only — Palm explicitly does not want anything that
  // looks like a grade. Communicated to the student as "you mentioned",
  // never "correct/wrong".
  //
  // TODO(future): replace with embedding-based similarity once we have
  // the OpenAI key wiring (Phase 2). For now, simple substring is good
  // enough and zero-latency.
  const studentLower = useMemo(() => studentNotes.toLowerCase(), [studentNotes]);
  const matchedIndexes = useMemo(() => {
    if (!recall?.findings || studentNotes.trim().length === 0) return new Set<number>();
    const set = new Set<number>();
    recall.findings.forEach((bullet, i) => {
      const tokens = bullet
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((t) => t.length >= 4);
      if (tokens.some((t) => studentLower.includes(t))) set.add(i);
    });
    return set;
  }, [recall, studentNotes, studentLower]);

  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
      <header className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-[13px] font-mono uppercase tracking-[0.18em] text-[var(--color-text)] flex items-center gap-2">
          <span className="text-[var(--color-finalized)]">02 /</span>
          Compare with the expert
        </h2>
        <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--color-text-faint)]">
          Self-rated confidence · {confidence}/5
        </span>
      </header>

      {/* Graceful degrade — when this case has no `recall` block yet
          (Agent B hasn't seeded it), surface a friendly placeholder so
          the student can still see their own notes. */}
      {!recall && (
        <div className="rounded-md border border-[var(--color-border-bright)] bg-[var(--color-bg)] p-4 mb-4 text-sm text-[var(--color-text-muted)] leading-relaxed">
          <strong className="text-[var(--color-text)] block mb-1">
            Expert findings coming soon
          </strong>
          This case doesn&apos;t have a written-up expert read yet. Your notes
          above are saved locally · we&apos;ll add the reveal content in a future
          update.
        </div>
      )}

      {/* Side-by-side compare. At < 640px (Tailwind sm:) we stack into a
          single column with student notes on top. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        {/* Your notes */}
        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
          <div className="text-[11px] font-mono uppercase tracking-wider text-[var(--color-text-muted)] mb-2 flex items-center gap-2">
            <span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-text-faint)]" />
            Your notes
          </div>
          {studentNotes.trim().length === 0 ? (
            <p className="text-sm text-[var(--color-text-faint)] italic">
              (no notes entered)
            </p>
          ) : (
            <p className="text-sm text-[var(--color-text)] leading-relaxed whitespace-pre-wrap font-sans">
              {studentNotes}
            </p>
          )}
        </div>

        {/* Expert findings */}
        <div className="rounded-md border border-[var(--color-border-tool)] bg-[rgba(90,204,230,0.04)] p-3">
          <div className="text-[11px] font-mono uppercase tracking-wider text-[var(--color-tool-cyan)] mb-2 flex items-center gap-2">
            <span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-tool-cyan)]" />
            Expert findings
          </div>
          {recall?.findings && recall.findings.length > 0 ? (
            <ul className="space-y-1.5 text-sm text-[var(--color-text)] leading-relaxed">
              {recall.findings.map((f, i) => {
                const youMentioned = matchedIndexes.has(i);
                return (
                  <li key={i} className="flex items-start gap-2">
                    <span
                      aria-hidden
                      className={`mt-1.5 inline-block h-1.5 w-1.5 rounded-full shrink-0 ${
                        youMentioned ? 'bg-[var(--color-finalized)]' : 'bg-[var(--color-text-faint)]'
                      }`}
                    />
                    <span>
                      {f}
                      {youMentioned && (
                        <span className="ml-2 text-[10px] font-mono uppercase tracking-wider text-[var(--color-finalized)]/80">
                          you mentioned
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-[var(--color-text-faint)] italic">
              (no findings provided)
            </p>
          )}
        </div>
      </div>

      {/* DDx ranking */}
      {recall?.ddx && recall.ddx.length > 0 && (
        <div className="mb-4">
          <div className="text-[11px] font-mono uppercase tracking-wider text-[var(--color-text-muted)] mb-2">
            Differential diagnosis ranking
          </div>
          <ol className="space-y-1.5">
            {recall.ddx.map((d, i) => {
              const prob = d.probability ?? 'mid';
              return (
                <li
                  key={i}
                  className="flex items-center justify-between gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2"
                >
                  <span className="text-sm text-[var(--color-text)] flex items-center gap-3 min-w-0">
                    <span className="text-[11px] font-mono text-[var(--color-text-faint)] w-4 shrink-0">
                      {i + 1}.
                    </span>
                    <span className="truncate">{d.name}</span>
                  </span>
                  <span
                    className={`shrink-0 inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider ${PROB_CHIP[prob]}`}
                  >
                    {PROB_LABEL[prob]}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {/* Final diagnosis · the punchline */}
      {recall?.final_diagnosis && (
        <div className="mb-4 rounded-lg border border-[var(--color-finalized)]/40 bg-[rgba(52,211,153,0.06)] p-4">
          <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--color-finalized)] mb-1">
            Final diagnosis
          </div>
          <div className="text-base sm:text-lg font-semibold text-[var(--color-text)] tracking-tight leading-snug">
            {recall.final_diagnosis}
          </div>
        </div>
      )}

      {/* Teaching points — quote-style block */}
      {recall?.teaching_points && recall.teaching_points.length > 0 && (
        <div className="mb-4 border-l-2 border-[var(--color-tool-violet)] pl-4 py-1">
          <div className="text-[11px] font-mono uppercase tracking-wider text-[var(--color-tool-violet)] mb-2">
            Teaching points
          </div>
          <ul className="space-y-1.5 text-sm text-[var(--color-text-muted)] leading-relaxed">
            {recall.teaching_points.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Citation */}
      {recall?.citation && (
        <p className="mb-4 text-[11px] font-mono text-[var(--color-text-faint)]">
          ref: {recall.citation}
        </p>
      )}

      {/* Lesion-spot CTA · only rendered when the case has expert lesion_regions
          AND the parent wired the onTrySpotting callback. Cases without regions
          (diffuse/pattern findings) skip this entire affordance. */}
      {canSpotLesion && onTrySpotting && (
        <div className="mb-4 rounded-md border border-[var(--color-tool-violet)]/30 bg-[rgba(167,139,250,0.06)] p-3 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-mono uppercase tracking-wider text-[var(--color-tool-violet)] mb-1">
              Try spot-the-finding
            </div>
            <p className="text-[13px] text-[var(--color-text-muted)] leading-relaxed">
              วงสี่เหลี่ยมรอบบริเวณที่คิดว่ามี lesion แล้วเทียบกับ expert region.
            </p>
          </div>
          <button
            type="button"
            onClick={onTrySpotting}
            className="imaging-btn imaging-btn-violet shrink-0"
          >
            <span aria-hidden>📍</span>
            Spot the finding
            <span aria-hidden>→</span>
          </button>
        </div>
      )}

      {/* Footer · Next case (we don't know what next is without the full
          index here, so just bounce back to /cases for now). The current
          slug is passed so future iterations can prefetch the next one. */}
      <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-[var(--color-border)]">
        <Link href="/cases" className="imaging-btn imaging-btn-primary">
          Next case
          <span aria-hidden>→</span>
        </Link>
        <Link href={`/cases/${currentSlug}`} className="imaging-btn imaging-btn-ghost">
          Re-do this case
        </Link>
      </div>
    </section>
  );
}
