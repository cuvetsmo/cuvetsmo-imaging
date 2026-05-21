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
 *   - 0 files          → 'single' (caller should refuse anyway)
 *   - 1 file           → 'single'
 *   - 2 files          → 'side-by-side' (legacy behavior, two panes)
 *   - 3+ files         → 'stack' (one StackViewport, scroll through all)
 *
 * Mode is a hint; DicomViewport accepts it as a prop and the caller can
 * override (e.g. force side-by-side for a user-chosen multi-pane compare).
 */
export type ViewerMode = 'single' | 'stack' | 'side-by-side';
export function autoModeForFiles(count: number): ViewerMode {
  if (count <= 1) return 'single';
  if (count === 2) return 'side-by-side';
  return 'stack';
}
