'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ImagingCase } from '@/lib/cases';
import {
  buildRankerOptions,
  scoreRanking,
  type RankerOption,
  type ScoreBreakdown,
  type SlotMark,
} from '@/lib/ddx-pools';

type Recall = NonNullable<ImagingCase['recall']>;

type Props = {
  caseMeta: Pick<ImagingCase, 'slug' | 'species' | 'body_part'>;
  expertDdx: Recall['ddx'];
  // Optional extra names to exclude from the distractor pool. Typically the
  // case's final_diagnosis — without this, an umbrella answer like
  // "Cardiomegaly" can appear as a distractor on a case whose final dx IS
  // Cardiomegaly, which scores the literally-correct student answer wrong.
  extraExcludes?: string[];
  // Called once the student submits + the score is computed. Parent owns
  // localStorage persistence — we just hand back the result.
  onSubmit: (result: {
    studentTop3: string[];
    score: 0 | 1 | 2 | 3;
    rankedAt: string;
  }) => void;
  // Lets the student bail out and go straight to the standard reveal.
  onSkip: () => void;
};

// We surface 3 slots. Each slot can hold one option name (string) or
// null when empty.
type Slots = [string | null, string | null, string | null];
const EMPTY_SLOTS: Slots = [null, null, null];

const MARK_STYLES: Record<SlotMark, { ring: string; chip: string; icon: string; label: string }> = {
  correct: {
    ring: 'border-[var(--color-finalized)] bg-[rgba(52,211,153,0.10)]',
    chip: 'border-[var(--color-finalized)] bg-[rgba(52,211,153,0.16)] text-[var(--color-finalized)]',
    icon: '✓',
    label: 'correct rank',
  },
  'off-by-one': {
    ring: 'border-[var(--color-tool-violet)]/60 bg-[rgba(167,139,250,0.10)]',
    chip: 'border-[var(--color-tool-violet)] bg-[rgba(167,139,250,0.16)] text-[var(--color-tool-violet)]',
    icon: '↕',
    label: 'off by one',
  },
  wrong: {
    ring: 'border-[var(--color-border)] bg-[var(--color-bg)]',
    chip: 'border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text-faint)]',
    icon: '✗',
    label: 'not in expert top 3',
  },
};

const BUCKET_HEADLINE: Record<0 | 1 | 2 | 3, { title: string; sub: string; tone: string }> = {
  3: {
    title: 'Perfect ranking',
    sub: 'All three in the right order',
    tone: 'text-[var(--color-finalized)]',
  },
  2: {
    title: 'Good ranking',
    sub: 'Strong instinct — minor ordering polish to do',
    tone: 'text-[var(--color-tool-cyan)]',
  },
  1: {
    title: 'Partial credit',
    sub: 'One on target — review the others below',
    tone: 'text-[var(--color-tool-violet)]',
  },
  0: {
    title: 'Worth a review',
    sub: "Expert's ranking is below — compare against your picks",
    tone: 'text-[var(--color-text-muted)]',
  },
};

