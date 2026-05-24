'use client';
import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// OnboardingTour — 3-step coachmark tour for new visitors to the Imaging Lab.
//
// First-visit only (localStorage key `cuvi-tour-completed-v1`). Manual
// re-trigger is exposed via the HelpButton (floating ? in bottom-right) for
// users who want to revisit the tour later.
//
// Targets DOM elements via `data-tour="..."` attributes on the target. If a
// target is missing (offscreen route, conditional render), the step gracefully
// degrades to a centered coachmark with no arrow — never crashes the page.
//
// A11y:
//   - role="dialog" + aria-modal="true"
//   - focus moves to the primary CTA when the step opens
//   - Esc closes (counts as completed — we don't nag)
//   - click on backdrop closes
//   - respects prefers-reduced-motion (no slide/fade on entry)
// ─────────────────────────────────────────────────────────────────────────────

const TOUR_KEY = 'cuvi-tour-completed-v1';

const STEPS = [
  {
    id: 'sample-case',
    target: 'sample-case-cta',
    title: 'เปิด sample case',
    body: 'เริ่มจาก sample case — 16 cases CC-BY มาให้พร้อมแล้ว ไม่ต้องหา radiograph เอง',
    primary: 'ถัดไป',
    skip: 'ข้าม tour',
  },
  {
    id: 'wl-presets',
    target: 'dropzone',
    title: 'ใช้ W/L preset',
    body: 'ในหน้า viewer กด b/s/l เพื่อสลับ Bone / Soft / Lung preset · กด ? ดู shortcut ทั้งหมด',
    primary: 'ถัดไป',
    skip: 'ข้าม',
  },
  {
    id: 'measure',
    target: 'tool-tiles',
    title: 'วัดด้วย Norberg หรือ VHS',
    body: 'ลอง Norberg (hip dysplasia) หรือ VHS (heart size) — system ช่วยให้คะแนน auto พร้อม classification',
    primary: 'เริ่มเลย',
    skip: 'ข้าม',
  },
];

// Coachmark card dimensions used by the position calculator.
const CARD_W = 320;
const CARD_H_EST = 200; // estimated; used to keep cards on screen
const VIEWPORT_PADDING = 12;
const TARGET_GAP = 14;

/**
 * Compute coachmark position relative to the target rect.
 *
 * Strategy: try below the target first, fall back to above, fall back to
 * centered. If the target rect is off-screen or missing, return a centered
 * placement with `arrowless: true`.
 */
function computePlacement(targetRect, vw, vh) {
  if (!targetRect || targetRect.width === 0 || targetRect.height === 0) {
    return {
      left: Math.max(VIEWPORT_PADDING, (vw - CARD_W) / 2),
      top: Math.max(VIEWPORT_PADDING, (vh - CARD_H_EST) / 2),
      arrow: null,
      arrowless: true,
    };
  }

  // Off-screen → center on viewport.
  const offscreen =
    targetRect.bottom < 0 ||
    targetRect.top > vh ||
    targetRect.right < 0 ||
    targetRect.left > vw;
  if (offscreen) {
    return {
      left: Math.max(VIEWPORT_PADDING, (vw - CARD_W) / 2),
      top: Math.max(VIEWPORT_PADDING, (vh - CARD_H_EST) / 2),
      arrow: null,
      arrowless: true,
    };
  }

  // Prefer below the target if there's room.
  const spaceBelow = vh - targetRect.bottom - VIEWPORT_PADDING;
  const spaceAbove = targetRect.top - VIEWPORT_PADDING;

  // Horizontal: align card center to target center, clamp into viewport.
  const targetCenterX = targetRect.left + targetRect.width / 2;
  let left = targetCenterX - CARD_W / 2;
  left = Math.max(VIEWPORT_PADDING, Math.min(left, vw - CARD_W - VIEWPORT_PADDING));

  let top;
  let arrow; // 'up' = arrow points up (card is below target), 'down' = vice versa
  if (spaceBelow >= CARD_H_EST + TARGET_GAP) {
    top = targetRect.bottom + TARGET_GAP;
    arrow = 'up';
  } else if (spaceAbove >= CARD_H_EST + TARGET_GAP) {
    top = targetRect.top - CARD_H_EST - TARGET_GAP;
    arrow = 'down';
  } else {
    // Neither fits — pin to whichever has more room, allow scroll within card.
    if (spaceBelow >= spaceAbove) {
      top = targetRect.bottom + TARGET_GAP;
      arrow = 'up';
    } else {
      top = Math.max(VIEWPORT_PADDING, targetRect.top - CARD_H_EST - TARGET_GAP);
      arrow = 'down';
    }
  }

  // Arrow horizontal offset within the card — point at the target center.
  const arrowLeft = Math.max(
    18,
    Math.min(CARD_W - 18, targetCenterX - left)
  );

  return { left, top, arrow, arrowLeft, arrowless: false };
}

