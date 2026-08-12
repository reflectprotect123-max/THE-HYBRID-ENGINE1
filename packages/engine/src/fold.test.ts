import { describe, it, expect } from 'vitest';
import { repsToFailure, e1rmOf, kFor, clampPct } from './fold';

describe('repsToFailure', () => {
  it('is reps plus the RPE shortfall', () => {
    expect(repsToFailure(8, 8)).toBe(10);
    expect(repsToFailure(5, 10)).toBe(5);
  });

  it('caps at 12, so a very easy high-rep set cannot claim an absurd e1RM', () => {
    expect(repsToFailure(20, 6)).toBe(12);
    expect(repsToFailure(12, 10)).toBe(12);
  });
});

describe('e1rmOf', () => {
  it('is Epley over reps-to-failure', () => {
    expect(e1rmOf(100, 10, 10)).toBeCloseTo(133.333, 3);
    expect(e1rmOf(100, 1, 10)).toBeCloseTo(103.333, 3);
  });

  it('returns 0 for a bodyweight set', () => {
    expect(e1rmOf(0, 10, 8)).toBe(0);
  });
});

describe('kFor', () => {
  it('moves low-rep work further per RPE point than high-rep work', () => {
    expect(kFor(1)).toBe(3);
    expect(kFor(3)).toBe(3);
    expect(kFor(4)).toBe(2.5);
    expect(kFor(7)).toBe(2.5);
    expect(kFor(8)).toBe(2);
    expect(kFor(20)).toBe(2);
  });
});

describe('clampPct', () => {
  it('holds a single adjustment inside 7.5% either way', () => {
    expect(clampPct(3)).toBe(3);
    expect(clampPct(20)).toBe(7.5);
    expect(clampPct(-20)).toBe(-7.5);
  });
});
