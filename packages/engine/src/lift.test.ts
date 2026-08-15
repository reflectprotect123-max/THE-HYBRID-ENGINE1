/*
 * Strength progression across sessions.
 *
 * NOT in test/golden: those vectors were harvested from the vanilla `app.js`
 * and mean "this still matches the original". `liftAdapt` has no counterpart
 * there — the vanilla app never carried a working weight forward either — so a
 * file in that directory would claim a parity that does not exist.
 *
 * What it does reuse is the fold (`foldNextOpener`), whose walk IS
 * golden-tested through `foldExercise`. These cases are about the decisions
 * layered on top: which set is judged, what happens when nothing was earned,
 * and how the recovery gate behaves.
 */
import { describe, expect, it } from 'vitest';
import { liftAdapt, liftMoves, nextWorkingWeight, prescribedKg, sessionOpeners } from './lift';
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

/** On target at the 8.5 default centre: the weight holds. */
const onTarget = { t: '5', rpe: '8.5', aVal: '100', aVal2: '5', felt: '8.5', done: true };

describe('which set decides the next weight', () => {
  it('reads EVERY set, so a hard last set still costs weight', () => {
    const s = session([
      ex('Back squat', [
        { t: '5', rpe: '8', aVal: '100', aVal2: '5', felt: '6', done: true },
        { t: '5', rpe: '8', aVal: '105', aVal2: '5', felt: '9.5', done: true },
      ]),
    ]);
    /*
     * The 105 at 9.5 is in the walk, not just the 100 at 6 — a session that
     * ramps up must not be scored on how the first set felt alone. By hand,
     * k = kFor(5) = 2.5:
     *   set 1: dev = 8 − 6 = +2, easy, half now → ×(1 + 2.5×2/2 / 100) = ×1.025
     *   set 2: dev = 8 − 9.5 = −1.5, hard, in full → ×(1 − 2.5×1.5 / 100)
     *          = ×0.9625, and the exercise LOCKS
     *   adj = 1.025 × 0.9625 = 0.98656…
     *   opener 100 × 0.98656 = 98.656 → /2.5 = 39.46 → 39 → 97.5
     *
     * `from` is the OPENER (100), not the 105 the last set was done at: it is
     * the weight `to` is priced off, and the only one it can be subtracted
     * from. This assertion read 105 until 13 August 2026, which is exactly the
     * incoherence — 105 → 97.5 was a −7.5 delta between two numbers that
     * answered different questions.
     */
    const [m] = liftMoves(s);
    expect(m.from).toBe(100);
    expect(m.to).toBe(97.5);
    expect(m.delta).toBe(-2.5);
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
    expect(m.verdict).toBe('backed off — harder than asked');
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

  it('banks the working effort, not a later lighter block', () => {
    const s: Session = { id: 's', date: '2026-01-01', status: 'completed', completedAt: 1, blocks: [
      { id: 'b1', exercises: [{ id: 'e1', name: 'Back Squat', mode: 'reps_kg',
        sets: [{ t: '5', rpe: '8', aVal: '100', aVal2: '5', felt: '8', done: true }] }] },
      { id: 'b2', exercises: [{ id: 'e2', name: 'Back Squat', mode: 'reps_kg',
        sets: [{ t: '3', rpe: '9', aVal: '60', aVal2: '3', felt: '6', done: true }] }] },
    ] };
    const mv = liftMoves(s);
    expect(mv.length).toBe(1);
    expect(mv[0].from).toBe(100);
    expect(liftAdapt(s, {}).liftProgress['back squat'].kg).toBe(100);
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
 * exists to remove is them disagreeing silently.
 *
 * THESE CASES USED TO RUN THROUGH `prefillPrimary`, deliberately, "because the
 * rule is only worth anything at the point a number reaches the athlete".
 * `prefillPrimary` was the WEB logger's, and it was deleted on 15 August 2026
 * — which leaves `prescribedKg` and `nextWorkingWeight` with no caller that
 * puts their answer in front of anybody. `openDraft` in
 * `@hybrid/session-authoring` opens the phone's entry field from
 * `foldFromExercise` alone, which prices off THIS session's opener and knows
 * nothing about an authored percentage or a banked weight.
 *
 * So the sentence above is still true and is now an indictment rather than a
 * justification. The rule below is tested at the unit it lives in; nothing
 * carries it to the athlete. Wiring that is task #168, and these are the
 * assertions it has to keep true.
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

  it('RULE 2: an authored percentage OUTRANKS the earned weight', () => {
    // liftProgress says 140. The coach wrote 80%, which is 92.5. What somebody
    // wrote for THIS set wins over what the app inferred from the last one.
    const settings = { liftProgress: { 'back squat': { kg: 140, at: 1000, reps: 5 } } };
    expect(prescribedKg('Back squat', '5 @80%', history)).toBe(92.5);
    expect(nextWorkingWeight('Back squat', settings)!.kg).toBe(140);

    // And with no percentage authored there is nothing to outrank it with, so
    // the earned weight stands alone — rule 3.
    expect(prescribedKg('Back squat', '5', history)).toBe(0);
  });

  it('RULE 3: with no e1RM to take a percentage OF, it declines rather than guesses', () => {
    /* Returning 0 is what lets a caller fall through to the earned weight. A
       first session has nothing to take a percentage of, and putting a guess
       under a barbell on no evidence is the failure this avoids. */
    expect(prescribedKg('Back squat', '5 @80%', [])).toBe(0);
  });
});


const sessionWith = (sets: LoggedSet[]): Session => ({
  id: 's1', date: '2026-08-12', status: 'completed',
  blocks: [{ id: 'b1', exercises: [{ id: 'e1', name: 'Back Squat', mode: 'reps_kg', sets }] }],
});

it('banks the folded opener from a fully logged exercise', () => {
  const moves = liftMoves(sessionWith([
    { t: '8', rpe: '8', aVal: '100', aVal2: '8', felt: '7', done: true },
    { t: '8', rpe: '8', aVal: '100', aVal2: '8', felt: '7', done: true },
  ]));
  expect(moves).toHaveLength(1);
  expect(moves[0].to).toBe(102.5);
});

it('does not bank a rise from an easy set that followed a hard one', () => {
  const moves = liftMoves(sessionWith([
    { t: '8', rpe: '8', aVal: '100', aVal2: '8', felt: '9', done: true },
    { t: '8', rpe: '8', aVal: '100', aVal2: '8', felt: '7', done: true },
  ]));
  expect(moves[0].to).toBe(97.5);
});

/*
 * A RAMPED exercise — the case every other fixture in this file misses.
 *
 * Flat sets hide an entire class of bug, because on 100/100/100 the opener and
 * the last working set are the same number and any pairing of them looks
 * right. On 100/110/120 they are not, and `from`/`to` have to be two answers
 * to the SAME question or the recap prints "120 → 100, hold".
 *
 * Every set here is 5 reps against a `'5' @ 8` target, so the rep floor is met
 * throughout and `k = kFor(5) = 2.5`.
 */
const ramp = (felt: [string, string, string], reps: [string, string, string] = ['5', '5', '5']) =>
  sessionWith([
    { t: '5', rpe: '8', aVal: '100', aVal2: reps[0], felt: felt[0], done: true },
    { t: '5', rpe: '8', aVal: '110', aVal2: reps[1], felt: felt[1], done: true },
    { t: '5', rpe: '8', aVal: '120', aVal2: reps[2], felt: felt[2], done: true },
  ]);

describe('a ramped exercise', () => {
  it('reports the opener as `from`, so `delta` is a real difference', () => {
    // All three sets rated exactly as asked: dev = 8 − 8 = 0 every time, which
    // is inside the ±1 dead band, so adj stays 1 and nothing locks.
    //   opener 100 × 1 = 100 → roundToIncrement(100, 2.5) = 100
    // from 100, to 100, delta 0 — and the verdict says hold, which now agrees
    // with the numbers beside it. Before 13 August 2026 this same session
    // produced from 120, to 100, delta −20, verdict "hold — open here again".
    const [m] = liftMoves(ramp(['8', '8', '8']));
    expect(m.from).toBe(100);
    expect(m.to).toBe(100);
    expect(m.delta).toBe(0);
    expect(m.verdict).toBe('hold — open here again');
  });

  it('prices a rise off the opener, not off the top of the ramp', () => {
    // Every set a full point easy: dev = 8 − 7 = +1, half now = 2.5×1/2 =
    // 1.25% per set, nothing locks, three easy sets so the one-set cap does
    // not apply (easyRun = 3, not 1).
    //   adj = 1.0125³ = 1.037970…
    //   100 × 1.037970 = 103.797 → /2.5 = 41.52 → 42 → 105
    // +5 off the opener. Priced off the 120 instead it would have read
    // 120 → 105, a five-kilo RISE printed as a fifteen-kilo drop.
    const [m] = liftMoves(ramp(['7', '7', '7']));
    expect(m.from).toBe(100);
    expect(m.to).toBe(105);
    expect(m.delta).toBe(5);
    expect(m.verdict).toBe('two easy sets — full correction');
  });

  it('prices a back-off off the opener too', () => {
    // Sets 1 and 2 on target (dev 0). Set 3 rated 9.5: dev = 8 − 9.5 = −1.5,
    // harder than asked, applied in full and the exercise locks.
    //   adj = 1 − 2.5×1.5/100 = 0.9625
    //   100 × 0.9625 = 96.25 → /2.5 = 38.5 → 39 → 97.5
    // A one-notch back-off is −2.5 from the opener. Measured against the 120
    // it read −22.5, which is not a step any rule in this engine can take.
    const [m] = liftMoves(ramp(['8', '8', '9.5']));
    expect(m.from).toBe(100);
    expect(m.to).toBe(97.5);
    expect(m.delta).toBe(-2.5);
    expect(m.verdict).toBe('backed off — harder than asked');
  });

  it('reports the reps of the SAME set `from` describes', () => {
    // The opener is 5 reps; the top set stops at 3, missing the floor. The
    // walk scores that miss at RPE 10.5 whatever it was rated:
    //   dev = 8 − 10.5 = −2.5 → 2.5 × −2.5 = −6.25% (inside the 7.5% ceiling)
    //   adj = 0.9375 → 100 × 0.9375 = 93.75 → /2.5 = 37.5 → 38 → 95
    // `reps` must be 5, the opener's. Reporting the last set's 3 beside a
    // `from` of 100 would describe a 100kg × 3 that nobody performed — and
    // `liftAdapt` banks this pair into `liftProgress` as the record of what
    // the weight was earned at.
    const [m] = liftMoves(ramp(['8', '8', '8'], ['5', '5', '3']));
    expect(m.from).toBe(100);
    expect(m.reps).toBe(5);
    expect(m.to).toBe(95);
    expect(m.delta).toBe(-5);
    expect(liftAdapt(ramp(['8', '8', '8'], ['5', '5', '3']), {}).liftProgress['back squat'])
      .toEqual({ kg: 95, at: expect.any(Number), reps: 5 });
  });
});
