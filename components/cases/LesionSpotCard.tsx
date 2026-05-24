'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  Suspense,
  lazy,
} from 'react';
import type { ImagingCase } from '@/lib/cases';
import { iou, normalizeBox, scoreLabel, type Box } from '@/lib/scoring/iou';

const DicomViewport = lazy(() => import('@/components/lab/DicomViewport.jsx'));

type Recall = NonNullable<ImagingCase['recall']>;
type LesionRegion = NonNullable<Recall['lesion_regions']>[number];

type Props = {
  caseMeta: Pick<ImagingCase, 'slug' | 'id'>;
  file: File | undefined;            // first DICOM file (single-view spotting only)
  fileViewName?: string;             // label like "Lateral"
  regions: LesionRegion[];           // expert ground truth (guaranteed non-empty)
  // Called when student submits — parent owns localStorage persistence.
  onSubmit: (result: {
    studentBox: Box;
    iou: number;
    submittedAt: string;
  }) => void;
  // Bail out of spotting mode and return to whatever the parent shows by
  // default (revealed compare view).
  onExit: () => void;
};

// Internal phases of this card's state machine. Lives only inside this
// component — parent only sees `mode === 'spotting'` vs not.
type Phase = 'drawing' | 'scored';

// Two-step click semantics. We support BOTH click-and-drag and
// two-corner-tap so a phone user (no real drag) can still place a box.
// State machine for the click-mode:
//   null     → first click awaiting
//   {x, y}   → second click awaiting · ghost rect previews live
type ClickAnchor = { x: number; y: number } | null;

// Keyboard nudge step (per arrow press) in normalized units. 1% feels
// roughly right vs single-pixel jitter on desktop.
const NUDGE_STEP = 0.01;

