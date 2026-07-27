/*
 * Strength progression across sessions.
 *
 * NOT in test/golden: those vectors were harvested from the vanilla `app.js`
 * and mean "this still matches the original". `liftAdapt` has no counterpart
 * there — the vanilla app never carried a working weight forward either — so a
 * file in that directory would claim a parity that does not exist.
 *
 * What it does reuse is `computeSetAdjustment`, which IS golden-tested. These
 * cases are about the decisions layered on top: which set is judged, what
 * happens when nothing was earned, and how the recovery gate behaves.
 */
import { describe, expect, it } from 'vitest';
import { liftAdapt, liftMoves, nextWorkingWeight } from '../src/lift';
import type { Exercise, LoggedSet, Session } from '../src/types';

const ex = (name: string, sets: LoggedSet[], mode: Exercise['mode'] = 'reps_kg'): Exercise<LoggedSet> => ({
  id: 'e-' + name,
  name,
  mode,
  sets,
});

const session = (exercises: Exercise<LoggedSet>[], completedAt = 5000): Session => ({
  id: 's1',
  date: '2026-07-27',
  status: 'completed',
  completedAt,
  blocks: [{ id: 'b1', heading: 'Main', exercises }],
});

/** On target at the 8.5 default centre: the weight holds. */
const onTarget = { t: '5', rpe: '8.5', aVal: '100', aVal2: '5', felt: '8.5', done: true };

describe('which set decides the next weight', () => {
  it('judges the LAST completed working set', () => {
    const s = session([
      ex('Back squat', [
        { t: '5', rpe: '8', aVal: '100', aVal2: '5', felt: '6', done: true },
        { t: '5', rpe: '8', aVal: '105', aVal2: '5', felt: '9.5', done: true },
      ]),
    ]);
    // Judged on the 105 at 9.5, not the 100 at 6 — a session that ramps up
    // must not be scored on how the first set felt.
    const [m] = liftMoves(s);
    expect(m.from).toBe(105);
    expect(m.to).toBeLessThan(105);
  });

  it('ignores warm-ups entirely', () => {
    const s = session([
      ex('Bench press', [
        { t: '5', rpe: '8', aVal: '80', aVal2: '5', felt: '8.5', done: true },
        // A heavy-feeling warm-up logged last would otherwise strip the weight.
        { t: 'W3', rpe: '', aVal: '40', aVal2: '3', felt: '10', done: true },
      ]),
    ]);
    expect(liftMoves(s)[0].from).toBe(80);
  });

  it('ignores sets that were never completed', () => {
    const s = session([
      ex('Deadlift', [
        { ...onTarget, aVal: '140' },
        { t: '5', rpe: '8.5', aVal: '150', aVal2: '5', felt: '9' },
      ]),
    ]);
    expect(liftMoves(s)[0].from).toBe(140);
  });

  it('judges the set against what was ASKED, not against itself', () => {
    // A set targeted at RPE 7 and rated 9 is too heavy even though 9 is a
    // perfectly ordinary rating. Using the set's own `rpe` as the centre would
    // score everything as perfect and the weight would never move.
    const s = session([ex('Row', [{ t: '8', rpe: '7', aVal: '60', aVal2: '8', felt: '9', done: true }])]);
    expect(liftMoves(s)[0].delta).toBeLessThan(0);
  });

  it('takes weight off a set that missed its rep floor, however it was rated', () => {
    const s = session([ex('Front squat', [{ t: '5', rpe: '8', aVal: '90', aVal2: '3', felt: '7', done: true }])]);
    const [m] = liftMoves(s);
    expect(m.delta).toBeLessThan(0);
    expect(m.verdict).toBe('missed the rep floor');
  });

  it('produces nothing for non-lift modes', () => {
    const s = session([ex('Plank', [{ t: '60', rpe: '', aVal: '60', felt: '8', done: true }], 'seconds')]);
    expect(liftMoves(s)).toEqual([]);
  });

  it('produces nothing for an unnamed movement', () => {
    expect(liftMoves(session([ex('', [onTarget])]))).toEqual([]);
  });

  it('produces nothing when the set was never rated', () => {
    // An older session, logged before the rating existed. Judging it at some
    // default would move the weight on evidence nobody gave.
    const s = session([ex('Back squat', [{ t: '5', rpe: '8', aVal: '100', aVal2: '5', done: true }])]);
    expect(liftMoves(s)).toEqual([]);
  });
});

