// Tolerance grading for Norberg (hip angle) and VHS (Buchanan vertebral
// heart score) measurements made by students against an expert
// ground-truth value attached to the case.
//
// Tolerance buckets and thresholds are defensible from textbook
// inter-rater variability literature — NOT tightened arbitrarily to
// make scoring feel harder. The student should never feel that a
// 1.5°-off angle "failed" when published inter-observer SD is ~3°.
//
// Citations:
//   • Buchanan & Bücheler 1995 — Vertebral scale system to measure
//     canine heart size in radiographs. JAVMA 206(2):194-199. Original
//     VHS paper; reports inter-observer agreement within ~0.3 v for
//     trained readers, drifting to ~0.5 v for general practitioners.
//   • Litster & Buchanan 2000 — Vertebral scale system to measure
//     heart size in radiographs of cats. JAVMA 216(2):210-214. Feline
//     reference 7.5 ± 0.3 v, range 6.7–8.1 v.
//   • Smith G.K. et al. 1990 — Coxofemoral joint laxity from
//     distraction radiography. AJVR 51(12):1948-1953. Norberg angle
//     inter-observer SD ~2–3° on well-positioned VD pelves.
//   • Flückiger M. 2007 — Scoring radiographs for canine hip dysplasia,
//     EJCAP 17(2):135-140. Re-affirms BVA-style 105° / 100° thresholds.
//
// Bucket cut-offs follow a "1× SD = perfect, 2× SD = good, 3× SD = off,
// > 3× SD = needs review" pattern using the published reader SD for
// each measurement family.

// ─── Public types ──────────────────────────────────────────────────

export type Bucket = 'perfect' | 'good' | 'off' | 'review';

export type AngleScore = {
  bucket: Bucket;
  /** Signed delta (student − expected), in degrees. Positive = wider angle. */
  delta: number;
  /** Absolute delta in degrees, for display convenience. */
  absDelta: number;
  /** CSS color token for the bucket — matches lab UI tokens elsewhere. */
  tone: string;
  /** Short user-facing label, EN+TH mix to fit the rest of the lab UI. */
  label: string;
  /** Compact emoji glyph for tight readouts. */
  glyph: string;
  /** Tooltip-grade description with the threshold rationale. */
  description: string;
};

export type VHSScore = {
  bucket: Bucket;
  /** Signed delta (student − expected), in vertebra units. */
  delta: number;
  /** Absolute delta. */
  absDelta: number;
  tone: string;
  label: string;
  glyph: string;
  description: string;
  /** Student's measured VHS, echoed for convenience in the panel. */
  vhs: number;
  /** Expected VHS, echoed for convenience. */
  expected: number;
  /** Species-aware normal range, mostly for context strings. */
  normalRange?: { lo: number; hi: number; species: 'canine' | 'feline' };
};

// ─── Norberg scoring ───────────────────────────────────────────────

/**
 * Grade a student's Norberg angle against the expert's value.
 *
 * Thresholds (absolute degree delta):
 *   |Δ| ≤ 2°   → perfect  (within reader SD per Smith 1990)
 *   |Δ| ≤ 5°   → good     (≤ 2× SD; still clinically equivalent classification)
 *   |Δ| ≤ 10°  → off      (likely crosses a BVA threshold, worth reviewing)
 *   |Δ| > 10°  → review   (landmark mis-placement, redo step)
 */
export function scoreAngle(student: number, expected: number): AngleScore {
  const delta = round1(student - expected);
  const absDelta = Math.abs(delta);

  if (absDelta <= 2) {
    return {
      bucket: 'perfect',
      delta,
      absDelta,
      tone: '#7ee29a',
      label: 'Perfect · ตรงเป๊ะ',
      glyph: '✓',
      description: 'Within ±2° of expert — inside published reader SD (Smith 1990).',
    };
  }
  if (absDelta <= 5) {
    return {
      bucket: 'good',
      delta,
      absDelta,
      tone: '#7ec8ff',
      label: 'Good · เกือบตรง',
      glyph: '◎',
      description: 'Within ±5° — same BVA classification, minor landmark drift.',
    };
  }
  if (absDelta <= 10) {
    return {
      bucket: 'off',
      delta,
      absDelta,
      tone: '#b896ff',
      label: 'Off · เริ่มเพี้ยน',
      glyph: '△',
      description:
        'Within ±10° — likely crosses Normal/Borderline/Dysplastic threshold. ลอง drag จุดให้ใกล้ landmark อีกครั้ง',
    };
  }
  return {
    bucket: 'review',
    delta,
    absDelta,
    tone: '#ff8a8a',
    label: 'Needs review · ต้องดูใหม่',
    glyph: '✗',
    description:
      '> ±10° — landmark likely mis-placed. ตรวจว่าจุดอยู่ที่ center of femoral head + cranial-most acetabular rim จริงหรือไม่',
  };
}

// ─── VHS scoring ───────────────────────────────────────────────────

/**
 * Grade a student's VHS against the expert's value.
 *
 * Thresholds (absolute vertebra-unit delta):
 *   |Δ| ≤ 0.3 v → perfect (within Buchanan trained-reader SD)
 *   |Δ| ≤ 0.7 v → good    (within Litster 2× SD)
 *   |Δ| ≤ 1.5 v → off     (≈ 0.5 v above the species upper-limit window)
 *   |Δ| > 1.5 v → review  (likely landmark mis-placement)
 *
 * The thresholds are species-agnostic on delta — the species only
 * informs the displayed normal-range context, not the bucket cutoffs.
 */
export function scoreVHS(
  student: number,
  expected: number,
  species: 'canine' | 'feline' = 'canine',
): VHSScore {
  const delta = round2(student - expected);
  const absDelta = Math.abs(delta);
  const normalRange =
    species === 'feline'
      ? { lo: 6.7, hi: 8.1, species: 'feline' as const }
      : { lo: 8.5, hi: 10.5, species: 'canine' as const };

  const base = {
    delta,
    absDelta,
    vhs: round2(student),
    expected: round2(expected),
    normalRange,
  };

  if (absDelta <= 0.3) {
    return {
      ...base,
      bucket: 'perfect',
      tone: '#7ee29a',
      label: 'Perfect · ตรงเป๊ะ',
      glyph: '✓',
      description:
        'Within ±0.3 v — inside Buchanan trained-reader SD (Buchanan & Bücheler 1995).',
    };
  }
  if (absDelta <= 0.7) {
    return {
      ...base,
      bucket: 'good',
      tone: '#7ec8ff',
      label: 'Good · เกือบตรง',
      glyph: '◎',
      description:
        'Within ±0.7 v — same clinical bucket (normal vs cardiomegaly) for most species/breed combos.',
    };
  }
  if (absDelta <= 1.5) {
    return {
      ...base,
      bucket: 'off',
      tone: '#b896ff',
      label: 'Off · เริ่มเพี้ยน',
      glyph: '△',
      description:
        'Within ±1.5 v — likely the vertebra ruler or cardiac axis is mis-aligned. Recheck T4 cranial edge and long-axis bronchus base.',
    };
  }
  return {
    ...base,
    bucket: 'review',
    tone: '#ff8a8a',
    label: 'Needs review · ต้องดูใหม่',
    glyph: '✗',
    description:
      '> ±1.5 v — landmark likely mis-placed. Double-check vertebral ruler is along T4 body and long axis goes carina → apex.',
  };
}

// ─── helpers ───────────────────────────────────────────────────────

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
