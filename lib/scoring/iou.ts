// lib/scoring/iou.ts
//
// Intersection-over-Union scoring for 2D bounding boxes — the standard
// object-detection metric used by VOC, COCO and the Cornerstone Tools
// `BBoxROI` evaluation utility. Formula (Jaccard index):
//
//   IoU(A, B) = area(A ∩ B) / area(A ∪ B)
//             = inter / (|A| + |B| - inter)
//
// All boxes are normalized to [0, 1] in both axes (relative to the
// rendered viewport) so the metric is resolution-independent and stays
// consistent across responsive layouts.
//
// References:
// - Everingham et al. (2010) "The PASCAL VOC Challenge" §4.1
// - Lin et al. (2014) "Microsoft COCO" Appendix A · §IoU threshold @0.5
// - Common veterinary radiology AI literature uses IoU > 0.5 as a "hit"
//   (e.g. VetXRay 2025 dataset paper, Müller et al. canine cardiomegaly)
//
// Thresholds chosen for student-friendly UX (not detector evaluation):
//   IoU > 0.50  → hit    (green · "you found it")
//   IoU ≥ 0.20  → partial (violet · "in the right area")
//   IoU < 0.20  → miss   (red · "different region")
//
// These are deliberately more forgiving than the VOC 0.5 cutoff because
// (a) a single student-drawn rectangle has lower precision than a
// pretrained detector and (b) we're teaching localization intuition, not
// grading.

export type Box = {
  x: number;        // top-left x in [0, 1]
  y: number;        // top-left y in [0, 1]
  w: number;        // width  in (0, 1]
  h: number;        // height in (0, 1]
};

/**
 * Compute Intersection-over-Union between two axis-aligned boxes in
 * normalized [0, 1] coordinates.
 *
 * Returns 0 when boxes don't overlap or when either has zero area
 * (degenerate input — protects against NaN from a 0/0 union).
 */
export function iou(a: Box, b: Box): number {
  // Bail on degenerate input so callers never see NaN.
  if (a.w <= 0 || a.h <= 0 || b.w <= 0 || b.h <= 0) return 0;

  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);

  const interW = Math.max(0, x2 - x1);
  const interH = Math.max(0, y2 - y1);
  const inter = interW * interH;

  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

export type ScoreBucket = 'hit' | 'partial' | 'miss';

export type ScoreLabel = {
  bucket: ScoreBucket;
  tone: string;           // CSS color token reference for the headline
  ringClass: string;      // Tailwind arbitrary class for box border (drawn overlay)
  fillClass: string;      // Tailwind arbitrary class for box translucent fill
  headline: string;
  sub: string;
};

/**
 * Bucket an IoU value into one of three student-facing labels. Tones map
 * to the existing OHIF-dark CSS tokens so colors stay theme-consistent.
 *
 * Bucket thresholds documented above the iou() function — change them
 * there in lockstep so docs and code don't drift.
 */
export function scoreLabel(score: number): ScoreLabel {
  if (score > 0.5) {
    return {
      bucket: 'hit',
      tone: 'text-[var(--color-finalized)]',
      ringClass: 'border-[var(--color-finalized)]',
      fillClass: 'bg-[rgba(52,211,153,0.18)]',
      headline: 'Hit',
      sub: 'Box overlaps the expert region — nice spot.',
    };
  }
  if (score >= 0.2) {
    return {
      bucket: 'partial',
      tone: 'text-[var(--color-tool-violet)]',
      ringClass: 'border-[var(--color-tool-violet)]',
      fillClass: 'bg-[rgba(167,139,250,0.18)]',
      headline: 'In the right area',
      sub: 'Partial overlap — review the expert region to refine your eye.',
    };
  }
  return {
    bucket: 'miss',
    tone: 'text-[var(--color-active-red)]',
    ringClass: 'border-[var(--color-active-red)]',
    fillClass: 'bg-[rgba(255,77,109,0.18)]',
    headline: 'Different region',
    sub: 'Box is outside (or barely touching) the expert region. Compare and try another case.',
  };
}

/**
 * Clamp + normalize a box. Useful when two corner clicks come in any
 * order — we don't know which is top-left until we sort.
 */
export function normalizeBox(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): Box {
  const x = Math.max(0, Math.min(ax, bx));
  const y = Math.max(0, Math.min(ay, by));
  const w = Math.min(1 - x, Math.abs(bx - ax));
  const h = Math.min(1 - y, Math.abs(by - ay));
  return { x, y, w, h };
}