describe('banking it', () => {
  it('keys by lowercased name and carries the timestamp', () => {
    const { liftProgress } = liftAdapt(session([ex('Back Squat', [onTarget])]), {});
    expect(liftProgress['back squat']).toEqual({ kg: 100, at: 5000, reps: 5 });
  });

  it('leaves a lift alone when this session earned nothing for it', () => {
    // Skipping a lift, or logging only warm-ups, must not erase what the last
    // session earned. Zeroing it here would silently reset the athlete.
    const before = { liftProgress: { deadlift: { kg: 180, at: 1000 } } };
    const { liftProgress } = liftAdapt(session([ex('Back squat', [onTarget])]), before);
    expect(liftProgress.deadlift).toEqual({ kg: 180, at: 1000 });
    expect(liftProgress['back squat'].kg).toBe(100);
  });

  it('does not let an older session overwrite a newer one', () => {
    // A session closed late, or restored from a backup, arriving after the one
    // that actually came last.
    const before = { liftProgress: { 'back squat': { kg: 110, at: 9000 } } };
    const { liftProgress } = liftAdapt(session([ex('Back squat', [onTarget])], 5000), before);
    expect(liftProgress['back squat'].kg).toBe(110);
  });

  it('is a no-op on a missing session', () => {
    const before = { liftProgress: { squat: { kg: 100, at: 1 } } };
    expect(liftAdapt(null, before).liftProgress).toEqual(before.liftProgress);
  });
});

describe('what to offer today', () => {
  const settings = { liftProgress: { 'back squat': { kg: 100, at: 1000 } } };

  it('offers the earned weight when there is no WHOOP reading at all', () => {
    expect(nextWorkingWeight('Back squat', settings)).toEqual({
      kg: 100,
      earned: 100,
      dailyAdj: 0,
      note: '',
    });
  });

  it('offers it untouched on green and on amber', () => {
    expect(nextWorkingWeight('Back squat', settings, { recoveryScore: 80 })?.kg).toBe(100);
    expect(nextWorkingWeight('Back squat', settings, { recoveryScore: 50 })?.kg).toBe(100);
  });

  it('eases it on red, and says why', () => {
    const w = nextWorkingWeight('Back squat', settings, { recoveryScore: 20 });
    expect(w?.kg).toBe(97.5);
    expect(w?.earned).toBe(100);
    expect(w?.note).toBe('eased for 20% recovery');
  });

  it('does not spend the earned weight on a red day', () => {
    // The gate is applied at READ time on purpose: a bad night eases one
    // session, it does not cost you the weight you earned.
    expect(nextWorkingWeight('Back squat', settings, { recoveryScore: 20 })?.earned).toBe(100);
    expect(settings.liftProgress['back squat'].kg).toBe(100);
  });

  it('is case-insensitive about the name', () => {
    expect(nextWorkingWeight('BACK SQUAT', settings)?.kg).toBe(100);
  });

  it('returns null for a lift that has earned nothing', () => {
    expect(nextWorkingWeight('Deadlift', settings)).toBeNull();
    expect(nextWorkingWeight('', settings)).toBeNull();
    expect(nextWorkingWeight('Back squat', {})).toBeNull();
  });

  it('never eases below one step', () => {
    const light = { liftProgress: { curl: { kg: 2.5, at: 1 } } };
    expect(nextWorkingWeight('curl', light, { recoveryScore: 10 })?.kg).toBe(2.5);
  });
});