export function LesionSpotCard({
  caseMeta,
  file,
  fileViewName,
  regions,
  onSubmit,
  onExit,
}: Props) {
  const overlayRef = useRef<HTMLDivElement | null>(null);

  // The student's box in normalized [0, 1] coords. null until the second
  // corner is placed or a drag completes.
  const [studentBox, setStudentBox] = useState<Box | null>(null);
  const [anchor, setAnchor] = useState<ClickAnchor>(null);
  // Live cursor position (normalized) — used to draw a ghost rect from
  // the anchor until the student commits the second corner.
  const [hoverPt, setHoverPt] = useState<{ x: number; y: number } | null>(null);
  // True while a mouse/touch drag is in flight (mousedown → mousemove → mouseup).
  const dragStateRef = useRef<{ x: number; y: number } | null>(null);

  const [phase, setPhase] = useState<Phase>('drawing');
  const [confirming, setConfirming] = useState(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Scored breakdown — computed lazily on submit so we don't re-run IoU
  // on every drag frame. For multi-region cases we pick the BEST IoU
  // across all regions (best-match scoring), which mirrors how COCO
  // handles ground-truth association for a single prediction.
  const [scored, setScored] = useState<{
    iou: number;
    matchedRegion: LesionRegion;
  } | null>(null);

  // Cleanup timers / drag state on unmount so a remount doesn't inherit
  // a stale "confirming" arming.
  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, []);

  // ── coordinate helpers ──
  // Convert a pointer event into normalized [0, 1] coords relative to
  // the overlay's bounding box. Clamps so out-of-bounds clicks (e.g.
  // when the DICOM viewport letterboxes a portrait image) still land
  // on a valid in-image point.
  const ptFromEvent = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const el = overlayRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      return { x, y };
    },
    [],
  );

  // ── interaction handlers ──
  // Mouse / touch flow:
  //   pointerdown          → arm drag
  //   pointermove (drag)   → live ghost
  //   pointerup (moved >2% in either axis) → commit drag-box
  //   pointerup (no real movement) → treat as a tap-click (anchor or commit)
  const TAP_THRESHOLD = 0.02;

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (phase !== 'drawing') return;
      const pt = ptFromEvent(e.clientX, e.clientY);
      if (!pt) return;
      // Begin a drag candidate — we'll decide on pointerup whether the
      // user actually dragged or just tapped in place.
      dragStateRef.current = pt;
      // Capture pointer so leaving the overlay during drag still gets
      // pointermove / pointerup.
      (e.currentTarget as HTMLDivElement).setPointerCapture?.(e.pointerId);
    },
    [phase, ptFromEvent],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (phase !== 'drawing') return;
      const pt = ptFromEvent(e.clientX, e.clientY);
      if (!pt) return;
      setHoverPt(pt);
      const start = dragStateRef.current;
      if (start) {
        const dx = Math.abs(pt.x - start.x);
        const dy = Math.abs(pt.y - start.y);
        if (dx > TAP_THRESHOLD || dy > TAP_THRESHOLD) {
          // Show live drag-rect; we won't commit until pointerup.
          setStudentBox(normalizeBox(start.x, start.y, pt.x, pt.y));
          setAnchor(null); // drag wins over tap-anchor
        }
      }
    },
    [phase, ptFromEvent],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (phase !== 'drawing') return;
      const pt = ptFromEvent(e.clientX, e.clientY);
      const start = dragStateRef.current;
      dragStateRef.current = null;
      if (!pt) return;

      if (start) {
        const dx = Math.abs(pt.x - start.x);
        const dy = Math.abs(pt.y - start.y);
        if (dx > TAP_THRESHOLD || dy > TAP_THRESHOLD) {
          // Real drag — commit the box.
          setStudentBox(normalizeBox(start.x, start.y, pt.x, pt.y));
          setAnchor(null);
          return;
        }
      }

      // Tap path (no real drag). If we already have an anchor, this is
      // the second corner — commit. Otherwise this is the first corner.
      if (anchor) {
        setStudentBox(normalizeBox(anchor.x, anchor.y, pt.x, pt.y));
        setAnchor(null);
      } else {
        setAnchor(pt);
        setStudentBox(null);
      }
    },
    [phase, ptFromEvent, anchor],
  );

  // Keyboard nudge + clear. When the overlay is focused, arrow keys
  // move the whole box by NUDGE_STEP; Shift+arrow grows/shrinks. Escape
  // clears the current box and anchor.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (phase !== 'drawing') return;
      if (e.key === 'Escape') {
        setStudentBox(null);
        setAnchor(null);
        setHoverPt(null);
        return;
      }
      if (!studentBox) return;
      // arrow keys → translate; shift+arrow → resize from bottom-right
      const shift = e.shiftKey;
      let { x, y, w, h } = studentBox;
      let handled = true;
      switch (e.key) {
        case 'ArrowUp':    if (shift) h = Math.max(0.01, h - NUDGE_STEP); else y = Math.max(0, y - NUDGE_STEP); break;
        case 'ArrowDown':  if (shift) h = Math.min(1 - y, h + NUDGE_STEP); else y = Math.min(1 - h, y + NUDGE_STEP); break;
        case 'ArrowLeft':  if (shift) w = Math.max(0.01, w - NUDGE_STEP); else x = Math.max(0, x - NUDGE_STEP); break;
        case 'ArrowRight': if (shift) w = Math.min(1 - x, w + NUDGE_STEP); else x = Math.min(1 - w, x + NUDGE_STEP); break;
        default: handled = false;
      }
      if (handled) {
        e.preventDefault();
        setStudentBox({ x, y, w, h });
      }
    },
    [phase, studentBox],
  );

  const clearBox = useCallback(() => {
    setStudentBox(null);
    setAnchor(null);
    setHoverPt(null);
    if (confirming) setConfirming(false);
  }, [confirming]);

  // ── submit (confirm-first) ──
  const canSubmit = phase === 'drawing' && !!studentBox && studentBox.w > 0 && studentBox.h > 0;

  const armOrFire = useCallback(() => {
    if (!canSubmit || !studentBox) return;
    if (confirming) {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      setConfirming(false);
      // Find best-matching expert region (highest IoU).
      let best = { iou: -Infinity, region: regions[0] };
      for (const r of regions) {
        const v = iou(studentBox, r.box);
        if (v > best.iou) best = { iou: v, region: r };
      }
      const finalIou = Math.max(0, best.iou);
      setScored({ iou: finalIou, matchedRegion: best.region });
      setPhase('scored');
      onSubmit({
        studentBox,
        iou: finalIou,
        submittedAt: new Date().toISOString(),
      });
      return;
    }
    setConfirming(true);
    confirmTimerRef.current = setTimeout(() => setConfirming(false), 4000);
  }, [canSubmit, confirming, studentBox, regions, onSubmit]);

  // Disarm confirm whenever the box changes — student is still adjusting.
  // queueMicrotask defers the setState past React's "no setState sync in
  // effect" guard. Behavior is unchanged — the confirm pill is dismissed
  // one microtask later, well before the next paint.
  useEffect(() => {
    if (confirming) {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      queueMicrotask(() => setConfirming(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentBox?.x, studentBox?.y, studentBox?.w, studentBox?.h]);

  // ── visual derivations ──
  // Ghost preview rectangle from anchor → hoverPt (during click-mode).
  const ghostRect = useMemo<Box | null>(() => {
    if (phase !== 'drawing') return null;
    if (!anchor || !hoverPt) return null;
    return normalizeBox(anchor.x, anchor.y, hoverPt.x, hoverPt.y);
  }, [phase, anchor, hoverPt]);

  const scoreLabelData = useMemo(() => {
    if (!scored) return null;
    return scoreLabel(scored.iou);
  }, [scored]);

  // ── render ──
  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 mb-4">
      <header className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-[13px] font-mono uppercase tracking-[0.18em] text-[var(--color-text)] flex items-center gap-2">
          <span className="text-[var(--color-tool-violet)]">📍 /</span>
          {phase === 'drawing' ? 'Spot the finding' : 'Spot the finding · scored'}
        </h2>
        <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--color-text-faint)]">
          {phase === 'drawing'
            ? 'Click two corners · or drag to draw'
            : `${Math.round((scored?.iou ?? 0) * 100)}% IoU`}
        </span>
      </header>

      {phase === 'drawing' && (
        <p className="text-[13px] text-[var(--color-text-muted)] mb-3 leading-relaxed">
          วงสี่เหลี่ยมรอบบริเวณที่คิดว่ามี lesion · แตะมุมแรกแล้วแตะมุมที่สอง
          หรือลาก mouse/finger ตรง ๆ ก็ได้ · กด Escape เพื่อเริ่มใหม่
        </p>
      )}

      {/* Viewer + interactive overlay. The overlay div is sized via
          absolute inset-0 over the viewer so its bounding box matches
          the rendered image area. We use pointer events (not separate
          mouse/touch) so the same code path serves desktop + mobile. */}
      <div className="relative rounded-md border border-[var(--color-border)] bg-[var(--color-surface-3)] overflow-hidden mb-4">
        {file ? (
          <Suspense
            fallback={
              <div className="aspect-[4/3] flex items-center justify-center text-sm text-[var(--color-text-muted)]">
                Loading viewer…
              </div>
            }
          >
            <div className="px-2 py-1.5 text-[11px] font-mono text-[var(--color-text-muted)] border-b border-[var(--color-border)] flex items-center justify-between">
              <span>
                {fileViewName ?? 'View 1'}
                <span className="text-[var(--color-text-faint)] mx-1.5">·</span>
                Spot mode
              </span>
              {phase === 'drawing' && studentBox && (
                <span className="text-[10px] font-mono text-[var(--color-text-faint)]">
                  Box {Math.round(studentBox.w * 100)}×{Math.round(studentBox.h * 100)}%
                </span>
              )}
            </div>
            <div className="relative">
              <DicomViewport file={file} caseId={caseMeta.id} syncEnabled={false} />
              {/* Interactive overlay — captures pointer + keyboard. Sits
                  on top of the canvas without preventing pointer-events
                  on the viewer itself unless we're in this mode. */}
              <div
                ref={overlayRef}
                role="application"
                aria-label="Lesion spotting overlay — click two corners or drag to draw a box"
                tabIndex={0}
                onPointerDown={phase === 'drawing' ? onPointerDown : undefined}
                onPointerMove={phase === 'drawing' ? onPointerMove : undefined}
                onPointerUp={phase === 'drawing' ? onPointerUp : undefined}
                onKeyDown={onKeyDown}
                style={{ touchAction: 'none' }}
                className={`absolute inset-0 ${
                  phase === 'drawing'
                    ? 'cursor-crosshair focus:outline-none focus:ring-1 focus:ring-[var(--color-tool-cyan)]'
                    : 'pointer-events-none'
                }`}
              >
                {/* Anchor dot — first tap marker */}
                {phase === 'drawing' && anchor && !studentBox && (
                  <div
                    aria-hidden
                    className="absolute w-3 h-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--color-tool-cyan)] bg-[var(--color-bg)]"
                    style={{ left: `${anchor.x * 100}%`, top: `${anchor.y * 100}%` }}
                  />
                )}

                {/* Ghost rect — live preview between anchor and cursor */}
                {ghostRect && (
                  <div
                    aria-hidden
                    className="absolute border border-dashed border-[var(--color-tool-cyan)]/70 bg-[rgba(90,204,230,0.06)]"
                    style={{
                      left: `${ghostRect.x * 100}%`,
                      top: `${ghostRect.y * 100}%`,
                      width: `${ghostRect.w * 100}%`,
                      height: `${ghostRect.h * 100}%`,
                    }}
                  />
                )}

                {/* Committed student box — drawn during draw + scored */}
                {studentBox && (
                  <div
                    aria-label="Your box"
                    className={`absolute border-2 ${
                      phase === 'scored' && scoreLabelData
                        ? `${scoreLabelData.ringClass} ${scoreLabelData.fillClass}`
                        : 'border-[var(--color-tool-cyan)] bg-[rgba(90,204,230,0.10)]'
                    }`}
                    style={{
                      left: `${studentBox.x * 100}%`,
                      top: `${studentBox.y * 100}%`,
                      width: `${studentBox.w * 100}%`,
                      height: `${studentBox.h * 100}%`,
                    }}
                  >
                    <span className="absolute -top-5 left-0 text-[10px] font-mono uppercase tracking-wider text-[var(--color-tool-cyan)] bg-[var(--color-bg)]/80 px-1 rounded">
                      You
                    </span>
                  </div>
                )}

                {/* Expert region(s) — only revealed in scored phase */}
                {phase === 'scored' &&
                  regions.map((r, i) => (
                    <div
                      key={i}
                      aria-label={`Expert region: ${r.label}`}
                      className="absolute border-2 border-dashed border-[var(--color-finalized)] bg-[rgba(52,211,153,0.10)]"
                      style={{
                        left: `${r.box.x * 100}%`,
                        top: `${r.box.y * 100}%`,
                        width: `${r.box.w * 100}%`,
                        height: `${r.box.h * 100}%`,
                      }}
                    >
                      <span className="absolute -top-5 right-0 text-[10px] font-mono uppercase tracking-wider text-[var(--color-finalized)] bg-[var(--color-bg)]/80 px-1 rounded">
                        Expert · {r.label}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          </Suspense>
        ) : (
          <div className="aspect-[4/3] flex items-center justify-center text-sm text-[var(--color-text-muted)]">
            No image available for spotting.
          </div>
        )}
      </div>

      {/* Scored phase — IoU headline + region hint */}
      {phase === 'scored' && scored && scoreLabelData && (
        <div className="mb-4 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
          <div className="flex items-baseline justify-between gap-2 mb-1 flex-wrap">
            <span className={`text-[13px] font-mono uppercase tracking-[0.18em] ${scoreLabelData.tone}`}>
              {scoreLabelData.headline} · IoU {scored.iou.toFixed(2)}
            </span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-text-faint)]">
              matched: {scored.matchedRegion.label}
            </span>
          </div>
          <p className="text-[12px] text-[var(--color-text-muted)] leading-relaxed">
            {scoreLabelData.sub}
          </p>
          {scored.matchedRegion.hint && (
            <p className="text-[12px] text-[var(--color-text)] leading-relaxed mt-2 pt-2 border-t border-[var(--color-border)]">
              <strong className="text-[var(--color-text-muted)] font-mono text-[10px] uppercase tracking-wider mr-2">
                Hint
              </strong>
              {scored.matchedRegion.hint}
            </p>
          )}
          <p className="mt-2 text-[10px] font-mono text-[var(--color-text-faint)] leading-relaxed">
            scoring: IoU &gt; 0.5 hit · 0.2–0.5 partial · &lt; 0.2 miss
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3 pt-1">
        {phase === 'drawing' ? (
          <>
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
                  Submit my finding
                  <span aria-hidden>↓</span>
                </>
              )}
            </button>
            {studentBox && (
              <button
                type="button"
                onClick={clearBox}
                className="text-[11px] font-mono uppercase tracking-wider text-[var(--color-text-faint)] hover:text-[var(--color-tool-violet)] transition-colors"
              >
                Clear box
              </button>
            )}
            <span className="text-[11px] text-[var(--color-text-faint)] font-mono ml-auto">
              {studentBox
                ? 'Arrow keys nudge · Shift+Arrow resize'
                : anchor
                  ? 'Tap second corner…'
                  : 'Tap first corner or drag'}
            </span>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onExit}
              className="imaging-btn imaging-btn-primary min-w-[180px] justify-center"
            >
              Back to compare
              <span aria-hidden>↑</span>
            </button>
          </>
        )}
      </div>

      {/* Bail-out (drawing phase only — once scored we already show the
          Back to compare button as primary CTA above) */}
      {phase === 'drawing' && (
        <div className="mt-4 pt-3 border-t border-[var(--color-border)] flex">
          <button
            type="button"
            onClick={onExit}
            className="text-[11px] sm:text-xs font-mono uppercase tracking-wider text-[var(--color-text-faint)] hover:text-[var(--color-tool-cyan)] transition-colors"
            title="Skip the spotting step and go back to the compare view"
          >
            Skip spotting · back to compare →
          </button>
        </div>
      )}
    </section>
  );
}
