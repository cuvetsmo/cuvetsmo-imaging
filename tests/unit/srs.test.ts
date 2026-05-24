// Unit tests for lib/srs.ts — Agent B Phase 2 spaced-repetition scheduler.
//
// Covers: bucketOf (NEW/LOW/MID/HIGH) · classify (priority + reason) ·
// buildQueue (ordering: high outranks new outranks mid · soonest-due first
// within MID/LOW).

import { describe, it, expect } from 'vitest';
import {
  bucketOf,
  buildQueue,
  classify,
  nextReviewAt,
  type AttemptRecord,
  type AttemptStore,
} from '@/lib/srs';

const FIXED_NOW = Date.parse('2026-05-24T12:00:00Z');

function mkAttempt(opts: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    notes: '',
    confidence: 3,
    revealedAt: null,
    lastEditedAt: '2026-05-24T11:00:00Z',
    ...opts,
  };
}

describe('bucketOf()', () => {
  it('undefined → bucket 1 (NEW)', () => {
    expect(bucketOf(undefined)).toBe(1);
  });

  it('attempt without revealedAt → bucket 2 (treated as low/unfinished)', () => {
    expect(bucketOf(mkAttempt({ revealedAt: null, confidence: 5 }))).toBe(2);
  });

  it('confidence 1 → bucket 2 (LOW)', () => {
    expect(
      bucketOf(mkAttempt({ revealedAt: '2026-05-24T11:00:00Z', confidence: 1 })),
    ).toBe(2);
  });

  it('confidence 2 → bucket 2 (LOW)', () => {
    expect(
      bucketOf(mkAttempt({ revealedAt: '2026-05-24T11:00:00Z', confidence: 2 })),
    ).toBe(2);
  });

  it('confidence 3 → bucket 3 (MID)', () => {
    expect(
      bucketOf(mkAttempt({ revealedAt: '2026-05-24T11:00:00Z', confidence: 3 })),
    ).toBe(3);
  });

  it('confidence 4 → bucket 3 (MID)', () => {
    expect(
      bucketOf(mkAttempt({ revealedAt: '2026-05-24T11:00:00Z', confidence: 4 })),
    ).toBe(3);
  });

  it('confidence 5 → bucket 4 (HIGH)', () => {
    expect(
      bucketOf(mkAttempt({ revealedAt: '2026-05-24T11:00:00Z', confidence: 5 })),
    ).toBe(4);
  });
});

describe('nextReviewAt()', () => {
  it('undefined → 0 (always due)', () => {
    expect(nextReviewAt(undefined)).toBe(0);
  });

  it('HIGH confidence attempt → +7 days from revealedAt', () => {
    const revealedAt = '2026-05-24T00:00:00Z';
    const t = nextReviewAt(mkAttempt({ revealedAt, confidence: 5 }));
    const expected = Date.parse(revealedAt) + 7 * 24 * 60 * 60 * 1000;
    expect(t).toBe(expected);
  });
});

describe('buildQueue()', () => {
  it('empty cases → empty queue', () => {
    expect(buildQueue([], {})).toEqual([]);
  });

  it('orders LOW-confidence above NEW above MID-due', () => {
    const cases = [
      { id: 'a', slug: 'a-new', title: 'a' },
      { id: 'b', slug: 'b-low', title: 'b' },
      { id: 'c', slug: 'c-mid-due', title: 'c' },
    ];
    // b = low-confidence (HIGH priority, low-confidence reason)
    // c = mid bucket but its review came due 2 days ago (MID priority)
    // a = never attempted (HIGH priority, new reason)
    const store: AttemptStore = {
      'b-low': mkAttempt({
        revealedAt: new Date(FIXED_NOW - 2 * 24 * 3600_000).toISOString(),
        confidence: 1,
        lastEditedAt: new Date(FIXED_NOW - 2 * 24 * 3600_000).toISOString(),
      }),
      'c-mid-due': mkAttempt({
        revealedAt: new Date(FIXED_NOW - 4 * 24 * 3600_000).toISOString(),
        confidence: 4,
        lastEditedAt: new Date(FIXED_NOW - 4 * 24 * 3600_000).toISOString(),
      }),
    };

    const queue = buildQueue(cases, store, FIXED_NOW);
    expect(queue.map((q) => q.caseSlug)).toEqual(['b-low', 'a-new', 'c-mid-due']);
    expect(queue[0].priority).toBe('high');
    expect(queue[0].reason).toBe('low-confidence');
    expect(queue[1].priority).toBe('high');
    expect(queue[1].reason).toBe('new');
    expect(queue[2].priority).toBe('mid');
  });

  it('classify returns "cooldown" reason for HIGH bucket within interval', () => {
    const cases = [{ id: 'x', slug: 'x-recent-high', title: 'x' }];
    const store: AttemptStore = {
      'x-recent-high': mkAttempt({
        revealedAt: new Date(FIXED_NOW - 1 * 24 * 3600_000).toISOString(),
        confidence: 5,
        lastEditedAt: new Date(FIXED_NOW - 1 * 24 * 3600_000).toISOString(),
      }),
    };
    const item = classify(cases[0], store, FIXED_NOW);
    expect(item.priority).toBe('low');
    expect(item.reason).toBe('cooldown');
    expect(item.bucket).toBe(4);
  });
});
