// Stack-scroll helpers — Phase 5 (Agent ⓐ).
//
// Pure utilities that the DicomViewport's stack-mode code calls. Keeps the
// view file from drifting toward 1k+ lines and gives a single place to tune
// the touch threshold + key bindings if Palm asks for adjustments.
//
// No imports from Cornerstone3D here — these are framework-agnostic so the
// helpers stay tree-shake friendly and easy to unit-test in isolation.

/**
 * Pixels of finger travel that count as ONE slice. Tuned at 18 px which
 * is roughly half a thumb-tap height on a 375 px mobile portrait — small
 * enough to feel responsive when paging through a 200-slice CT, large
 * enough that a stray pointer wobble doesn't flip slices accidentally.
 *
 * Threshold is measured against `clientY` deltas (CSS pixels). Sign:
 * positive deltaY = finger moved DOWN the screen = NEXT slice (matches
 * vertical-scroll mental model: drag content down to reveal what's "below").
 */
export const TOUCH_SLICE_THRESHOLD_PX = 18;

/**
 * Page jump amount for PageUp / PageDown. 10 is the radiology-PACS
 * convention (OHIF, Synapse, Centricity) — small enough to skim, large
 * enough to traverse a ~50-slice C-spine in a few keystrokes.
 */
export const PAGE_JUMP = 10;

/** Result of applying a key event to a stack. `null` = no-op, otherwise the new index. */
export type StackKeyResult = number | null;

/**
 * Clamp a candidate slice index into the valid `[0, total-1]` window.
 * Returns -1 for an empty stack so callers can short-circuit cleanly.
 */
export function clampIndex(idx: number, total: number): number {
  if (!Number.isFinite(idx) || total <= 0) return -1;
  if (idx < 0) return 0;
  if (idx >= total) return total - 1;
  return Math.floor(idx);
}

/**
 * Format a 1-based "slice N / total" indicator. 1-based because that's
 * how radiologists talk about slices — internally the index is 0-based.
 *
 * Returns null when the stack is empty so the caller can hide the
 * indicator without juggling a "0 / 0" placeholder.
 */
export function formatSlicePos(idx: number, total: number): string | null {
  if (total <= 0) return null;
  const safe = clampIndex(idx, total);
  return `${safe + 1} / ${total}`;
}

/**
 * Map a keyboard event to a new slice index. Pure function — caller is
 * responsible for actually calling `setImageIdIndex`.
 *
 * Bindings (radiology PACS convention):
 *   ↓ / →  / Space            → next slice
 *   ↑ / ←  / Shift+Space      → previous slice
 *   PgDn                      → +10
 *   PgUp                      → -10
 *   Home                      → 0
 *   End                       → total-1
 *
 * Returns `null` when the key is not a stack-scroll binding so the caller
 * can fall through to other handlers without preventDefault.
 */
export function indexFromKey(
  key: string,
  shiftKey: boolean,
  currentIdx: number,
  total: number,
): StackKeyResult {
  if (total <= 1) return null; // no stack to scroll
  // Normalise once — most browsers report capitalised "ArrowDown".
  const k = key;
  if (k === 'ArrowDown' || k === 'ArrowRight') {
    return clampIndex(currentIdx + 1, total);
  }
  if (k === 'ArrowUp' || k === 'ArrowLeft') {
    return clampIndex(currentIdx - 1, total);
  }
  if (k === 'PageDown') {
    return clampIndex(currentIdx + PAGE_JUMP, total);
  }
  if (k === 'PageUp') {
    return clampIndex(currentIdx - PAGE_JUMP, total);
  }
  if (k === 'Home') {
    return 0;
  }
  if (k === 'End') {
    return total - 1;
  }
  // Space = next, Shift+Space = previous. Matches OHIF / many PACS.
  if (k === ' ' || k === 'Spacebar') {
    return clampIndex(currentIdx + (shiftKey ? -1 : 1), total);
  }
  return null;
}

/**
 * Translate a Y-axis pointer travel distance into a signed slice delta.
 * Positive return = move forward (toward larger index), negative =
 * backward. Returns 0 below the threshold so we don't over-fire while
 * a fingertip is just resting.
 *
 * Caller pattern: accumulate `event.movementY` (or deltas from a fixed
 * start point) and feed the total into this function each pointermove,
 * THEN subtract the consumed pixels from the accumulator so a long
 * gesture produces multiple slice steps without re-zeroing.
 */
