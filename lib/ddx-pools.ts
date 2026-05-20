// Distractor pools + deterministic shuffler for the DDx Ranker workflow.
//
// Given a case's expert DDx (`recall.ddx`), we surface up to 3 "correct"
// options (ranked by probability) plus 2-3 plausible-but-wrong
// distractors drawn from a body-part-scoped pool. The full set is
// shuffled with a per-case seed so the option order is stable across
// reloads but different per case (no "always position 1" bias).
//
// Owned by CaseDetailView / DDxRankerCard only. Read-only for everyone
// else — pools are a UX surface, not authoritative data.

import type { ImagingCase } from "./cases";

// ── ranked DDx (expert truth) ──────────────────────────────────────────
// Order is "most likely → least likely". We surface up to 3.
type ExpertDDx = NonNullable<ImagingCase["recall"]>["ddx"][number];

const PROB_WEIGHT: Record<NonNullable<ExpertDDx["probability"]>, number> = {
  high: 3,
  mid: 2,
  low: 1,
};

export function rankedExpertDDx(ddx: ExpertDDx[]): string[] {
  // Stable sort by descending probability weight. Ties keep authoring
  // order so authors can hand-tune by re-ordering within the same tier.
  const withIndex = ddx.map((d, i) => ({ d, i }));
  withIndex.sort((a, b) => {
    const wa = PROB_WEIGHT[a.d.probability ?? "mid"];
    const wb = PROB_WEIGHT[b.d.probability ?? "mid"];
    if (wb !== wa) return wb - wa;
    return a.i - b.i;
  });
  return withIndex.slice(0, 3).map((x) => x.d.name);
}

// ── distractor pools keyed loosely on body_part + species hints ───────
// Each pool is a flat list of plausible (but in most cases wrong)
// diagnoses for that anatomical region. Authors can extend; we only
// pull what we need at runtime.
//
// Note: we keep the canine and feline thorax pools separate (mostly
// overlapping) so we can lean on species-specific entities like
// "feline asthma" or "megaesophagus" without polluting the other.
const POOL_CANINE_THORAX = [
  "Cardiomegaly",
  "Pneumothorax",
  "Pleural effusion",
  "Mass",
  "Normal (no finding)",
  "Bronchial pattern",
  "Interstitial pattern",
  "Alveolar pattern",
  "Megaesophagus",
  "Hiatal hernia",
  "Pulmonary edema",
  "Pulmonary fibrosis",
  "Bronchopneumonia",
  "Atelectasis",
];

const POOL_FELINE_THORAX = [
  "Cardiomegaly",
  "Pneumothorax",
  "Pleural effusion",
  "Mass",
  "Normal (no finding)",
  "Feline asthma",
  "Interstitial pattern",
  "Alveolar pattern",
  "Megaesophagus",
  "Hiatal hernia",
  "Pulmonary edema",
  "Mediastinal lymphoma",
  "Thymoma",
];

const POOL_PELVIS_HIP = [
  "Hip dysplasia (grade I)",
  "Hip dysplasia (grade II)",
  "Hip dysplasia (grade III)",
  "Normal (no finding)",
  "Osteochondritis dissecans (OCD)",
  "Femoral neck fracture",
  "Coxofemoral luxation",
  "Legg-Calvé-Perthes disease",
  "Hip osteoarthritis",
  "Acetabular fracture",
];

// Fallback if we don't recognize the body_part — generic catch-all so
// the ranker still works (better than crashing or silently dropping).
const POOL_GENERIC = [
  "Normal (no finding)",
  "Soft tissue mass",
  "Fracture",
  "Inflammation",
  "Neoplasia",
  "Congenital malformation",
];

export function distractorPoolFor(c: Pick<ImagingCase, "species" | "body_part">): string[] {
  const part = (c.body_part ?? "").toLowerCase();
  const species = (c.species ?? "").toLowerCase();
  if (part.includes("thorax")) {
    return species === "feline" ? POOL_FELINE_THORAX : POOL_CANINE_THORAX;
  }
  if (part.includes("pelvis") || part.includes("hip")) return POOL_PELVIS_HIP;
  return POOL_GENERIC;
}

// ── deterministic per-case shuffle ────────────────────────────────────
// Seeded so option order is stable across reloads — students can't
// game by reloading until they get a friendlier order, but they also
// don't see the answer key as a fixed top-3.

function hashString(s: string): number {
  // Simple FNV-1a (32-bit). Plenty for shuffle entropy, zero deps.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Force unsigned.
  return h >>> 0;
}

