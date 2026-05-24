// Unit tests for lib/ddx-pools.ts — Agent C Phase 2.
//
// Covers buildRankerOptions (6-option assembly + extraExcludes guard) +
// scoreRanking (correct · off-by-one · wrong slot logic) +
// rankedExpertDDx + seededShuffle determinism.

import { describe, it, expect } from 'vitest';
import {
  buildRankerOptions,
  scoreRanking,
  rankedExpertDDx,
  seededShuffle,
} from '@/lib/ddx-pools';
import type { ImagingCase } from '@/lib/cases';

type CaseSlim = Pick<ImagingCase, 'slug' | 'species' | 'body_part'>;
type ExpertDDx = NonNullable<ImagingCase['recall']>['ddx'][number];

const caninThoraxCase: CaseSlim = {
  slug: 'test-canine-thorax',
  species: 'canine',
  body_part: 'thorax',
};

const ddx3: ExpertDDx[] = [
  { name: 'Pulmonary edema', probability: 'high' },
  { name: 'Pneumonia', probability: 'mid' },
  { name: 'Bronchopneumonia', probability: 'low' },
];

describe('rankedExpertDDx()', () => {
  it('sorts high → mid → low and slices to top 3', () => {
    const sorted = rankedExpertDDx([
      { name: 'C', probability: 'low' },
      { name: 'A', probability: 'high' },
      { name: 'B', probability: 'mid' },
      { name: 'D', probability: 'low' },
    ]);
    expect(sorted).toEqual(['A', 'B', 'C']);
  });
});

describe('buildRankerOptions()', () => {
  it('returns 6 options (3 correct + 3 distractors) for a 3-ddx case', () => {
    const opts = buildRankerOptions(caninThoraxCase, ddx3);
    expect(opts).toHaveLength(6);
    const correctCount = opts.filter((o) => o.isCorrect).length;
    const distractorCount = opts.filter((o) => !o.isCorrect).length;
    expect(correctCount).toBe(3);
    expect(distractorCount).toBe(3);
  });

  it('extraExcludes blocks a name from the distractor pool', () => {
    const opts = buildRankerOptions(caninThoraxCase, ddx3, ['Cardiomegaly']);
    const names = opts.map((o) => o.name.toLowerCase());
    expect(names).not.toContain('cardiomegaly');
  });

  it('returns [] when expert ddx is empty (no truth to rank against)', () => {
    expect(buildRankerOptions(caninThoraxCase, [])).toEqual([]);
  });

  it('option order is deterministic across calls (slug-seeded)', () => {
    const a = buildRankerOptions(caninThoraxCase, ddx3);
    const b = buildRankerOptions(caninThoraxCase, ddx3);
    expect(a.map((o) => o.name)).toEqual(b.map((o) => o.name));
  });

  it('different slugs produce different orderings', () => {
    const a = buildRankerOptions(caninThoraxCase, ddx3);
    const b = buildRankerOptions(
      { ...caninThoraxCase, slug: 'different-slug' },
      ddx3,
    );
    // Both have the same 6 options, but the order should differ in
    // practice (vanishingly small chance of accidental match).
    expect(a.map((o) => o.name).join()).not.toBe(
      b.map((o) => o.name).join(),
    );
  });
});

describe('scoreRanking()', () => {
  it('exact match → bucket 3 (raw 3)', () => {
    const studentTop3 = ['Pulmonary edema', 'Pneumonia', 'Bronchopneumonia'];
    const result = scoreRanking(studentTop3, ddx3);
    expect(result.raw).toBe(3);
    expect(result.bucket).toBe(3);
    expect(result.marks).toEqual(['correct', 'correct', 'correct']);
  });

  it('all wrong distractors → raw 0, bucket 0', () => {
    const result = scoreRanking(['Mass', 'Fracture', 'OCD'], ddx3);
    expect(result.raw).toBe(0);
    expect(result.bucket).toBe(0);
  });

  it('off-by-one slot earns 0.5 partial credit', () => {
    // Student swaps slot 1 and 2 — both off-by-one.
    const studentTop3 = ['Pneumonia', 'Pulmonary edema', 'Bronchopneumonia'];
    const result = scoreRanking(studentTop3, ddx3);
    expect(result.raw).toBeCloseTo(1 + 0.5 + 0.5, 5); // 0.5 + 0.5 + 1 = 2.0
    expect(result.bucket).toBe(2);
  });

  it('returns expert order for the reveal panel', () => {
    const result = scoreRanking([], ddx3);
    expect(result.expertOrder).toEqual([
      'Pulmonary edema',
      'Pneumonia',
      'Bronchopneumonia',
    ]);
  });
});

describe('seededShuffle()', () => {
  it('same seed → same output', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(seededShuffle(arr, 'k')).toEqual(seededShuffle(arr, 'k'));
  });

  it('different seed → different output (high probability)', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(seededShuffle(arr, 'k1').join()).not.toBe(
      seededShuffle(arr, 'k2').join(),
    );
  });

  it('does not mutate the input array', () => {
    const arr = [1, 2, 3, 4];
    const snapshot = arr.slice();
    seededShuffle(arr, 'k');
    expect(arr).toEqual(snapshot);
  });
});
