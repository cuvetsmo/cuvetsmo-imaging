// Unit tests for lib/scoring/iou.ts — Agent ⑦ Phase 3 bounding-box scorer.
//
// Covers: pure IoU math (perfect overlap · no overlap · partial · degenerate),
// bucket labels (hit · partial · miss), and the normalizeBox sorting helper.

import { describe, it, expect } from 'vitest';
import { iou, scoreLabel, normalizeBox, type Box } from '@/lib/scoring/iou';

describe('iou()', () => {
  it('returns 1.0 for perfect overlap', () => {
    const box: Box = { x: 0, y: 0, w: 1, h: 1 };
    expect(iou(box, box)).toBe(1);
  });

  it('returns 0 for non-overlapping boxes', () => {
    const a: Box = { x: 0, y: 0, w: 1, h: 1 };
    const b: Box = { x: 2, y: 2, w: 1, h: 1 };
    expect(iou(a, b)).toBe(0);
  });

  it('returns ~1/3 (0.33…) for two unit boxes with half overlap', () => {
    // Two 1x1 boxes shifted 0.5 in x — inter = 0.5, union = 1.5
    const a: Box = { x: 0, y: 0, w: 1, h: 1 };
    const b: Box = { x: 0.5, y: 0, w: 1, h: 1 };
    expect(iou(a, b)).toBeCloseTo(1 / 3, 5);
  });

  it('returns 0 for degenerate input (w = 0 or h = 0) — no NaN', () => {
    const ref: Box = { x: 0, y: 0, w: 1, h: 1 };
    expect(iou({ x: 0, y: 0, w: 0, h: 1 }, ref)).toBe(0);
    expect(iou({ x: 0, y: 0, w: 1, h: 0 }, ref)).toBe(0);
    expect(iou(ref, { x: 0, y: 0, w: 0, h: 1 })).toBe(0);
    expect(Number.isNaN(iou({ x: 0, y: 0, w: 0, h: 0 }, ref))).toBe(false);
  });

  it('handles boxes that touch at one edge as no overlap', () => {
    // Adjacent but not overlapping — intersection area = 0.
    const a: Box = { x: 0, y: 0, w: 0.5, h: 0.5 };
    const b: Box = { x: 0.5, y: 0, w: 0.5, h: 0.5 };
    expect(iou(a, b)).toBe(0);
  });
});

describe('scoreLabel()', () => {
  it('buckets > 0.5 as hit', () => {
    expect(scoreLabel(0.9).bucket).toBe('hit');
    expect(scoreLabel(0.51).bucket).toBe('hit');
  });

  it('buckets 0.2–0.5 as partial', () => {
    expect(scoreLabel(0.5).bucket).toBe('partial');
    expect(scoreLabel(0.35).bucket).toBe('partial');
    expect(scoreLabel(0.2).bucket).toBe('partial');
  });

  it('buckets < 0.2 as miss', () => {
    expect(scoreLabel(0.19).bucket).toBe('miss');
    expect(scoreLabel(0).bucket).toBe('miss');
  });

  it('returns CSS-token strings (theme stays consistent)', () => {
    const hit = scoreLabel(1);
    expect(hit.tone).toContain('var(');
    expect(hit.headline).toBeTruthy();
    expect(hit.sub).toBeTruthy();
  });
});

describe('normalizeBox()', () => {
  it('sorts corners — top-left always first', () => {
    // Pass bottom-right then top-left; expect normalized origin.
    const out = normalizeBox(0.8, 0.7, 0.2, 0.1);
    expect(out.x).toBeCloseTo(0.2, 5);
    expect(out.y).toBeCloseTo(0.1, 5);
    expect(out.w).toBeCloseTo(0.6, 5);
    expect(out.h).toBeCloseTo(0.6, 5);
  });

  it('clamps to [0, 1] viewport', () => {
    const out = normalizeBox(-0.2, -0.5, 1.5, 1.8);
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
    expect(out.w).toBeLessThanOrEqual(1);
    expect(out.h).toBeLessThanOrEqual(1);
  });
});