export default function OnboardingTour({ open, onClose, onComplete }) {
  const [stepIdx, setStepIdx] = useState(0);
  const [placement, setPlacement] = useState(null);
  const [targetRect, setTargetRect] = useState(null);
  const cardRef = useRef(null);
  const lastFocusRef = useRef(null);
  const reducedMotion = useReducedMotion();

  const step = STEPS[stepIdx];
  const isLast = stepIdx === STEPS.length - 1;

  // Locate the target element + measure its rect. Re-measure on window
  // resize/scroll so the coachmark follows. Falls back gracefully if the
  // target doesn't exist on the page.
  useLayoutEffect(() => {
    if (!open || !step) return;
    let raf;
    const measure = () => {
      const el =
        typeof document !== 'undefined'
          ? document.querySelector(`[data-tour="${step.target}"]`)
          : null;
      if (!el) {
        setTargetRect(null);
        setPlacement(computePlacement(null, window.innerWidth, window.innerHeight));
        return;
      }
      const rect = el.getBoundingClientRect();
      setTargetRect(rect);
      setPlacement(computePlacement(rect, window.innerWidth, window.innerHeight));
    };
    measure();
    const onChange = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    window.addEventListener('resize', onChange);
    window.addEventListener('scroll', onChange, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onChange);
      window.removeEventListener('scroll', onChange, true);
    };
  }, [open, step]);

  // Stable close handler — declared BEFORE the Esc-handler effect so React
  // Compiler's "no access before declaration" rule is satisfied. Tracks
  // onClose / onComplete in the dep array so identity changes are picked up.
  const handleClose = useCallback(
    (reason) => {
      try {
        localStorage.setItem(TOUR_KEY, '1');
      } catch {
        /* quota / disabled */
      }
      onClose?.(reason);
      if (reason !== 'escape' && reason !== 'backdrop' && reason !== 'skip') {
        onComplete?.();
      }
    },
    [onClose, onComplete]
  );

  // Esc-to-close + focus management.
  useEffect(() => {
    if (!open) return;
    lastFocusRef.current =
      typeof document !== 'undefined' ? document.activeElement : null;

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        handleClose('escape');
      } else if (e.key === 'Tab') {
        // Trap focus within the card so Tab cycles between primary + skip.
        const card = cardRef.current;
        if (!card) return;
        const focusables = card.querySelectorAll(
          'button, [href], [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });

    // Lock body scroll while tour is open so backdrop doesn't shift.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', onKey, { capture: true });
      document.body.style.overflow = prevOverflow;
      try {
        lastFocusRef.current?.focus?.();
      } catch {
        /* element gone */
      }
    };
  }, [open, handleClose]);

  // Move focus to the primary CTA whenever a new step opens. requestAnimationFrame
  // gives React + the layout effect time to mount the new card.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      const btn = cardRef.current?.querySelector('[data-tour-primary]');
      btn?.focus?.();
    });
    return () => cancelAnimationFrame(id);
  }, [open, stepIdx]);

  const next = useCallback(() => {
    if (isLast) {
      handleClose('complete');
      onComplete?.();
    } else {
      setStepIdx((i) => i + 1);
    }
  }, [isLast, handleClose, onComplete]);

  if (!open || !step || !placement) return null;

  // Spotlight rect — punched-out region around the target so it stays visible
  // through the backdrop dim. Only render if we have a valid rect.
  const spotlight = targetRect && !placement.arrowless ? targetRect : null;

  return (
    <div
      style={backdropStyle}
      onClick={() => handleClose('backdrop')}
      aria-hidden={false}
    >
      {/* Backdrop SVG with spotlight cutout via mask. Falls back to plain
          translucent overlay if there's no target (mask still works but
          adds no value). */}
      <svg
        style={{
          position: 'fixed',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
        aria-hidden="true"
      >
        <defs>
          <mask id="cuvi-tour-spotlight-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {spotlight && (
              <rect
                x={Math.max(0, spotlight.left - 6)}
                y={Math.max(0, spotlight.top - 6)}
                width={spotlight.width + 12}
                height={spotlight.height + 12}
                rx="8"
                ry="8"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.55)"
          mask="url(#cuvi-tour-spotlight-mask)"
        />
        {/* Cyan glow ring around the spotlight target — gives it a 'tap me' feel */}
        {spotlight && (
          <rect
            x={Math.max(0, spotlight.left - 6)}
            y={Math.max(0, spotlight.top - 6)}
            width={spotlight.width + 12}
            height={spotlight.height + 12}
            rx="8"
            ry="8"
            fill="none"
            stroke="var(--color-tool-cyan)"
            strokeWidth="1.5"
            opacity="0.6"
          />
        )}
      </svg>

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cuvi-tour-title"
        aria-describedby="cuvi-tour-body"
        onClick={(e) => e.stopPropagation()}
        style={{
          ...cardStyle,
          left: placement.left,
          top: placement.top,
          transition: reducedMotion ? 'none' : 'opacity 180ms ease-out',
        }}
      >
        {/* Arrow indicator — points at the target. CSS triangle via borders. */}
        {!placement.arrowless && placement.arrow && (
          <span
            aria-hidden="true"
            style={{
              ...arrowBase,
              ...(placement.arrow === 'up'
                ? { top: -8, left: placement.arrowLeft - 8 }
                : { bottom: -8, left: placement.arrowLeft - 8, transform: 'rotate(180deg)' }),
            }}
          />
        )}

        <div style={headerRowStyle}>
          <div style={progressDotsStyle} aria-label={`Step ${stepIdx + 1} of ${STEPS.length}`}>
            {STEPS.map((s, i) => (
              <span
                key={s.id}
                aria-hidden="true"
                style={{
                  ...progressDotStyle,
                  background:
                    i === stepIdx
                      ? 'var(--color-tool-cyan)'
                      : i < stepIdx
                      ? 'rgba(90,204,230,0.4)'
                      : 'rgba(255,255,255,0.18)',
                }}
              />
            ))}
            <span style={progressLabelStyle}>
              {stepIdx + 1} / {STEPS.length}
            </span>
          </div>
          <button
            type="button"
            onClick={() => handleClose('skip')}
            aria-label="ปิด tour"
            style={closeXStyle}
          >
            ✕
          </button>
        </div>

        <h2 id="cuvi-tour-title" style={titleStyle}>
          {step.title}
        </h2>
        <p id="cuvi-tour-body" style={bodyStyle}>
          {step.body}
        </p>

        <div style={actionsRowStyle}>
          <button
            type="button"
            onClick={() => handleClose('skip')}
            style={skipBtnStyle}
          >
            {step.skip}
          </button>
          <button
            type="button"
            onClick={next}
            data-tour-primary
            style={primaryBtnStyle}
          >
            {step.primary}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HelpButton — floating ? button in bottom-right. Lets returning visitors
// re-launch the tour anytime. Hidden while the tour is open to keep the
// stage clear.
// ─────────────────────────────────────────────────────────────────────────────
export function HelpButton({ onOpen, hidden }) {
  if (hidden) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="ทบทวน tour"
      title="ทบทวน tour"
      style={helpBtnStyle}
    >
      <span aria-hidden="true" style={{ fontSize: 16, fontWeight: 600, lineHeight: 1 }}>
        ?
      </span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook: tour state machine. Owns localStorage check + open/close handlers.
// LabHome consumes this so it can also expose a manual re-trigger.
// ─────────────────────────────────────────────────────────────────────────────
export function useOnboardingTour() {
  const [open, setOpen] = useState(false);

  // Auto-launch on first visit. Wait one tick so React paints the page first
  // (otherwise the tour appears before the target elements have rendered).
  useEffect(() => {
    let done = false;
    try {
      done = localStorage.getItem(TOUR_KEY) === '1';
    } catch {
      done = false;
    }
    if (!done) {
      const id = setTimeout(() => setOpen(true), 350);
      return () => clearTimeout(id);
    }
    return undefined;
  }, []);

  const openTour = useCallback(() => setOpen(true), []);
  const closeTour = useCallback(() => setOpen(false), []);

  return { open, openTour, closeTour };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reduced-motion hook — coachmark fade is skipped if the user prefers reduced
// motion. Cheap matchMedia listener.
// ─────────────────────────────────────────────────────────────────────────────
function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    onChange();
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles — inline style objects so the component doesn't depend on Tailwind
// utility availability outside the lab's globals.css token system.
// ─────────────────────────────────────────────────────────────────────────────

const backdropStyle = {
  position: 'fixed',
  inset: 0,
  zIndex: 90,
};

const cardStyle = {
  position: 'fixed',
  width: CARD_W,
  maxWidth: 'calc(100vw - 24px)',
  background: 'var(--color-surface-2)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border-bright)',
  borderRadius: 12,
  boxShadow: '0 18px 48px -16px rgba(0,0,0,0.6), 0 0 0 1px rgba(90,204,230,0.15)',
  padding: '18px 18px 16px',
  zIndex: 100,
  // Faint cyan glow border without using a keyframe — pure static effect.
  outline: '0px solid rgba(90,204,230,0.0)',
};

const arrowBase = {
  position: 'absolute',
  width: 0,
  height: 0,
  borderLeft: '8px solid transparent',
  borderRight: '8px solid transparent',
  borderBottom: '8px solid var(--color-surface-2)',
  filter: 'drop-shadow(0 -1px 0 rgba(255,255,255,0.14))',
};

const headerRowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 10,
};

const progressDotsStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const progressDotStyle = {
  width: 6,
  height: 6,
  borderRadius: 999,
  transition: 'background 200ms ease-out',
};

const progressLabelStyle = {
  marginLeft: 6,
  fontSize: 10,
  fontFamily: 'ui-monospace, monospace',
  letterSpacing: '0.08em',
  color: 'var(--color-text-faint)',
  textTransform: 'uppercase',
};

const closeXStyle = {
  width: 24,
  height: 24,
  borderRadius: 6,
  border: '1px solid var(--color-border)',
  background: 'transparent',
  color: 'var(--color-text-muted)',
  cursor: 'pointer',
  fontSize: 12,
  lineHeight: 1,
  padding: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const titleStyle = {
  fontSize: 16,
  fontWeight: 600,
  letterSpacing: '-0.01em',
  color: 'var(--color-text)',
  margin: '4px 0 6px',
};

const bodyStyle = {
  fontSize: 13.5,
  lineHeight: 1.55,
  color: 'var(--color-text-muted)',
  margin: '0 0 16px',
};

const actionsRowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
};

const skipBtnStyle = {
  background: 'transparent',
  border: '1px solid var(--color-border)',
  color: 'var(--color-text-muted)',
  borderRadius: 8,
  padding: '8px 12px',
  fontSize: 12.5,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const primaryBtnStyle = {
  background: 'var(--color-tool-cyan)',
  border: '1px solid var(--color-tool-cyan)',
  color: '#08090F',
  borderRadius: 8,
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  letterSpacing: '-0.005em',
};

const helpBtnStyle = {
  position: 'fixed',
  right: 16,
  bottom: 16,
  width: 40,
  height: 40,
  borderRadius: 999,
  background: 'var(--color-surface-2)',
  border: '1px solid var(--color-border-bright)',
  color: 'var(--color-text-muted)',
  cursor: 'pointer',
  zIndex: 80,
  boxShadow: '0 8px 24px -10px rgba(0,0,0,0.6)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'inherit',
};
