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

import { anchorFor, plannedKg, type PlanTarget } from './fold';

describe('anchorFor', () => {
  it('is the e1RM implied by set 1 at the opener', () => {
    const first: PlanTarget = { reps: 10, rpe: 7 };
    // rtf = 10 + 3 = 13, capped to 12 → 60 * (1 + 12/30) = 84
    expect(anchorFor(60, first)).toBeCloseTo(84, 6);
  });

  it('is 0 for a bodyweight exercise, so nothing downstream invents a load', () => {
    expect(anchorFor(0, { reps: 10, rpe: 8 })).toBe(0);
  });
});

describe('plannedKg', () => {
  it('prices a later set off the anchor, not off the last set', () => {
    const anchor = anchorFor(60, { reps: 10, rpe: 7 });
    // set 2 asks 8 @ 8 → rtf 10 → 84 / (1 + 10/30) = 63
    expect(plannedKg(anchor, { reps: 8, rpe: 8 })).toBeCloseTo(63, 6);
  });

  it('treats a max set as the anchor set would be, since it has no rep target', () => {
    const anchor = anchorFor(60, { reps: 10, rpe: 7 });
    expect(plannedKg(anchor, { reps: 'max', rpe: 10 })).toBeCloseTo(84, 6);
  });
});
