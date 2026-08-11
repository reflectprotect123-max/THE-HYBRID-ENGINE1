import { computeSetAdjustment, deviationFelt, rpeCenterOf } from './autoreg';

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

describe('deviationFelt — the sets table\'s two-target rating', () => {
  it('reads one RPE point either side of what the set was asked for', () => {
    // Easier than asked reads BELOW the centre, which is what sends load up.
    expect(deviationFelt({ rpe: '8' }, 'easier')).toBe(7);
    expect(deviationFelt({ rpe: '8' }, 'harder')).toBe(9);
  });

  it('reads against a RANGE target by its centre, not by either end', () => {
    // rpeCenterOf('7-9') is 8, so this must land on the same 7/9 as a flat 8.
    expect(deviationFelt({ rpe: '7-9' }, 'easier')).toBe(7);
    expect(deviationFelt({ rpe: '7-9' }, 'harder')).toBe(9);
  });

  it('falls back to the global centre when the set carries no target', () => {
    expect(deviationFelt({ rpe: '' }, 'easier')).toBe(7.5);
    expect(deviationFelt(null, 'harder')).toBe(9.5);
  });

  it('stays on the 1-10 scale', () => {
    expect(deviationFelt({ rpe: '10' }, 'harder')).toBe(10);
    expect(deviationFelt({ rpe: '1' }, 'easier')).toBe(1);
  });

  it('moves the weight by one point worth of load, and only when asked', () => {
    // The whole point of the control: 100kg asked for at RPE 8, tapped
    // "easier", is worth +2.5% — the same arithmetic every other caller gets.
    const easier = computeSetAdjustment(5, deviationFelt({ rpe: '8' }, 'easier'), 5, 100, rpeCenterOf({ rpe: '8' }));
    expect(easier.newWeight).toBe(102.5);
    const harder = computeSetAdjustment(5, deviationFelt({ rpe: '8' }, 'harder'), 5, 100, rpeCenterOf({ rpe: '8' }));
    expect(harder.newWeight).toBe(97.5);
  });
});
