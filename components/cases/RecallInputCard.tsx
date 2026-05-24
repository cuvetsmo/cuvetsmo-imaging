'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

type Confidence = 1 | 2 | 3 | 4 | 5;

type Props = {
  notes: string;
  onNotesChange: (next: string) => void;
  confidence: Confidence;
  onConfidenceChange: (next: Confidence) => void;
  onReveal: () => void;
};

const CONFIDENCE_LABELS: Record<Confidence, string> = {
  1: 'Guess',
  2: 'Unsure',
  3: 'Maybe',
  4: 'Likely',
  5: 'Very sure',
};

const PROMPT_HINTS = [
  '• What do you see? (bone, soft tissue, lung, abdomen…)',
  '• Where is it? (location, distribution, laterality)',
  '• How abnormal is it? (mild · moderate · severe)',
  '• Your top 1–2 differentials?',
];

export function RecallInputCard({
  notes,
  onNotesChange,
  confidence,
  onConfidenceChange,
  onReveal,
}: Props) {
  // Two-step confirm pattern (mirrors LabHome reset semantics). First
  // click arms the button → second click within 4s actually reveals. Auto
  // disarms so the student can't be caught mid-thought.
  const [confirming, setConfirming] = useState(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Autofocus on mount so the student starts typing immediately.
  useEffect(() => {
    // Small delay so mobile keyboards don't pop up underneath the
    // viewer on first render (which would push content around).
    const t = setTimeout(() => textareaRef.current?.focus({ preventScroll: true }), 100);
    return () => clearTimeout(t);
  }, []);

  const armOrFire = useCallback(() => {
    if (confirming) {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      setConfirming(false);
      onReveal();
      return;
    }
    setConfirming(true);
    confirmTimerRef.current = setTimeout(() => setConfirming(false), 4000);
  }, [confirming, onReveal]);

  // Cleanup any pending disarm timer on unmount.
  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, []);

  // Cmd/Ctrl+Enter while focused in the textarea triggers reveal (via the
  // same arm/fire flow, so accidental keypress still requires a second
  // confirmation step).
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        armOrFire();
      }
    },
    [armOrFire],
  );

  const wordCount = notes.trim().length === 0 ? 0 : notes.trim().split(/\s+/).length;

  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
      <header className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-[13px] font-mono uppercase tracking-[0.18em] text-[var(--color-text)] flex items-center gap-2">
          <span className="text-[var(--color-tool-violet)]">01 /</span>
          What do you see?
        </h2>
        <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--color-text-faint)]">
          Active recall · ดูภาพแล้วเดาก่อนเปิดเฉลย
        </span>
      </header>

      {/* Prompt hints — collapse on mobile, always visible at sm+ */}
      <details className="mb-3 group" open>
        <summary className="cursor-pointer text-[11px] font-mono uppercase tracking-wider text-[var(--color-text-muted)] hover:text-[var(--color-tool-cyan)] list-none flex items-center gap-1.5 select-none">
          <span aria-hidden className="transition-transform group-open:rotate-90 inline-block text-[var(--color-text-faint)]">›</span>
          Reading checklist
        </summary>
        <ul className="mt-2 space-y-1 text-[12px] text-[var(--color-text-muted)] leading-relaxed pl-4">
          {PROMPT_HINTS.map((h, i) => (
            <li key={i}>{h}</li>
          ))}
        </ul>
      </details>

      <textarea
        ref={textareaRef}
        value={notes}
        onChange={(e) => onNotesChange(e.target.value)}
        onKeyDown={onKeyDown}
        rows={5}
        placeholder="Type your findings here. ไม่ต้องเป็นประโยคสมบูรณ์ — bullet list ก็ได้"
        className="w-full resize-y rounded-md border border-[var(--color-border-bright)] bg-[var(--color-bg)] px-3 py-2.5 text-[14px] text-[var(--color-text)] placeholder:text-[var(--color-text-faint)] focus:outline-none focus:border-[var(--color-tool-cyan)] focus:ring-0 transition-colors leading-relaxed"
        spellCheck={false}
        aria-label="Your findings for this case"
      />

      <div className="mt-1 text-[10px] font-mono text-[var(--color-text-faint)] text-right">
        {wordCount} words
      </div>

      {/* Confidence slider — 5-step segmented control. More tactile than
          a real <input type="range"> at this granularity and gives instant
          visual feedback of the chosen level. */}
      <div className="mt-4">
        <div className="flex items-baseline justify-between mb-1.5">
          <label
            htmlFor="confidence-group"
            className="text-[11px] font-mono uppercase tracking-wider text-[var(--color-text-muted)]"
          >
            Confidence
          </label>
          <span className="text-[11px] font-mono text-[var(--color-tool-cyan)]">
            {confidence}/5 · {CONFIDENCE_LABELS[confidence]}
          </span>
        </div>
        <div
          id="confidence-group"
          role="radiogroup"
          aria-label="How confident are you?"
          className="grid grid-cols-5 gap-1.5"
        >
          {([1, 2, 3, 4, 5] as Confidence[]).map((n) => {
            const active = n <= confidence;
            return (
              <button
                key={n}
                role="radio"
                aria-checked={confidence === n}
                onClick={() => onConfidenceChange(n)}
                // Phase 9: h-9 (36px) → h-11 (44px) so the 5-segment
                // confidence picker meets WCAG-AAA touch floor. The pill
                // grid spreads to use full width on mobile so each cell
                // is ~56-60px wide × 44px tall — visibly tappable.
                className={`relative h-11 rounded-md border text-xs font-mono transition-all ${
                  active
                    ? 'border-[var(--color-tool-cyan)] bg-[rgba(90,204,230,0.12)] text-[var(--color-tool-cyan)]'
                    : 'border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text-faint)] hover:border-[var(--color-border-bright)] hover:text-[var(--color-text-muted)]'
                }`}
                aria-label={`${n} - ${CONFIDENCE_LABELS[n]}`}
              >
                {n}
              </button>
            );
          })}
        </div>
      </div>

      {/* Reveal CTA · confirm-first */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={armOrFire}
          className={`imaging-btn ${
            confirming ? 'imaging-btn-violet' : 'imaging-btn-primary'
          } min-w-[180px] justify-center`}
        >
          {confirming ? (
            <>
              <span aria-hidden>↓</span>
              Tap again to confirm
            </>
          ) : (
            <>
              Reveal expert answer
              <span aria-hidden>↓</span>
            </>
          )}
        </button>
        <span className="text-[11px] text-[var(--color-text-faint)] font-mono">
          ⌘/Ctrl + Enter shortcut
        </span>
      </div>
    </section>
  );
}
