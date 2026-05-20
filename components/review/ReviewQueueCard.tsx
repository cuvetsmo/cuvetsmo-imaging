'use client';

import Link from 'next/link';
import type { ImagingCase } from '@/lib/cases';
import type { ReviewItem } from '@/lib/srs';
import { relativeTime } from '@/lib/srs';

type Props = {
  item: ReviewItem;
  caseMeta: ImagingCase;
  now: number;
};

// Priority → token mapping. Using existing CSS tokens to stay on-theme; cyan
// for high (the active tool color), violet for mid (secondary accent), faint
// border for low (visually demoted).
const PRIORITY_STYLES: Record<
  ReviewItem['priority'],
  { dot: string; badgeBg: string; badgeBorder: string; badgeText: string }
> = {
  high: {
    dot: 'bg-[var(--color-tool-cyan)]',
    badgeBg: 'bg-[rgba(90,204,230,0.10)]',
    badgeBorder: 'border-[var(--color-border-tool)]',
    badgeText: 'text-[var(--color-tool-cyan)]',
  },
  mid: {
    dot: 'bg-[var(--color-tool-violet)]',
    badgeBg: 'bg-[rgba(167,139,250,0.10)]',
    badgeBorder: 'border-[rgba(167,139,250,0.32)]',
    badgeText: 'text-[var(--color-tool-violet)]',
  },
  low: {
    dot: 'bg-[var(--color-text-faint)]',
    badgeBg: 'bg-[var(--color-surface-3)]',
    badgeBorder: 'border-[var(--color-border)]',
    badgeText: 'text-[var(--color-text-faint)]',
  },
};

// Modality glyph reused from CaseLibraryLocal's tab icons (no middle-dot
// chain per memory rule — modality is shown as a small standalone badge).
function modalityGlyph(m?: string): string {
  if (!m) return '🩻';
  const M = m.toUpperCase();
  if (['DX', 'CR', 'RG', 'DR', 'RF', 'MG'].includes(M)) return '🦴';
  if (M === 'CT') return '🧠';
  if (M === 'MR') return '🧲';
  if (M === 'US') return '🌊';
  return '🩻';
}

export function ReviewQueueCard({ item, caseMeta, now }: Props) {
  const style = PRIORITY_STYLES[item.priority];

  // Signalment block — species + signalment, joined by middle space (no
  // middle-dot chains per memory rule).
  const signalmentBits = [caseMeta.species, caseMeta.signalment]
    .filter(Boolean)
    .join(' / ');

  // Footer microcopy varies by reason — keep it honest, no fake stats.
  let microcopy: string | null = null;
  if (item.reason === 'new') {
    microcopy = 'First time seeing this one';
  } else if (item.lastSeenAt != null) {
    const seen = relativeTime(item.lastSeenAt, now);
    const conf = item.lastConfidence;
    microcopy =
      conf != null
        ? `Last attempt ${seen}, you rated ${conf}/5`
        : `Last opened ${seen}`;
  }

  return (
    <Link
      href={`/cases/${item.caseSlug}`}
      className="group block rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-lift)] hover:border-[var(--color-border-tool)] transition-colors p-3 sm:p-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-tool-cyan)]"
    >
      <div className="flex items-start gap-3">
        {/* Thumbnail — no real preview image at Phase 2 (Iron Rule 0: don't
            fake a thumbnail when we don't have one). Use modality glyph
            + species in a tile so the row still has a left visual anchor. */}
        <div
          aria-hidden
          className="shrink-0 w-[64px] h-[48px] sm:w-[80px] sm:h-[60px] rounded-md border border-[var(--color-border)] bg-[var(--color-surface-3)] flex flex-col items-center justify-center"
        >
          <span className="text-lg sm:text-xl leading-none mb-0.5">
            {modalityGlyph(caseMeta.modality)}
          </span>
          <span className="text-[9px] sm:text-[10px] font-mono uppercase tracking-wider text-[var(--color-text-faint)]">
            {caseMeta.modality ?? '—'}
          </span>
        </div>

        {/* Center column — title + signalment + microcopy */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2 mb-1">
            <h3 className="text-sm sm:text-[15px] font-semibold leading-tight text-[var(--color-text)] group-hover:text-[var(--color-tool-cyan)] transition-colors line-clamp-2">
              {caseMeta.title}
            </h3>
            {/* Reason badge — wraps under title on narrow screens via flex */}
            <span
              className={`shrink-0 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] sm:text-[11px] font-mono uppercase tracking-wider ${style.badgeBg} ${style.badgeBorder} ${style.badgeText}`}
            >
              <span aria-hidden className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
              {item.reasonLabel}
            </span>
          </div>
          {signalmentBits && (
            <p className="text-[12px] sm:text-xs text-[var(--color-text-muted)] truncate">
              {signalmentBits}
            </p>
          )}
          {microcopy && (
            <p className="text-[11px] sm:text-xs text-[var(--color-text-faint)] mt-1">
              {microcopy}
            </p>
          )}
        </div>

        {/* CTA arrow — visually only, the whole card is the link */}
        <div
          aria-hidden
          className="shrink-0 self-center text-[var(--color-text-faint)] group-hover:text-[var(--color-tool-cyan)] group-hover:translate-x-0.5 transition-all"
        >
          →
        </div>
      </div>
    </Link>
  );
}
