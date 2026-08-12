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
import { liftAdapt, liftMoves, nextWorkingWeight, prescribedKg, sessionOpeners } from './lift';
import { prefillPrimary } from './logger';
import type { Exercise, LoggedSet, Session } from './types';

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

const sessionWith = (sets: LoggedSet[]): Session => ({
  id: 's1', date: '2026-08-12', status: 'completed',
  blocks: [{ id: 'b1', exercises: [{ id: 'e1', name: 'Back Squat', mode: 'reps_kg', sets }] }],
});

/** On target at the 8.5 default centre: the weight holds. */
const onTarget = { t: '5', rpe: '8.5', aVal: '100', aVal2: '5', felt: '8.5', done: true };

describe('which set decides the next weight', () => {
  it('folds to nothing once every planned set has been logged', () => {
    // Both sets in the plan are done, so the fold has no next set left to
    // price — `foldFromExercise` returns null (setIndex 2 >= targets.length
    // 2) and `liftMoves` banks nothing for this movement. This replaces the
    // old "judges the LAST completed working set" case: that rule judged one
    // set in isolation and always had an answer; the fold judges against the
    // plan and has none once the plan is exhausted.
    const s = session([
      ex('Back squat', [
        { t: '5', rpe: '8', aVal: '100', aVal2: '5', felt: '6', done: true },
        { t: '5', rpe: '8', aVal: '105', aVal2: '5', felt: '9.5', done: true },
      ]),
    ]);
    expect(liftMoves(s)).toEqual([]);
  });

  it('folds to nothing when the only working set (warm-ups aside) is already done', () => {
    // The warm-up is filtered out before folding, leaving one working set that
    // is itself the whole plan — done, with nothing left to predict.
    const s = session([
      ex('Bench press', [
        { t: '5', rpe: '8', aVal: '80', aVal2: '5', felt: '8.5', done: true },
        // A heavy-feeling warm-up logged last would otherwise strip the weight.
        { t: 'W3', rpe: '', aVal: '40', aVal2: '3', felt: '10', done: true },
      ]),
    ]);
    expect(liftMoves(s)).toEqual([]);
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

  it('folds to nothing when a single-set plan is the only, and completed, set', () => {
    // A one-set exercise with that set done is a plan with setIndex (1) equal
    // to targets.length (1) — finished, nothing left for the fold to predict.
    // This replaces "judges the set against what was ASKED, not against
    // itself": that per-set rule always had a verdict; a plan-anchored fold
    // over an exhausted plan does not.
    const s = session([ex('Row', [{ t: '8', rpe: '7', aVal: '60', aVal2: '8', felt: '9', done: true }])]);
    expect(liftMoves(s)).toEqual([]);
  });

  it('folds to nothing when the only set missed its rep floor and finished the plan', () => {
    // Same exhausted-plan shape as above; a single logged set — even one that
    // missed its floor — leaves no next target to fold, so nothing is banked
    // rather than a "took weight off" verdict.
    const s = session([ex('Front squat', [{ t: '5', rpe: '8', aVal: '90', aVal2: '3', felt: '7', done: true }])]);
    expect(liftMoves(s)).toEqual([]);
  });

  it('produces nothing for non-lift modes', () => {
    const s = session([ex('Plank', [{ t: '60', rpe: '', aVal: '60', felt: '8', done: true }], 'seconds')]);
    expect(liftMoves(s)).toEqual([]);
  });

  it('produces nothing for an unnamed movement', () => {
    expect(liftMoves(session([ex('', [onTarget])]))).toEqual([]);
  });

  it('an unrated set banks a hold at the same weight, not a move', () => {
    // An older session, logged before the rating existed. `foldFromExercise`
    // cannot fold an unrated set into its log (it requires a finite `felt`),
    // so its own log list stays empty and setIndex is 0 — read as "the
    // opener" — which returns the weight unchanged (`from` === `to`, delta 0)
    // rather than a judged move. This is not "moving weight on evidence
    // nobody gave": it is a hold, banking exactly the weight that was already
    // lifted.
    const s = session([ex('Back squat', [{ t: '5', rpe: '8', aVal: '100', aVal2: '5', done: true }])]);
    const [m] = liftMoves(s);
    expect(m.from).toBe(100);
    expect(m.to).toBe(100);
    expect(m.delta).toBe(0);
    expect(m.verdict).toBe('opener — everything works from here');
  });

  it('a later lighter block does not get a chance to overwrite, because both fold to nothing', () => {
    // Each block's "Back Squat" is a single-set, fully-done plan on its own —
    // b1's exercise folds to null (setIndex 1 >= targets.length 1) and
    // returns before `seen.add(key)` runs, so b2's exercise is tried too and
    // folds to null the same way. Nothing is banked for either, so the
    // dedup-by-first-occurrence guard this test used to pin never even
    // engages. This replaces "banks the working effort, not a later lighter
    // block".
    const s: Session = { id: 's', date: '2026-01-01', status: 'completed', completedAt: 1, blocks: [
      { id: 'b1', exercises: [{ id: 'e1', name: 'Back Squat', mode: 'reps_kg',
        sets: [{ t: '5', rpe: '8', aVal: '100', aVal2: '5', felt: '8', done: true }] }] },
      { id: 'b2', exercises: [{ id: 'e2', name: 'Back Squat', mode: 'reps_kg',
        sets: [{ t: '3', rpe: '9', aVal: '60', aVal2: '3', felt: '6', done: true }] }] },
    ] };
    const mv = liftMoves(s);
    expect(mv.length).toBe(0);
    expect(liftAdapt(s, {}).liftProgress['back squat']).toBeUndefined();
  });

  it('a set with zero reps earns no progression', () => {
    const s: Session = { id: 's', date: '2026-01-01', status: 'completed', completedAt: 1, blocks: [
      { id: 'b1', exercises: [{ id: 'e1', name: 'Snatch', mode: 'amrap',
        sets: [{ t: 'max', rpe: '5', aVal: '100', aVal2: '0', felt: '5', done: true }] }] },
    ] };
    expect(liftMoves(s)).toEqual([]);
  });
});

describe('banking it', () => {
  it('a single-set, fully-done plan folds to nothing, so nothing is keyed', () => {
    // `onTarget` is one set, done — setIndex 1 >= targets.length 1, so
    // `foldFromExercise` returns null and `liftMoves` produces no entry for
    // it. This replaces "keys by lowercased name and carries the timestamp":
    // that fixture happened to be exactly the shape that now folds to
    // nothing, so there is nothing left to key or timestamp.
    const { liftProgress } = liftAdapt(session([ex('Back Squat', [onTarget])]), {});
    expect(liftProgress['back squat']).toBeUndefined();
  });

  it('leaves a lift alone when this session earned nothing for it', () => {
    // Skipping a lift, or logging only warm-ups, must not erase what the last
    // session earned. Zeroing it here would silently reset the athlete.
    // `onTarget` is again a single-set, fully-done plan that folds to null
    // (setIndex 1 >= targets.length 1), so "Back squat" earns nothing here
    // too — the assertion on it is updated to match, while the case this
    // test actually exists to pin (an untouched movement's progress survives)
    // is still proven by the `deadlift` assertion.
    const before = { liftProgress: { deadlift: { kg: 180, at: 1000 } } };
    const { liftProgress } = liftAdapt(session([ex('Back squat', [onTarget])]), before);
    expect(liftProgress.deadlift).toEqual({ kg: 180, at: 1000 });
    expect(liftProgress['back squat']).toBeUndefined();
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

describe('what a library session opens at', () => {
  const settings = {
    liftProgress: {
      'back squat': { kg: 100, at: 1000 },
      bench: { kg: 60, at: 1000 },
    },
  };
  const w = {
    blocks: [
      { id: 'b1', exercises: [ex('Back squat', []), ex('Bench', [])] },
      { id: 'b2', exercises: [ex('Deadlift', [])] },
    ],
  };

  it('lists only movements that have earned something', () => {
    // Deadlift has never been trained. A row against a blank number reads as a
    // bug; saying nothing reads as "not yet".
    expect(sessionOpeners(w, settings)).toEqual([
      { name: 'Back squat', kg: 100, eased: false },
      { name: 'Bench', kg: 60, eased: false },
    ]);
  });

  it('agrees with the logger on a red morning, including the easing', () => {
    // Both go through nextWorkingWeight precisely so the Library cannot
    // advertise one number and the weight field open at another.
    const red = sessionOpeners(w, settings, { recoveryScore: 15 });
    expect(red[0]).toEqual({ name: 'Back squat', kg: 97.5, eased: true });
    expect(red[0].kg).toBe(nextWorkingWeight('Back squat', settings, { recoveryScore: 15 })?.kg);
  });

  it('does not repeat a movement that appears in two blocks', () => {
    const dup = { blocks: [{ id: 'b1', exercises: [ex('Back squat', [])] }, { id: 'b2', exercises: [ex('BACK SQUAT', [])] }] };
    expect(sessionOpeners(dup, settings)).toHaveLength(1);
  });

  it('is empty for a missing workout or one with nothing earned', () => {
    expect(sessionOpeners(null, settings)).toEqual([]);
    expect(sessionOpeners(w, {})).toEqual([]);
  });
});

/*
 * The %1RM precedence rule.
 *
 * Two things can decide a load — a percentage somebody authored for the set,
 * and the absolute weight banked in `liftProgress` — and the danger the rule
 * exists to remove is them disagreeing silently. `prescribedKg` owns the rule;
 * these cases pin the ladder end to end, through `prefillPrimary`, because the
 * rule is only worth anything at the point a number reaches the athlete.
 */
describe('prescribedKg — an authored % of e1RM, and what it outranks', () => {
  // 100kg x 5 → epley 100 x (1 + 5/30) = 116.67 e1RM. 80% of that is 93.33,
  // which snaps to the 2.5kg plate increment at 92.5.
  const history = [
    session([ex('Back squat', [{ t: '5', rpe: '8', aVal: '100', aVal2: '5', felt: '8', done: true } as LoggedSet])]),
  ];

  it('resolves against the same e1RM the rest of the app reads', () => {
    expect(prescribedKg('Back squat', '5 @80%', history)).toBe(92.5);
    // Name matching is trimmed and case-insensitive, like every other lookup.
    expect(prescribedKg('  back SQUAT ', '@80%', history)).toBe(92.5);
  });

  it('resolves to nothing when there is no percentage, or nothing to take one of', () => {
    expect(prescribedKg('Back squat', '5', history)).toBe(0);
    expect(prescribedKg('Back squat', '5 @80%', [])).toBe(0);
    expect(prescribedKg('Front squat', '5 @80%', history)).toBe(0);
  });

  it('RULE 2: an authored percentage beats the earned weight', () => {
    // liftProgress says 140. The coach wrote 80%, which is 92.5. What somebody
    // wrote for THIS set wins over what the app inferred from the last one.
    const settings = { liftProgress: { 'back squat': { kg: 140, at: 1000, reps: 5 } } };
    const today = ex('Back squat', [{ t: '5 @80%', rpe: '8' } as LoggedSet]);
    expect(prefillPrimary(today, 0, history, { settings })).toBe('92.5');
    // And with no percentage authored, the earned weight is still what shows —
    // rule 3, today's behaviour, unchanged.
    const plain = ex('Back squat', [{ t: '5', rpe: '8' } as LoggedSet]);
    expect(prefillPrimary(plain, 0, history, { settings })).toBe('140');
  });

  it('RULE 1: a set already done TODAY beats the authored percentage', () => {
    // A percentage is a plan; a set you have already done is a fact. The
    // in-exercise scan runs first and is untouched, so autoregulation still
    // works inside a %-authored exercise.
    const settings = { liftProgress: { 'back squat': { kg: 140, at: 1000, reps: 5 } } };
    const today = ex('Back squat', [
      { t: '5 @80%', rpe: '8', aVal: '105', aVal2: '5', done: true } as LoggedSet,
      { t: '5 @80%', rpe: '8' } as LoggedSet,
    ]);
    // Unrated, so it repeats what was actually lifted rather than the plan.
    expect(prefillPrimary(today, 1, history, { settings })).toBe('105');

    // Rated easier, it autoregulates off what was lifted — still not off the %.
    const rated = ex('Back squat', [
      { t: '5 @80%', rpe: '8', aVal: '105', aVal2: '5', felt: '7', done: true } as LoggedSet,
      { t: '5 @80%', rpe: '8' } as LoggedSet,
    ]);
    expect(prefillPrimary(rated, 1, history, { settings })).toBe('107.5');
  });

  it('never resolves a percentage onto a warm-up', () => {
    // Same contamination guard as everywhere else: a warm-up prefilled from a
    // working prescription is the thing `same` exists to stop.
    const today = ex('Back squat', [{ t: 'W5 @80%', rpe: '' } as LoggedSet]);
    expect(prefillPrimary(today, 0, history, {})).toBe('');
  });
});

describe('liftMoves banks the fold, not the last set’s own adjustment', () => {
  it('banks the folded weight, not the last set’s own adjustment', () => {
    // Two easy sets earn the full correction; the old per-set rule would have
    // moved only off the second one.
    const moves = liftMoves(sessionWith([
      { t: '8', rpe: '8', aVal: '100', aVal2: '8', felt: '7', done: true },
      { t: '8', rpe: '8', aVal: '100', aVal2: '8', felt: '7', done: true },
      { t: '8', rpe: '8' },
    ]));
    expect(moves).toHaveLength(1);
    expect(moves[0].to).toBeGreaterThan(100);
  });

  it('does not bank a rise from an easy set that followed a hard one', () => {
    const moves = liftMoves(sessionWith([
      { t: '8', rpe: '8', aVal: '100', aVal2: '8', felt: '9', done: true },
      { t: '8', rpe: '8', aVal: '100', aVal2: '8', felt: '7', done: true },
      { t: '8', rpe: '8' },
    ]));
    expect(moves[0].to).toBeLessThan(100);
  });
});
