import { computeSetAdjustment } from '../src/autoreg';

describe('computeSetAdjustment — E5 on-target hold', () => {
  it('a set exactly on target holds the weight, even off a non-plate load', () => {
    expect(computeSetAdjustment(5, 8.5, 5, 101, 8.5))
      .toEqual({ delta: 0, newWeight: 101, verdict: 'right on target', cls: 'good' });
    // an off-target set still moves (regression guard for the 142.5/center-7 case)
    expect(computeSetAdjustment(5, 7.5, 0, 142.5, 7).delta).toBe(-2.5);
  });
});

describe('computeSetAdjustment — a missed set never rounds UP past the failed weight', () => {
  it('24.9kg, target RPE 10, missed the rep floor: rounding must not suggest more than was failed', () => {
    // reps:3 of low:5 is a miss; the felt RPE is irrelevant to a missed set's
    // eff. raw = 24.9 * (1 + (10 - 10.5) * 2.5 / 100) = 24.58875, which rounds
    // UP to 25 — heavier than the weight just failed at. The fix must step the
    // rounded result down one plate increment (2.5) when that happens.
    const out = computeSetAdjustment(3, 10, 5, 24.9, 10);
    expect(out.newWeight).toBeLessThanOrEqual(24.9);
    expect(out).toEqual({ delta: -2.4, newWeight: 22.5, verdict: 'missed the rep floor', cls: 'bad' });
  });

  it('an exact-multiple missed case (fixture territory) is unchanged', () => {
    // weight: 60 is already a 2.5kg multiple, so raw rounds to <= 60 by
    // construction (per the golden fixture's own 60kg cases, e.g. this exact
    // reps/rpe/low/weight/center combination) — the fix must be a no-op here.
    expect(computeSetAdjustment(3, 5, 5, 60, 8.5)).toEqual({
      delta: -2.5,
      newWeight: 57.5,
      verdict: 'missed the rep floor',
      cls: 'bad',
    });
  });
});
