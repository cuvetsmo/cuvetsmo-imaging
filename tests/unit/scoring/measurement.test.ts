// Unit tests for lib/scoring/measurement.ts — Agent ⑧ Phase 3.
//
// Covers Norberg angle + VHS tolerance-bucket scoring + the species-aware
// normal-range context.

import { describe, it, expect } from 'vitest';
import { scoreAngle, scoreVHS } from '@/lib/scoring/measurement';

describe('scoreAngle()', () => {
  it('Δ = 0 — perfect bucket', () => {
    const s = scoreAngle(108, 108);
    expect(s.bucket).toBe('perfect');
    expect(s.delta).toBe(0);
    expect(s.absDelta).toBe(0);
  });

  it('Δ = +5° — good bucket (within ±5° = 2x reader SD)', () => {
    const s = scoreAngle(113, 108);
    expect(s.bucket).toBe('good');
    expect(s.delta).toBe(5);
    expect(s.absDelta).toBe(5);
  });

  it('Δ = -13° — review bucket (> ±10° = likely mis-placed landmark)', () => {
    const s = scoreAngle(95, 108);
    expect(s.bucket).toBe('review');
    expect(s.delta).toBe(-13);
    expect(s.absDelta).toBe(13);
  });

  it('Δ = +7° — off bucket (between 5 and 10)', () => {
    const s = scoreAngle(115, 108);
    expect(s.bucket).toBe('off');
  });

  it('returns a tone color + glyph for UI surfaces', () => {
    const s = scoreAngle(108, 108);
    expect(s.tone).toMatch(/^#/);
    expect(s.glyph).toBeTruthy();
    expect(s.label).toBeTruthy();
    expect(s.description).toBeTruthy();
  });
});

describe('scoreVHS()', () => {
  it('Δ = 0.0v — perfect bucket', () => {
    const s = scoreVHS(9.5, 9.5, 'canine');
    expect(s.bucket).toBe('perfect');
    expect(s.delta).toBe(0);
  });

  it('Δ = +2.0v — review bucket (> 1.5v threshold)', () => {
    const s = scoreVHS(11.5, 9.5, 'canine');
    expect(s.bucket).toBe('review');
    expect(s.delta).toBe(2);
  });

  it('Δ = +0.5v — good bucket (within ±0.7v)', () => {
    const s = scoreVHS(10, 9.5, 'canine');
    expect(s.bucket).toBe('good');
  });

  it('canine normal range = 8.5–10.5v (Buchanan)', () => {
    const s = scoreVHS(9.5, 9.5, 'canine');
    expect(s.normalRange).toEqual({ lo: 8.5, hi: 10.5, species: 'canine' });
  });

  it('feline normal range = 6.7–8.1v (Litster)', () => {
    const s = scoreVHS(7.5, 7.5, 'feline');
    expect(s.normalRange).toEqual({ lo: 6.7, hi: 8.1, species: 'feline' });
  });

  it('echoes student + expected back for UI display convenience', () => {
    const s = scoreVHS(9.21, 9.5, 'canine');
    expect(s.vhs).toBe(9.21);
    expect(s.expected).toBe(9.5);
  });
});
