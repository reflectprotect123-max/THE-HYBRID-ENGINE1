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
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { liftAdapt, liftMoves, nextWorkingWeight, openingLoadFor, prescribedKg, sessionOpeners } from './lift';
import type { Exercise, LoggedSet, Session } from './types';

/*
 * Stage 5 of the RPE progression design reads `Date.now()` (inside
 * `calibrationStateFor`, called from `nextWorkingWeight`/`openingLoadFor`
 * whenever `ctx.sessions` is supplied) to detect a layoff. Every fixture in
 * this file predates that stage and uses small synthetic timestamps for
 * ORDERING only — `completedAt: 5000` means "session five", not a date near
 * the Unix epoch. Against the REAL wall clock every one of them is decades
 * old, which would make every history-bearing test a false "back after a
 * break". Pinning the clock just above the largest synthetic timestamp any
 * fixture here uses keeps `Date.now()` real-shaped without dragging every
 * existing case into a layoff gap that was never the point of the test.
 */
const FIXED_NOW = 50_000;
beforeAll(() => vi.useFakeTimers({ now: FIXED_NOW }));
afterAll(() => vi.useRealTimers());

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
    // `e1rm` rides alongside — the anchor `anchorForOpener` derived from this
    // same opener (100kg @ 5 reps, rpe 8.5), banked so a later session whose
    // plan changes the rep scheme can re-price it. See lift.ts, stage 1.
    expect(liftProgress['back squat']).toMatchObject({ kg: 100, at: 5000, reps: 5 });
    expect(liftProgress['back squat'].e1rm).toBeCloseTo(121.667, 2);
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

describe('what to offer after a layoff — Stage 5 of the RPE progression design', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const GAP = 21 * DAY;
  const goneQuiet = [
    session(
      [ex('Back squat', [{ t: '5', rpe: '8', aVal: '100', aVal2: '5', felt: '8', done: true } as LoggedSet])],
      FIXED_NOW - GAP - DAY,
    ),
  ];

  it('offers a reduced weight, not the full earned number, once a movement has gone quiet', () => {
    // 100kg earned, 10% off (AUTOREG.calibrationReductionPct) → 90, which is
    // already a plate-clean number so rounding does not obscure the figure.
    const w = nextWorkingWeight('Back squat', settingsFor(100), undefined, undefined, goneQuiet);
    expect(w?.kg).toBe(90);
    expect(w?.earned).toBe(100);
    expect(w?.note).toBe('back after a break — offering less so today can find where you actually are');
  });

  it('offers the full weight when the same history has no gap in it', () => {
    const recent = [
      session(
        [ex('Back squat', [{ t: '5', rpe: '8', aVal: '100', aVal2: '5', felt: '8', done: true } as LoggedSet])],
        FIXED_NOW - DAY,
      ),
    ];
    expect(nextWorkingWeight('Back squat', settingsFor(100), undefined, undefined, recent)?.kg).toBe(100);
  });

  it('omitting sessions entirely behaves exactly as before this stage', () => {
    // The 5th parameter is additive — every caller that omits it keeps
    // today's behaviour, same as `target` before it.
    expect(nextWorkingWeight('Back squat', settingsFor(100))?.kg).toBe(100);
  });

  function settingsFor(kg: number) {
    return { liftProgress: { 'back squat': { kg, at: 1 } } };
  }
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
 * `openingLoadFor` is that caller, added the same day (task #168). The
 * sentence above is true again rather than an indictment: the ladder below is
 * tested at the unit it lives in, AND at the function that carries it to the
 * phone's weight field. See the `openingLoadFor` block at the end of this file.
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
    const banked = liftAdapt(ramp(['8', '8', '8'], ['5', '5', '3']), {}).liftProgress['back squat'];
    expect(banked).toMatchObject({ kg: 95, at: expect.any(Number), reps: 5 });
    expect(banked.e1rm).toBeCloseTo(123.333, 2);
  });
});