export function DDxRankerCard({ caseMeta, expertDdx, extraExcludes, onSubmit, onSkip }: Props) {
  // Build options once per case. They're already shuffled deterministically.
  const options = useMemo<RankerOption[]>(
    () => buildRankerOptions(caseMeta, expertDdx, extraExcludes),
    [caseMeta, expertDdx, extraExcludes],
  );

  const [slots, setSlots] = useState<Slots>(EMPTY_SLOTS);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<ScoreBreakdown | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, []);

  // Disarm confirm whenever slots change — the student is still moving
  // pieces around, so we don't want to "fire" on the next click.
  // queueMicrotask defers the setState past React's "no setState sync in
  // effect" guard. Behavior is unchanged — the confirm pill is dismissed
  // one microtask later, well before the next paint.
  useEffect(() => {
    if (confirming) {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      queueMicrotask(() => setConfirming(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots[0], slots[1], slots[2]]);

  // ── selection logic ──
  // Tap-to-promote: tapping an unplaced option fills the first empty
  // slot. Tapping an option already placed unplaces it. Slot chips can
  // also be reordered via the up/down arrows next to each (keyboard +
  // touch-friendly) — no native HTML5 drag, which behaves poorly on
  // mobile Safari.

  const slotIndexOf = useCallback(
    (name: string): number => slots.findIndex((s) => s === name),
    [slots],
  );

  const togglePick = useCallback((name: string) => {
    setSlots((prev) => {
      const next = [...prev] as Slots;
      const existing = next.findIndex((s) => s === name);
      if (existing >= 0) {
        // Already picked — unpick. Shift later slots up so we don't
        // leave a hole in the middle.
        const compacted = next.filter((s) => s !== name);
        while (compacted.length < 3) compacted.push(null);
        return compacted as Slots;
      }
      // Add to first empty slot.
      const empty = next.findIndex((s) => s === null);
      if (empty === -1) return prev; // all 3 slots full
      next[empty] = name;
      return next;
    });
  }, []);

  const moveSlot = useCallback((from: number, dir: -1 | 1) => {
    setSlots((prev) => {
      const to = from + dir;
      if (to < 0 || to > 2) return prev;
      const next = [...prev] as Slots;
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  }, []);

  const clearAll = useCallback(() => setSlots(EMPTY_SLOTS), []);

  // ── submit (confirm-first, mirrors RecallInputCard pattern) ──
  const filledCount = slots.filter((s) => s !== null).length;
  const canSubmit = filledCount === 3 && !result;

  const armOrFire = useCallback(() => {
    if (!canSubmit) return;
    if (confirming) {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      setConfirming(false);

      const studentTop3 = slots.filter((s): s is string => s !== null);
      const breakdown = scoreRanking(studentTop3, expertDdx);
      setResult(breakdown);
      onSubmit({
        studentTop3,
        score: breakdown.bucket,
        rankedAt: new Date().toISOString(),
      });
      return;
    }
    setConfirming(true);
    confirmTimerRef.current = setTimeout(() => setConfirming(false), 4000);
  }, [canSubmit, confirming, slots, expertDdx, onSubmit]);

  // Keyboard reorder while focused on a slot chip — arrow up/down moves
  // the chip in that direction.
  const onSlotKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLLIElement>, idx: number) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveSlot(idx, -1);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveSlot(idx, 1);
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        const name = slots[idx];
        if (name) {
          e.preventDefault();
          togglePick(name);
        }
      }
    },
    [moveSlot, slots, togglePick],
  );

  // ── render ──
  // Result mode — show the scored ranking, then a "Continue to compare"
  // button to advance the parent state machine.
  if (result) {
    const headline = BUCKET_HEADLINE[result.bucket];
    return (
      <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 mb-4">
        <header className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
          <h2 className="text-[13px] font-mono uppercase tracking-[0.18em] text-[var(--color-text)] flex items-center gap-2">
            <span className="text-[var(--color-tool-violet)]">02 /</span>
            DDx ranking · scored
          </h2>
          <span
            className={`text-[11px] font-mono uppercase tracking-[0.18em] ${headline.tone}`}
          >
            {result.bucket}/3 · {headline.title}
          </span>
        </header>

        <p className="text-[13px] text-[var(--color-text-muted)] mb-3 leading-relaxed">
          {headline.sub}
        </p>

        {/* Per-slot breakdown */}
        <ol className="space-y-1.5 mb-4">
          {slots.map((name, i) => {
            const mark = result.marks[i] ?? 'wrong';
            const style = MARK_STYLES[mark];
            const expertName = result.expertOrder[i];
            return (
              <li
                key={i}
                className={`flex items-center gap-3 rounded-md border px-3 py-2 ${style.ring}`}
              >
                <span className="text-[11px] font-mono text-[var(--color-text-faint)] w-4 shrink-0">
                  {i + 1}.
                </span>
                <span className="text-sm text-[var(--color-text)] flex-1 min-w-0 truncate">
                  {name ?? '(empty)'}
                </span>
                <span
                  className={`shrink-0 inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider ${style.chip}`}
                  title={style.label}
                >
                  <span aria-hidden>{style.icon}</span>
                  {style.label}
                </span>
              </li>
            );
          })}
        </ol>

        {/* Expert truth row */}
        <div className="rounded-md border border-[var(--color-border-tool)] bg-[rgba(90,204,230,0.04)] p-3 mb-4">
          <div className="text-[11px] font-mono uppercase tracking-wider text-[var(--color-tool-cyan)] mb-2">
            Expert top 3
          </div>
          <ol className="space-y-1 text-sm text-[var(--color-text)]">
            {result.expertOrder.map((name, i) => (
              <li key={i} className="flex items-center gap-3">
                <span className="text-[11px] font-mono text-[var(--color-text-faint)] w-4 shrink-0">
                  {i + 1}.
                </span>
                <span className="truncate">{name}</span>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[10px] font-mono text-[var(--color-text-faint)] leading-relaxed">
            scoring: ✓ exact rank · ↕ off by one (half credit) · ✗ not in
            expert top 3
          </p>
        </div>

        {/* Continue to compare view */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onSkip}
            className="imaging-btn imaging-btn-primary min-w-[180px] justify-center"
          >
            Continue to compare
            <span aria-hidden>↓</span>
          </button>
        </div>
      </section>
    );
  }

  // Ranker mode (pre-submit).
  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 mb-4">
      <header className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-[13px] font-mono uppercase tracking-[0.18em] text-[var(--color-text)] flex items-center gap-2">
          <span className="text-[var(--color-tool-violet)]">02 /</span>
          Rank your top 3 differentials
        </h2>
        <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--color-text-faint)]">
          Most likely → least likely
        </span>
      </header>

      <p className="text-[13px] text-[var(--color-text-muted)] mb-4 leading-relaxed">
        แตะตัวเลือกด้านล่างเพื่อใส่ใน slot ถัดไป · ใช้ปุ่ม ↑ ↓ ปรับลำดับ ·
        ส่งเพื่อดู scored comparison
      </p>

      {/* Slots row · the 3 ranked positions */}
      <ol className="space-y-1.5 mb-4">
        {slots.map((name, i) => {
          const filled = name !== null;
          return (
            <li
              key={i}
              tabIndex={filled ? 0 : -1}
              onKeyDown={(e) => onSlotKeyDown(e, i)}
              className={`group flex items-center gap-2 rounded-md border px-3 py-2 transition-colors ${
                filled
                  ? 'border-[var(--color-tool-cyan)] bg-[rgba(90,204,230,0.06)]'
                  : 'border-dashed border-[var(--color-border)] bg-[var(--color-bg)]'
              }`}
              aria-label={`Rank ${i + 1}${name ? ` · ${name}` : ' · empty'}`}
            >
              <span
                className={`text-[11px] font-mono w-4 shrink-0 ${
                  filled ? 'text-[var(--color-tool-cyan)]' : 'text-[var(--color-text-faint)]'
                }`}
              >
                {i + 1}.
              </span>
              {filled ? (
                <>
                  <span className="text-sm text-[var(--color-text)] flex-1 min-w-0 truncate">
                    {name}
                  </span>
                  <div className="shrink-0 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => moveSlot(i, -1)}
                      disabled={i === 0}
                      className="w-7 h-7 rounded border border-[var(--color-border)] bg-[var(--color-surface-3)] text-[var(--color-text-muted)] hover:border-[var(--color-tool-cyan)] hover:text-[var(--color-tool-cyan)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors font-mono text-xs"
                      aria-label={`Move "${name}" up`}
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveSlot(i, 1)}
                      disabled={i === 2}
                      className="w-7 h-7 rounded border border-[var(--color-border)] bg-[var(--color-surface-3)] text-[var(--color-text-muted)] hover:border-[var(--color-tool-cyan)] hover:text-[var(--color-tool-cyan)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors font-mono text-xs"
                      aria-label={`Move "${name}" down`}
                      title="Move down"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => togglePick(name!)}
                      className="w-7 h-7 rounded border border-[var(--color-border)] bg-[var(--color-surface-3)] text-[var(--color-text-faint)] hover:border-[var(--color-tool-violet)] hover:text-[var(--color-tool-violet)] transition-colors font-mono text-xs"
                      aria-label={`Remove "${name}"`}
                      title="Remove"
                    >
                      ✕
                    </button>
                  </div>
                </>
              ) : (
                <span className="text-sm italic text-[var(--color-text-faint)] flex-1">
                  Tap an option below…
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {/* Option pool · 6 buttons */}
      <div className="mb-4">
        <div className="text-[11px] font-mono uppercase tracking-wider text-[var(--color-text-muted)] mb-2">
          Options ({options.length})
        </div>
        <div
          role="group"
          aria-label="DDx options"
          className="grid grid-cols-1 sm:grid-cols-2 gap-1.5"
        >
          {options.map((opt) => {
            const placedAt = slotIndexOf(opt.name);
            const placed = placedAt >= 0;
            return (
              <button
                key={opt.name}
                type="button"
                onClick={() => togglePick(opt.name)}
                disabled={!placed && filledCount >= 3}
                className={`text-left rounded-md border px-3 py-2 text-sm transition-colors flex items-center gap-2 min-w-0 ${
                  placed
                    ? 'border-[var(--color-tool-cyan)] bg-[rgba(90,204,230,0.12)] text-[var(--color-tool-cyan)]'
                    : 'border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] hover:border-[var(--color-border-bright)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-[var(--color-border)]'
                }`}
                aria-pressed={placed}
              >
                {placed && (
                  <span className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full border border-[var(--color-tool-cyan)] bg-[var(--color-bg)] text-[10px] font-mono">
                    {placedAt + 1}
                  </span>
                )}
                <span className="truncate flex-1">{opt.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <button
          type="button"
          onClick={armOrFire}
          disabled={!canSubmit}
          className={`imaging-btn ${
            confirming ? 'imaging-btn-violet' : 'imaging-btn-primary'
          } min-w-[180px] justify-center disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {confirming ? (
            <>
              <span aria-hidden>↓</span>
              Tap again to confirm
            </>
          ) : (
            <>
              Submit ranking
              <span aria-hidden>↓</span>
            </>
          )}
        </button>
        {filledCount > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="text-[11px] font-mono uppercase tracking-wider text-[var(--color-text-faint)] hover:text-[var(--color-tool-violet)] transition-colors"
          >
            Clear all
          </button>
        )}
        <span className="text-[11px] text-[var(--color-text-faint)] font-mono ml-auto">
          {filledCount}/3 ranked
        </span>
      </div>

      {/* Skip-ranker affordance */}
      <div className="mt-4 pt-3 border-t border-[var(--color-border)] flex">
        <button
          type="button"
          onClick={onSkip}
          className="text-[11px] sm:text-xs font-mono uppercase tracking-wider text-[var(--color-text-faint)] hover:text-[var(--color-tool-cyan)] transition-colors"
          title="Skip the ranking step and reveal expert findings"
        >
          Skip ranking · just reveal →
        </button>
      </div>
    </section>
  );
}
