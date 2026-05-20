'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CASES } from '@/lib/cases';
import {
  buildQueue,
  readAttempts,
  type AttemptStore,
  type ReviewItem,
} from '@/lib/srs';
import { ReviewQueueCard } from '@/components/review/ReviewQueueCard';
import { ReviewEmptyState } from '@/components/review/ReviewEmptyState';

// Number of cards we surface in the "Next up" section. The whole queue
// is computed (so the count line is accurate), but only the top N go on
// screen so the page stays focused. Honest cap — if the student wants more
// they can browse /cases.
const TOP_N = 3;

export function ReviewView() {
  // Hydration-safe read. localStorage is browser-only, so we read inside an
  // effect and keep an initial `null` so SSR + first paint match. While
  // `hydrated` is false we show a tiny skeleton.
  const [store, setStore] = useState<AttemptStore | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    setStore(readAttempts());
    setNow(Date.now());
  }, []);

  // Build the full queue once per store/clock tick. Pure → memoizable.
  const queue: ReviewItem[] = useMemo(() => {
    if (store === null) return [];
    return buildQueue(CASES, store, now);
  }, [store, now]);

  const attemptedCount = useMemo(() => {
    if (store === null) return 0;
    return Object.keys(store).length;
  }, [store]);

  // Top items the student actually sees today. We always include all NEW
  // cases up to TOP_N — if they have 0 attempts there is no "review", just
  // "start here". When they have prior attempts we mix high + mid priority.
  const visible = queue.slice(0, TOP_N);

  // Counts for the hero line — pulled from the full queue not the visible
  // slice so the number stays truthful.
  const needsAttention = queue.filter(
    (q) => q.priority === 'high' || q.reason === 'review-due',
  ).length;

  // Case lookup by slug, so the card can resolve the full metadata. CASES
  // is a small array (16 today) so a linear find per render is cheap.
  const caseBySlug = useMemo(() => {
    const m = new Map<string, (typeof CASES)[number]>();
    for (const c of CASES) m.set(c.slug, c);
    return m;
  }, []);

  // ── render branches ───────────────────────────────────────────────────────
  if (store === null) {
    // Skeleton — matches the final layout to avoid CLS.
    return (
      <>
        <div className="mb-6">
          <div className="h-3 w-24 rounded bg-[var(--color-surface-lift)] mb-3" />
          <div className="h-6 w-56 rounded bg-[var(--color-surface-lift)] mb-2" />
          <div className="h-4 w-40 rounded bg-[var(--color-surface-lift)]" />
        </div>
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-[88px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] animate-pulse"
            />
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      {/* Hero — eyebrow + title + truthful count */}
      <header className="mb-6">
        <p className="text-[11px] font-mono uppercase tracking-wider text-[var(--color-tool-violet)] mb-2">
          Review
        </p>
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-[var(--color-text)] mb-1.5">
          Next up for you
        </h1>
        {attemptedCount === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">
            Once you start a case, this page will queue the next ones to study.
          </p>
        ) : (
          <p className="text-sm text-[var(--color-text-muted)]">
            {needsAttention > 0 ? (
              <>
                <span className="text-[var(--color-text)] font-medium">
                  {needsAttention}
                </span>{' '}
                {needsAttention === 1 ? 'case needs' : 'cases need'} attention
                today
                <span aria-hidden className="text-[var(--color-text-faint)]"> / </span>
                {attemptedCount} attempted so far
              </>
            ) : (
              <>
                Nothing urgent right now — {attemptedCount} attempted so far,
                cooldown in progress.
              </>
            )}
          </p>
        )}
      </header>

      {/* Body — empty state vs queue */}
      {attemptedCount === 0 && queue.length === 0 ? (
        <ReviewEmptyState />
      ) : visible.length === 0 ? (
        // Edge case: catalogue is empty (CASES === []) — keep honest.
        <ReviewEmptyState />
      ) : (
        <>
          <ul className="space-y-3">
            {visible.map((item) => {
              const meta = caseBySlug.get(item.caseSlug);
              if (!meta) return null;
              return (
                <li key={item.caseSlug}>
                  <ReviewQueueCard item={item} caseMeta={meta} now={now} />
                </li>
              );
            })}
          </ul>

          {/* Footer link to full catalogue when there's more than we surface */}
          {queue.length > visible.length && (
            <div className="mt-5 text-center">
              <Link
                href="/cases"
                className="text-xs sm:text-sm text-[var(--color-text-muted)] hover:text-[var(--color-tool-cyan)] transition-colors font-mono uppercase tracking-wider"
              >
                Browse all {CASES.length} cases →
              </Link>
            </div>
          )}
        </>
      )}

      {/* Algorithm transparency — small print so students can trust the queue.
          One short paragraph, no middle-dot chains. */}
      <section className="mt-10 border-t border-[var(--color-border)] pt-5 text-[11px] sm:text-xs text-[var(--color-text-faint)] leading-relaxed font-mono">
        <p className="mb-1.5 uppercase tracking-wider text-[var(--color-text-muted)]">
          How the queue works
        </p>
        <p>
          New cases surface first. Cases you rated under 3/5 come back the next
          day. Mid-confidence (3 or 4) returns in 3 days. High confidence (5)
          rests for 7 days. Your attempts live in this browser only for now;
          when sign-in lands, they sync across devices.
        </p>
      </section>
    </>
  );
}
