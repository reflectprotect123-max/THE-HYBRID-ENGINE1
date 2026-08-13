import { describe, expect, it } from 'vitest';
import { prefillPrimary } from './logger';
import type { Exercise, LoggedSet } from './types';

const ex = (name: string, sets: LoggedSet[]): Exercise<LoggedSet> => ({
  id: 'e1',
  name,
  mode: 'reps_kg',
  tempo: '',
  rest: 90,
  sets,
});

/** Prefill for the first set the athlete has not yet done. */
const prefillFor = (sets: LoggedSet[]): string => {
  const e = ex('Back squat', sets);
  const si = e.sets.findIndex((st) => !st.done);
  return prefillPrimary(e, si);
};

describe('prefillPrimary reads the fold', () => {
  it('prefills from the fold, so two easy sets earn more than one does', () => {
    const one = prefillFor([
      { t: '8', rpe: '8', aVal: '100', aVal2: '8', felt: '7', done: true },
      { t: '8', rpe: '8' },
    ]);
    const two = prefillFor([
      { t: '8', rpe: '8', aVal: '100', aVal2: '8', felt: '7', done: true },
      { t: '8', rpe: '8', aVal: '100', aVal2: '8', felt: '7', done: true },
      { t: '8', rpe: '8' },
    ]);
    expect(Number(two)).toBeGreaterThan(Number(one));
  });

  it('prices an unrated deviation off the plan, not off the last bar weight', () => {
    /*
     * The one place the migration CHANGED behaviour, pinned on purpose.
     *
     * Set 1: 100 kg for 5 @8, rated 8 — exactly on plan. Set 2: the athlete
     * jumped to 110 kg but never rated it. Prefilling set 3:
     *
     * OLD rule ("repeat the nearest earlier aVal"): felt is unparseable, so
     * computeSetAdjustment was skipped and set 2's own 110 came straight back
     * → '110'.
     *
     * FOLD: an unrated set carries no evidence, so readExercise stops folding
     * at it — logs hold only set 1 (5 reps, 100 kg, felt 8). Walk: dev =
     * 8 − 8 = 0 → adj 1. Anchor = e1rm(100, 5, 8) = 100·(1 + 7/30); planned
     * for 5 @8 = anchor / (1 + 7/30) = 100; ×1, rounded to 2.5 → '100'.
     *
     * 110 was a weight nobody vouched for; 100 is the plan's price at the
     * anchor the athlete chose and confirmed. The divergence is chosen.
     */
    const kg = prefillFor([
      { t: '5', rpe: '8', aVal: '100', aVal2: '5', felt: '8', done: true },
      { t: '5', rpe: '8', aVal: '110', aVal2: '5', done: true },
      { t: '5', rpe: '8' },
    ]);
    expect(kg).toBe('100');
  });
});