export function sliceDeltaFromTouch(travelPx: number): number {
  const abs = Math.abs(travelPx);
  if (abs < TOUCH_SLICE_THRESHOLD_PX) return 0;
  const sign = travelPx > 0 ? 1 : -1;
  return sign * Math.floor(abs / TOUCH_SLICE_THRESHOLD_PX);
}

/**
 * Resolve the auto-mode for a list of files. Used by LabHome to route a
 * `onOpenStudy(study)` callback through to the right viewer state:
 *
 *   - 0 files                  → 'single' (caller should refuse anyway)
 *   - 1 file                   → 'single'
 *   - 2 files                  → 'side-by-side' (legacy behavior, two panes)
 *   - 3+ files                 → 'stack' (one StackViewport, scroll through all)
 *
 * `side-by-side-stack` is NOT auto-routed by file count — it requires the
 * caller to opt in explicitly (typically because the study has two real
 * series that the user wants to scroll synchronously). See
 * `detectSyncCompareCandidate` for the study-shape check.
 *
 * Mode is a hint; DicomViewport accepts it as a prop and the caller can
 * override (e.g. force side-by-side for a user-chosen multi-pane compare).
 */
export type ViewerMode = 'single' | 'stack' | 'side-by-side' | 'side-by-side-stack';
export function autoModeForFiles(count: number): ViewerMode {
  if (count <= 1) return 'single';
  if (count === 2) return 'side-by-side';
  return 'stack';
}

/**
 * Map a slice index from one stack length to another. Used by the
 * side-by-side-stack sync wire so a 36-slice ↔ 40-slice pair can still
 * scroll together — left pane at slice 18/36 maps to right pane at
 * slice 20/40 (same fractional position through the volume).
 *
 * For equal counts this is the identity. For zero / negative totals it
 * returns 0 (defensive — the caller should have bailed already).
 */
export function proportionalSliceIndex(
  srcIdx: number,
  srcTotal: number,
  destTotal: number,
): number {
  if (destTotal <= 0) return 0;
  if (srcTotal <= 0) return 0;
  if (srcTotal === destTotal) return clampIndex(srcIdx, destTotal);
  // Use the midpoint of the source slice's "bucket" so 0→0 and last→last
  // stay anchored exactly, with proportional spread in between.
  const frac = (srcIdx + 0.5) / srcTotal;
  return clampIndex(Math.floor(frac * destTotal), destTotal);
}

/**
 * Detect whether a Study is a good candidate for the sync-compare workflow.
 * Returns `{ leftSeries, rightSeries }` (the two longest series of the
 * study, in declared order) when the study has at least 2 series with each
 * having 3+ instances AND the slice counts are within a 30% tolerance of
 * each other (so we don't try to "compare" a 200-slice CT against a single
 * scout view).
 *
 * The 30% tolerance is generous on purpose — real-world matched-pair CTs
 * (pre-/post-contrast on the same patient) drift by a slice or two due to
 * breath-hold differences, so a strict equality check would miss valid
 * pairs. Tightening this later is cheap if false-positives bite.
 *
 * Returns `null` when no valid pair exists. The caller (LabHome) uses this
 * to decide whether to expose the "🔗 Compare 2 series" CTA.
 */
export interface SyncCompareCandidate<S> {
  leftSeries: S;
  rightSeries: S;
}

export function detectSyncCompareCandidate<S extends { instances?: unknown[] }>(
  study: { series?: S[] } | null | undefined,
): SyncCompareCandidate<S> | null {
  const list = study?.series || [];
  // Need 2+ series of >2 instances each.
  const eligible = list.filter((s) => (s.instances?.length || 0) >= 3);
  if (eligible.length < 2) return null;
  // Take the two LONGEST series (descending by instance count, stable
  // tie-break via original index). Avoids picking a 3-slice scout when a
  // 4th meaningful series exists.
  const sorted = [...eligible].sort(
    (a, b) => (b.instances?.length || 0) - (a.instances?.length || 0),
  );
  const left = sorted[0];
  const right = sorted[1];
  const lCount = left.instances?.length || 0;
  const rCount = right.instances?.length || 0;
  if (lCount === 0 || rCount === 0) return null;
  // Tolerance: |Δ| / max <= 0.30. Symmetric so order doesn't matter.
  const ratio = Math.abs(lCount - rCount) / Math.max(lCount, rCount);
  if (ratio > 0.30) return null;
  return { leftSeries: left, rightSeries: right };
}