/*
 * THE LADDER, at the function that actually reaches the athlete.
 *
 * Everything above tests a rung. These test the ORDER, which is the part that
 * was missing: `prescribedKg` and `nextWorkingWeight` were both correct and
 * both unreachable, and the bug was never in either of them — it was that
 * `openDraft` asked the fold and stopped.
 */
describe('openingLoadFor — what the weight field opens at', () => {
  const history = [
    session([ex('Back squat', [{ t: '5', rpe: '8', aVal: '100', aVal2: '5', felt: '8', done: true } as LoggedSet])]),
  ];
  const earned140 = { liftProgress: { 'back squat': { kg: 140, at: 1000, reps: 5 } } };

  it('THE BUG: an untouched exercise no longer opens at zero', () => {
    /* This is the whole task. `foldFromExercise` answers for set 0 of an
       untouched exercise with `{ kg: 0, message: 'bodyweight' }`, because the
       opener is read off a weight nobody has entered yet — so a caller that
       treated any non-null fold as the answer got 0 every time and never
       reached the banked weight below it. */
    const fresh = ex('Back squat', [{ t: '5', rpe: '8' } as LoggedSet]);
    expect(openingLoadFor(fresh, 0).kg).toBe(0);
    expect(openingLoadFor(fresh, 0, { settings: earned140 }).kg).toBe(140);
  });

  it('RULE 1: a set already done TODAY beats everything below it', () => {
    /* The fold prices from this session's own logged sets. A percentage is a
       plan and the earned weight is an inference; a set you already did is a
       fact, and autoregulation has to keep working inside a %-authored
       exercise exactly as it does anywhere else. */
    const rated = ex('Back squat', [
      { t: '5 @80%', rpe: '8', aVal: '105', aVal2: '5', felt: '7', done: true } as LoggedSet,
      { t: '5 @80%', rpe: '8' } as LoggedSet,
    ]);
    const kg = openingLoadFor(rated, 1, { sessions: history, settings: earned140 }).kg;
    expect(kg).toBeGreaterThan(105);
    // Not the percentage (92.5) and not the banked weight (140).
    expect(kg).not.toBe(92.5);
    expect(kg).not.toBe(140);
  });

  it('RULE 2: an authored percentage beats the earned weight', () => {
    const asked = ex('Back squat', [{ t: '5 @80%', rpe: '8' } as LoggedSet]);
    expect(openingLoadFor(asked, 0, { sessions: history, settings: earned140 }).kg).toBe(92.5);
  });

  it('RULE 3: with no percentage authored, the earned weight stands', () => {
    const plain = ex('Back squat', [{ t: '5', rpe: '8' } as LoggedSet]);
    expect(openingLoadFor(plain, 0, { sessions: history, settings: earned140 }).kg).toBe(140);
  });

  it('RULE 3: the earned weight arrives EASED on a red morning', () => {
    /* `nextWorkingWeight` owns the gate and this function must not re-apply or
       bypass it — the number the field opens at is the eased one, and the
       athlete can still type over it. */
    const plain = ex('Back squat', [{ t: '5', rpe: '8' } as LoggedSet]);
    const red = { recoveryScore: 20, at: Date.now() } as never;
    expect(openingLoadFor(plain, 0, { settings: earned140, whoop: red }).kg).toBe(137.5);
  });

  it('RULE 4: a movement with no history and no prescription opens blank, not guessed', () => {
    const unknown = ex('Zercher squat', [{ t: '5', rpe: '8' } as LoggedSet]);
    expect(openingLoadFor(unknown, 0, { sessions: history, settings: earned140 }).kg).toBe(0);
  });

  it('asks nothing of a non-lift mode — reps and seconds have no load axis', () => {
    /* A percentage and a banked weight are both meaningless for a plank. The
       fold still runs first, so a timed exercise that somehow logged a load
       is not overridden. */
    const held = ex('Plank', [{ t: '60', rpe: '7' } as LoggedSet], 'seconds');
    expect(openingLoadFor(held, 0, { sessions: history, settings: earned140 }).kg).toBe(0);
  });

  it('the LINE agrees with the number, at every rung', () => {
    /*
     * THE DEFECT THIS FIELD EXISTS TO PREVENT, and it is not hypothetical —
     * it was live for the length of one edit while this task was being
     * written. `view.ts` composed the coaching line from `foldFromExercise`
     * directly, so an untouched exercise said "bodyweight". That was at least
     * CONSISTENT while the field also opened at 0. The moment the field
     * started opening at the banked weight, the screen would have shown
     * "bodyweight" beside 140kg — two numbers contradicting each other on one
     * card, which is the failure this codebase has already paid for once in
     * the logger's hint.
     *
     * So both come out of one call now, and every rung's line is asserted
     * against its own rung.
     */
    const fresh = ex('Back squat', [{ t: '5', rpe: '8' } as LoggedSet]);
    expect(openingLoadFor(fresh, 0, { settings: earned140 })).toEqual({
      kg: 140,
      message: 'what you earned last time',
      source: 'earned',
    });

    const asked = ex('Back squat', [{ t: '5 @80%', rpe: '8' } as LoggedSet]);
    expect(openingLoadFor(asked, 0, { sessions: history, settings: earned140 })).toEqual({
      kg: 92.5,
      message: '80% of your best — as written',
      source: 'prescribed',
    });

    const unknown = ex('Zercher squat', [{ t: '5', rpe: '8' } as LoggedSet]);
    const none = openingLoadFor(unknown, 0, { sessions: history, settings: earned140 });
    expect(none.kg).toBe(0);
    expect(none.source).toBe('none');
    // NOT the fold's 'bodyweight'. It says that for any exercise whose opener
    // is not positive, which on an untouched barbell lift means "nobody has
    // typed a weight yet" — a different fact, and one the athlete needs told
    // apart from a movement that genuinely carries no load.
    expect(none.message).toBe('first time on this — put something on the bar');

    // The other half of that split: logged before, with reps and no load, is
    // a bodyweight movement and should go on saying so.
    const chins = [session([ex('Chin-up', [{ t: '8', rpe: '8', aVal2: '8', felt: '8', done: true } as LoggedSet])])];
    const bw = openingLoadFor(ex('Chin-up', [{ t: '8', rpe: '8' } as LoggedSet]), 0, { sessions: chins });
    expect(bw.kg).toBe(0);
    expect(bw.message).toBe('bodyweight');

    const red = { recoveryScore: 20, at: Date.now() } as never;
    const eased = openingLoadFor(fresh, 0, { settings: earned140, whoop: red });
    expect(eased.kg).toBe(137.5);
    // `nextWorkingWeight` composes this itself — it is the only layer that
    // holds the recovery figure, so the line is passed through, not rebuilt.
    expect(eased.message).toBe('eased for 20% recovery');
  });

  it('NEVER offers a warm-up the working weight', () => {
    /*
     * THE REGRESSION THIS PINS WAS MINE, and it was live for a few hours on
     * 16 August 2026: `openingLoadFor` fell through to `nextWorkingWeight` for
     * a `W`-marked set and offered 140kg for a warm-up. Its own doc claimed
     * `openDraft` "asks only for working sets" — it asks about whatever
     * `nextUp` returns, and a warm-up set inside a lift block is in that
     * queue.
     *
     * Every other layer already guards this. `liftMoves` skips warm-up blocks
     * so an empty bar at RPE 3 cannot teach the progression that bench is
     * 20kg; `readExercise` drops warm-up sets before folding. This is the same
     * rule at the point a number reaches the athlete.
     */
    const warmed = ex('Back squat', [
      { t: 'W10', rpe: '' } as LoggedSet,
      { t: '5', rpe: '8' } as LoggedSet,
    ]);
    expect(openingLoadFor(warmed, 0, { sessions: history, settings: earned140 }).kg).toBe(0);
    // The WORKING set beside it is unaffected — the guard is per set, not per
    // exercise, or a single warm-up would blank the whole movement.
    expect(openingLoadFor(warmed, 1, { sessions: history, settings: earned140 }).kg).toBe(140);
  });

  it('honours a warm-up weight the coach actually wrote, but not a percentage', () => {
    /*
     * The line between them is where the number COMES FROM. "@40kg" is
     * derived from nothing — it is forty kilos, and refusing to show it would
     * throw away the only instruction the coach gave. "@80%" resolves against
     * the working e1RM, so it is a working-weight-derived number wearing a
     * warm-up's clothes; the deleted `prefillPrimary` refused it in a test
     * named for exactly that.
     */
    const authored = ex('Back squat', [{ t: 'W5 @40kg', rpe: '' } as LoggedSet]);
    expect(openingLoadFor(authored, 0, { sessions: history, settings: earned140 })).toEqual({
      kg: 40,
      message: 'your coach’s warm-up weight',
      source: 'prescribed',
    });

    const pct = ex('Back squat', [{ t: 'W5 @80%', rpe: '' } as LoggedSet]);
    expect(openingLoadFor(pct, 0, { sessions: history, settings: earned140 }).kg).toBe(0);
  });

  it('answers 0 for a set index that does not exist rather than throwing', () => {
    expect(openingLoadFor(ex('Back squat', []), 0, { settings: earned140 }).kg).toBe(0);
    expect(openingLoadFor(ex('Back squat', [{ t: '5', rpe: '8' } as LoggedSet]), 9, { settings: earned140 }).kg).toBe(0);
  });

  it('THE WAVE, banked from an e1RM rather than a flat kilo — stage 1 of the RPE progression design', () => {
    /*
     * The bug this stage exists to fix, in the owner's own words: "what if
     * one week its 10,8,6 then the next its 9,7,5 or 8,6,4 an or 3 x 5 or
     * 5/3/1". Before this stage, `liftAdapt` banked only the flat kilo
     * earned (100kg), so every one of these opened at 100 regardless of the
     * plan. With an e1RM banked alongside it, each scheme re-prices off the
     * SAME anchor. Table from docs/superpowers/specs/2026-08-16-rpe-
     * progression-design.md — computed here through the real functions,
     * not restated as arithmetic, so a change to `anchorFor`/`plannedKg`
     * fails this test rather than quietly agreeing with itself.
     */
    const earnedFromTenWave = {
      liftProgress: { 'back squat': { kg: 100, at: 1000, reps: 10, e1rm: 140 } },
    };
    const openerFor = (t: string, rpe: string) =>
      openingLoadFor(ex('Back squat', [{ t, rpe } as LoggedSet]), 0, { settings: earnedFromTenWave }).kg;

    /*
     * ROUNDED TO THE RACK, not the raw division. `plannedKg` is a bare
     * `anchor / (1 + repsToFailure(...) / EPLEY_DIV)` and was reaching the
     * athlete unrounded — 102.4390243902439 kg for the 9,7,5 scheme, a number
     * no plate combination expresses — until `nextWorkingWeight` gained an
     * `increment` parameter to round it, the same way every OTHER path in
     * this file already rounds. Found auditing this very stage: the values
     * below (and the design doc's own table) were originally written from
     * the unrounded numbers, which `toBeCloseTo(…, 1)`'s tolerance let pass
     * without ever printing a number nobody could rack.
     */
    expect(openerFor('10', '8')).toBe(100);
    expect(openerFor('9', '8')).toBe(102.5);
    expect(openerFor('8', '8')).toBe(105);
    expect(openerFor('5', '8')).toBe(112.5); // 3×5
    expect(openerFor('1', '9')).toBe(132.5); // 5/3/1, the single
  });

  it('a record banked before this stage — no e1RM at all — behaves exactly as it did before it', () => {
    /* The compatibility assertion the design calls for by name: a session
       logged before `e1rm` existed takes the untouched `kg` path, whatever
       today's plan asks for. */
    const noAnchor = { liftProgress: { 'back squat': { kg: 100, at: 1000, reps: 10 } } };
    const openerFor = (t: string, rpe: string) =>
      openingLoadFor(ex('Back squat', [{ t, rpe } as LoggedSet]), 0, { settings: noAnchor }).kg;

    expect(openerFor('10', '8')).toBe(100);
    expect(openerFor('9', '8')).toBe(100);
    expect(openerFor('5', '8')).toBe(100);
  });
});