function mulberry32(seed: number) {
  // tiny PRNG suitable for non-crypto shuffle. Same as everyone uses
  // for "stable random" in JS demos.
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(arr: T[], seedKey: string): T[] {
  const rand = mulberry32(hashString(seedKey));
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ── option assembly ────────────────────────────────────────────────────
// Combines expert truth + distractors into the final 6-item set the
// ranker shows. Returns at most 6 unique strings. If the expert list
// already has 6+ entries we return its top 6 (rare but safe).

export type RankerOption = {
  name: string;
  // Where the option came from — used by the scorer to compare student
  // ranking vs the expert truth array.
  isCorrect: boolean;
  // Index into the ranked-expert order (0 = #1 expert). Distractors
  // have expertRank=null.
  expertRank: number | null;
};

const TARGET_OPTION_COUNT = 6;
const TARGET_CORRECT_COUNT = 3;

export function buildRankerOptions(
  c: Pick<ImagingCase, "slug" | "species" | "body_part">,
  expertDdx: ExpertDDx[],
  // Additional name-strings to treat as "already taken" — typically the
  // case's `final_diagnosis` so it doesn't show up as a distractor and
  // confuse the student who picks the umbrella answer (e.g. case
  // vetxray-feline-cardiomegaly used to surface "Cardiomegaly" as a
  // wrong-choice distractor, contradicting the case's final dx).
  extraExcludes: string[] = [],
): RankerOption[] {
  const correctNames = rankedExpertDDx(expertDdx).slice(0, TARGET_CORRECT_COUNT);
  if (correctNames.length === 0) return [];

  // Build correct options first — keep their expertRank from the
  // ranked order (NOT shuffled position).
  const correct: RankerOption[] = correctNames.map((name, idx) => ({
    name,
    isCorrect: true,
    expertRank: idx,
  }));

  // Pull distractors from the body_part pool, skipping any that
  // collide (case-insensitive substring) with the correct set OR with
  // any extra excludes (typically the final_diagnosis).
  const pool = distractorPoolFor(c);
  const taken = new Set<string>([
    ...correctNames.map((n) => n.toLowerCase()),
    ...extraExcludes.filter(Boolean).map((n) => n.toLowerCase()),
  ]);

  // Deterministically pick distractors using a slug-seeded shuffle
  // of the pool, then take the first N that don't collide.
  const shuffledPool = seededShuffle(pool, `${c.slug}::pool`);
  const distractors: RankerOption[] = [];
  const needed = TARGET_OPTION_COUNT - correct.length;
  for (const candidate of shuffledPool) {
    if (distractors.length >= needed) break;
    const lower = candidate.toLowerCase();
    // Skip if this candidate is one of the correct answers OR if it
    // is a substring of one (e.g. "Mass" vs "Soft tissue mass") — too
    // close to score honestly as "wrong".
    let collides = false;
    for (const t of taken) {
      if (t.includes(lower) || lower.includes(t)) {
        collides = true;
        break;
      }
    }
    if (collides) continue;
    distractors.push({ name: candidate, isCorrect: false, expertRank: null });
    taken.add(lower);
  }

  // Final shuffle of the combined set so correct/wrong are interleaved
  // visually. Use a different seed namespace so it's not just the pool
  // permutation by another name.
  return seededShuffle([...correct, ...distractors], `${c.slug}::display`);
}

// ── scoring ────────────────────────────────────────────────────────────
// Student supplies their top-3 rankings as an array of option names.
// For each slot we award:
//   - 1 point if it matches the expert's name at that exact rank
//   - 0.5 if it's an expert correct answer but off by 1 rank
//   - 0 otherwise (distractor OR off by 2+)
// We bucket the raw score into 0..3 for the UI ("good · great · perfect").

export type SlotMark = "correct" | "off-by-one" | "wrong";

export type ScoreBreakdown = {
  marks: SlotMark[];       // per slot, in student order
  raw: number;             // 0..3 (with halves)
  bucket: 0 | 1 | 2 | 3;   // rounded down for the headline display
  expertOrder: string[];   // for revealing the "correct ranking"
};

export function scoreRanking(
  studentTop3: string[],
  expertDdx: ExpertDDx[],
): ScoreBreakdown {
  const expertOrder = rankedExpertDDx(expertDdx).slice(0, 3);
  const marks: SlotMark[] = [];
  let raw = 0;

  for (let i = 0; i < studentTop3.length; i++) {
    const studentName = studentTop3[i];
    if (!studentName) {
      marks.push("wrong");
      continue;
    }
    const expertIdx = expertOrder.findIndex(
      (e) => e.toLowerCase() === studentName.toLowerCase(),
    );
    if (expertIdx === -1) {
      marks.push("wrong");
    } else if (expertIdx === i) {
      marks.push("correct");
      raw += 1;
    } else if (Math.abs(expertIdx - i) === 1) {
      marks.push("off-by-one");
      raw += 0.5;
    } else {
      // Right answer but 2 slots away — still partial credit (0.25)
      // would feel too generous. Keep it at zero but mark as
      // "off-by-one" so the UI shows the arrow rather than a hard ✗.
      // Choice: be honest — mark as wrong, raw stays at 0 for this slot.
      marks.push("wrong");
    }
  }

  // Bucket headline: floor of raw, capped at 3.
  const bucket = Math.min(3, Math.floor(raw)) as 0 | 1 | 2 | 3;
  return { marks, raw, bucket, expertOrder };
}
