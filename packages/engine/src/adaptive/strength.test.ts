import { describe, expect, it } from 'vitest';
import { decideStrengthProgression } from './strength';
import { decideStrengthProgression as fromIndex } from '../index';
import { liftMoves } from '../lift';
import type { LoggedSet, Session } from '../types';

/** A single completed, non-warmup working set with a real target attached. */
const set = (aVal: string, aVal2: string, felt: string, t: string, rpe: string): LoggedSet =>
  ({ done: true, aVal, aVal2, felt, t, rpe }) as LoggedSet;

function sessionWith(id: string, at: number, s: LoggedSet, exerciseName = 'Bench press'): Session {
  return {
    id,
    date: '2026-01-01',
    status: 'completed',
    completedAt: at,
    blocks: [
      {
        id: 'b',
        heading: 'Main',
        superset: false,
        exercises: [{ id: 'e', name: exerciseName, mode: 'reps_kg', rest: 90, sets: [s] }],
      },
    ],
  } as unknown as Session;
}

/** One exercise entry carrying SEVERAL sets — which of them is the exposure. */
function sessionWithSets(
  id: string,
  at: number,
  sets: LoggedSet[],
  exerciseName = 'Bench press',
): Session {
  return {
    id,
    date: '2026-01-01',
    status: 'completed',
    completedAt: at,
    blocks: [
      {
        id: 'b',
        heading: 'Main',
        superset: false,
        exercises: [{ id: 'e', name: exerciseName, mode: 'reps_kg', rest: 90, sets }],
      },
    ],
  } as unknown as Session;
}

/** The same movement twice in one session: the working block, then a back-off. */
function sessionWithBackOff(
  id: string,
  at: number,
  working: LoggedSet,
  backOff: LoggedSet,
  exerciseName = 'Bench press',
): Session {
  const blk = (bid: string, heading: string, st: LoggedSet) => ({
    id: bid,
    heading,
    superset: false,
    exercises: [{ id: bid + 'e', name: exerciseName, mode: 'reps_kg', rest: 90, sets: [st] }],
  });
  return {
    id,
    date: '2026-01-01',
    status: 'completed',
    completedAt: at,
    blocks: [blk('b1', 'Main', working), blk('b2', 'Back-off', backOff)],
  } as unknown as Session;
}

describe('decideStrengthProgression — insufficient data', () => {
  it('pauses when fewer than 3 exposures are logged', () => {
    for (const count of [0, 1, 2]) {
      const sessions = Array.from({ length: count }, (_, i) =>
        sessionWith('s' + i, (i + 1) * 1000, set('100', '8', '8', '8-10', '8')),
      );
      const out = decideStrengthProgression('Bench press', sessions, { t: '8-10', rpe: '8' });
      expect(out.action).toBe('pause_insufficient_data');
      expect(out.confidence).toBe('low');
      expect(out.reasonCodes).toEqual(['insufficient_exposure_history']);
      expect(out.prescription).toBeUndefined();
    }
  });
});

describe('decideStrengthProgression — progression', () => {
  it('suggests a load step once on target at the top of the rep range', () => {
    const s = (id: string, at: number, reps: string) => sessionWith(id, at, set('100', reps, '8', '8-10', '8'));
    const sessions = [s('s0', 1000, '8'), s('s1', 2000, '10'), s('s2', 3000, '10')];
    const out = decideStrengthProgression('Bench press', sessions, { t: '8-10', rpe: '8' });
    expect(out.action).toBe('progress_load');
    expect(out.prescription).toEqual({ load: 102.5 });
    expect(out.reasonCodes).toEqual(['consistently_on_target']);
  });

  it('holds rather than prescribing FEWER reps than the field is already showing', () => {
    /*
     * The bug this pins. `prefillSecondary` opens the Reps field at
     * `repTopOf('8-10')` — 10. Two on-target sessions of 8 reps used to produce
     * "try 9 reps next time", and Apply WROTE 9 over the 10 already there: the
     * suggestion talked the athlete down. One more rep than last time is only a
     * progression when it beats what the plan already asks for.
     */
    const s = (id: string, at: number) => sessionWith(id, at, set('100', '8', '8', '8-10', '8'));
    const sessions = [s('s0', 1000), s('s1', 2000), s('s2', 3000)];
    const out = decideStrengthProgression('Bench press', sessions, { t: '8-10', rpe: '8' });
    expect(out.action).toBe('hold');
    expect(out.prescription).toBeUndefined();
    expect(out.reasonCodes).toEqual(['already_at_rep_target']);
    expect(out.note).toContain('10 reps');
  });

  it('holds when the earned weight has already banked the step the load branch would offer', () => {
    // Set 1 is rated a FULL point easy (felt 7 vs rpe 8), which is where the
    // fold's walk starts to move: +1.25% off the 100kg opener, and
    // `roundToIncrement` carries 101.25 up to 102.5 — exactly the step this
    // branch would offer. Set 2 stays at 100 and is rated on target, so the
    // exposure (the last working set) still classifies on-target. lift.ts has
    // already banked 102.5 into the field; repeating it is not a suggestion.
    const s = (id: string, at: number) =>
      sessionWithSets(id, at, [set('100', '5', '7', '5', '8'), set('100', '5', '8', '5', '8')]);
    const sessions = [s('s0', 1000), s('s1', 2000), s('s2', 3000)];
    const out = decideStrengthProgression('Bench press', sessions, { t: '5', rpe: '8' });
    expect(out.action).toBe('hold');
    expect(out.prescription).toBeUndefined();
    expect(out.reasonCodes).toEqual(['already_at_earned_load']);
  });

  it('suggests one more rep for a bodyweight exercise once it is at the top of the range', () => {
    const s = (id: string, at: number) => sessionWith(id, at, set('', '15', '8', '10-15', '8'), 'Pull-up');
    const sessions = [s('s0', 1000), s('s1', 2000), s('s2', 3000)];
    const out = decideStrengthProgression('Pull-up', sessions, { t: '10-15', rpe: '8' });
    expect(out.action).toBe('progress_reps');
    expect(out.prescription).toEqual({ reps: 16 });
    expect(out.reasonCodes).toEqual(['consistently_on_target']);
  });

  it('holds a bodyweight exercise still short of the range top — the field already asks for more', () => {
    const s = (id: string, at: number) => sessionWith(id, at, set('', '12', '8', '10-15', '8'), 'Pull-up');
    const sessions = [s('s0', 1000), s('s1', 2000), s('s2', 3000)];
    const out = decideStrengthProgression('Pull-up', sessions, { t: '10-15', rpe: '8' });
    expect(out.action).toBe('hold');
    expect(out.prescription).toBeUndefined();
    expect(out.reasonCodes).toEqual(['already_at_rep_target']);
  });

  it('suggests one more rep when the target names no rep ceiling at all', () => {
    // `repTopOf('max')` is '' — the Reps field opens EMPTY, so any count is new
    // information rather than a number written over a bigger one.
    const s = (id: string, at: number) => sessionWith(id, at, set('', '12', '8', 'max', '8'), 'Pull-up');
    const sessions = [s('s0', 1000), s('s1', 2000), s('s2', 3000)];
    const out = decideStrengthProgression('Pull-up', sessions, { t: 'max', rpe: '8' });
    expect(out.action).toBe('progress_reps');
    expect(out.prescription).toEqual({ reps: 13 });
  });
});

describe('decideStrengthProgression — deload', () => {
  it('suggests a step down when the in-session drop was smaller than a plate step', () => {
    // 20kg missed: the fold scores the miss at effective RPE 10.5 — a −2.5
    // deviation at 2.5%/point for a 5-rep floor is 6.25%, 1.25kg — which
    // rounds back to 20. The field still shows 20, so there IS a deload left
    // to offer. Ten percent off 20 is 18, which rounds to 17.5 at the plate
    // increment — the same answer the flat step gave here, because at this
    // weight one plate and one tenth are within a rounding step of each other.
    const s = (id: string, at: number) => sessionWith(id, at, set('20', '3', '8', '5', '8'));
    const sessions = [s('s0', 1000), s('s1', 2000), s('s2', 3000)];
    const out = decideStrengthProgression('Bench press', sessions, { t: '5', rpe: '8' });
    expect(out.action).toBe('deload');
    expect(out.prescription).toEqual({ load: 17.5 });
    expect(out.reasonCodes).toEqual(['consistently_missed']);
  });

  it('never proposes MORE weight than the misses have already taken off', () => {
    /*
     * The clamp, with the reviewer's own worked example: 100kg missed banks 95
     * for next time, 95kg missed banks 90. `Math.min(cut, shownKg)` is what
     * keeps a deload a CUT — without it, an arithmetic that lands above the
     * number the field is already showing would add weight on a card whose
     * other line reads "earned 90kg last time".
     *
     * THE ANSWER CHANGED WHEN THE DELOAD BECAME A PROPORTION (15 August 2026)
     * and the change is the whole improvement. A flat 2.5kg off 95 is 92.5,
     * ABOVE the 90 already earned, so the clamp bit and the honest output was
     * "hold — the weight has already come down". Ten percent off 95 is 85.5,
     * which rounds to 85 and is genuinely below 90, so there is a real cut
     * left to offer and it is offered.
     *
     * That is the difference between the two constants stated as a number:
     * the fold's own per-session correction is about 6.25%, so a 2.5kg deload
     * was almost always redundant by the time it fired. Two consecutive misses
     * are supposed to go DEEPER than one session's autoregulation did.
     */
    const s = (id: string, at: number, kg: string) => sessionWith(id, at, set(kg, '3', '8', '5', '8'));
    const sessions = [s('s0', 1000, '100'), s('s1', 2000, '100'), s('s2', 3000, '95')];
    const out = decideStrengthProgression('Bench press', sessions, { t: '5', rpe: '8' });
    expect(out.action).toBe('deload');
    expect(out.prescription).toEqual({ load: 85 });
    expect(out.reasonCodes).toEqual(['consistently_missed']);
  });

  it('the cut is measured off what was LIFTED, so the fold is not double-counted', () => {
    /*
     * 100kg missed. The fold has already banked ~93.75 for next time; the
     * deload proposes 90, which is ten percent off the hundred that was
     * actually lifted — not ten percent off the already-reduced number, which
     * would compound one miss into a 16% cut.
     */
    const s = (id: string, at: number) => sessionWith(id, at, set('100', '3', '8', '5', '8'));
    const sessions = [s('s0', 1000), s('s1', 2000), s('s2', 3000)];
    const out = decideStrengthProgression('Bench press', sessions, { t: '5', rpe: '8' });
    expect(out.action).toBe('deload');
    expect(out.prescription).toEqual({ load: 90 });
  });

  it('never suggests a load below AUTOREG.stepKg — at the floor there is nothing left to offer', () => {
    const s = (id: string, at: number) => sessionWith(id, at, set('2.5', '3', '8', '5', '8'));
    const sessions = [s('s0', 1000), s('s1', 2000), s('s2', 3000)];
    const out = decideStrengthProgression('Bench press', sessions, { t: '5', rpe: '8' });
    expect(out.action).toBe('hold');
    expect(out.prescription).toBeUndefined();
  });

  it('holds instead of deloading a bodyweight exercise that was missed twice — nothing to deload', () => {
    const s = (id: string, at: number) => sessionWith(id, at, set('', '3', '8', '5', '8'), 'Push-up');
    const sessions = [s('s0', 1000), s('s1', 2000), s('s2', 3000)];
    const out = decideStrengthProgression('Push-up', sessions, { t: '5', rpe: '8' });
    expect(out.action).toBe('hold');
    expect(out.prescription).toBeUndefined();
    expect(out.dataLimitations).toEqual(['no_load_to_deload']);
  });
});

describe('decideStrengthProgression — mixed results', () => {
  it('holds when the last two exposures disagree (one on target, one missed)', () => {
    const onTarget = set('100', '8', '8', '8-10', '8');
    const missed = set('100', '3', '8', '5', '8');
    const sessions = [
      sessionWith('s0', 1000, onTarget),
      sessionWith('s1', 2000, onTarget),
      sessionWith('s2', 3000, missed),
    ];
    const out = decideStrengthProgression('Bench press', sessions, { t: '5', rpe: '8' });
    expect(out.action).toBe('hold');
    expect(out.prescription).toBeUndefined();
    expect(out.reasonCodes).toEqual(['mixed_recent_results']);
  });
});

describe('decideStrengthProgression — the exposure a session contributes', () => {
  it('reads the FIRST occurrence of a movement, not a back-off block written after it', () => {
    /*
     * `lift.ts` states the rule and the reason: "one move per movement — the
     * FIRST (working) occurrence wins; a back-off/burnout block written after
     * the main lift must not overwrite the working weight it earned." Taking
     * the last occurrence recorded this athlete's bench at the 70kg back-off
     * and quietly corrupted the whole progression history.
     */
    const working = set('100', '5', '8', '5', '8');
    const backOff = set('70', '5', '8', '5', '8');
    const sessions = [1000, 2000, 3000].map((at, i) =>
      sessionWithBackOff('s' + i, at, working, backOff),
    );
    const out = decideStrengthProgression('Bench press', sessions, { t: '5', rpe: '8' });
    expect(out.action).toBe('progress_load');
    expect(out.prescription).toEqual({ load: 102.5 }); // 102.5, not 72.5
  });

  it('falls through to a later occurrence when the first one logged nothing', () => {
    // Mirrors `liftMoves`, which only marks a movement seen once it has a set
    // with reps — an empty first block is not a claim about what was lifted.
    const unlogged = { t: '5', rpe: '8' } as LoggedSet;
    const working = set('100', '5', '8', '5', '8');
    const sessions = [1000, 2000, 3000].map((at, i) =>
      sessionWithBackOff('s' + i, at, unlogged, working),
    );
    const out = decideStrengthProgression('Bench press', sessions, { t: '5', rpe: '8' });
    expect(out.action).toBe('progress_load');
    expect(out.prescription).toEqual({ load: 102.5 });
  });

  it('picks the set `lastWorkingSet` picks when weight and reps land on DIFFERENT sets', () => {
    /*
     * The divergence this pins. `lift.ts`'s `lastWorkingSet` selects on WEIGHT
     * (`saneKg(aVal) > 0`) and `liftMoves` then discards the movement if that
     * set logged no reps. This selected on reps alone, so when one set carried
     * the weight (100kg, reps left at 0) and another carried the reps (weight
     * blank, 8 reps), the two read two different sets: `liftMoves` earned
     * NOTHING three sessions running, while this handed back a confident
     * "already at rep target" — a suggestion arguing with the very field it is
     * printed next to.
     */
    const sessions = [1000, 2000, 3000].map((at, i) =>
      sessionWithSets('s' + i, at, [
        set('100', '0', '8', '8-10', '8'), // weight logged, reps left at 0
        set('', '8', '8', '8-10', '8'), // weight blank, reps logged
      ]),
    );

    // The real progression system earns nothing here — a 0-rep set moves no
    // weight, and the set that does have reps has no weight to move.
    for (const s of sessions) expect(liftMoves(s)).toEqual([]);

    const out = decideStrengthProgression('Bench press', sessions, { t: '8-10', rpe: '8' });
    expect(out.action).toBe('pause_insufficient_data');
    expect(out.reasonCodes).toEqual(['insufficient_exposure_history']);
    expect(out.prescription).toBeUndefined();
  });

  it('still reads a bodyweight exercise, where NO set logs a load at all', () => {
    // The weight requirement must not swallow the rep route: an entry with no
    // load anywhere has no load axis for `liftMoves` to earn on either, so its
    // last repped set contradicts nothing.
    const sessions = [1000, 2000, 3000].map((at, i) =>
      sessionWithSets(
        's' + i,
        at,
        [set('', '10', '8', '10-15', '8'), set('', '15', '8', '10-15', '8')],
        'Pull-up',
      ),
    );
    for (const s of sessions) expect(liftMoves(s)).toEqual([]);

    // 15, the LAST set's reps — not 10, the first's, which would have held.
    const out = decideStrengthProgression('Pull-up', sessions, { t: '10-15', rpe: '8' });
    expect(out.action).toBe('progress_reps');
    expect(out.prescription).toEqual({ reps: 16 });
  });

  it('takes the LAST weighted working set, not the last repped one, within an entry', () => {
    // Both sets are legitimate; they only disagree on which is last. `lift.ts`
    // judges the movement on the 105kg set, so this must too — otherwise the
    // card suggests a step up from 100 while the field already shows 107.5.
    const sessions = [1000, 2000, 3000].map((at, i) =>
      sessionWithSets('s' + i, at, [
        set('100', '5', '8', '5', '8'),
        set('105', '5', '8', '5', '8'),
      ]),
    );
    /*
     * This asserted `liftMoves(s)[0].from === 105` until 13 August 2026, on
     * the reading that `from` was "the set lift.ts judges". It never was the
     * whole judgement — the walk reads EVERY set — and since the ramp fix
     * `from` reports the opener, the weight `to` is priced off. Both sets are
     * on target (dev = 8 − 8 = 0, dead band), so adj stays 1 and the opener
     * holds: from 100, to 100.
     *
     * The agreement this test exists to pin is untouched, and now sits on the
     * number the two layers actually share: `earnedKgFrom` reads `to`, so the
     * field shows 100 and a 107.5 suggestion is real progress on it.
     */
    for (const s of sessions) {
      expect(liftMoves(s)[0].from).toBe(100);
      expect(liftMoves(s)[0].to).toBe(100);
    }

    const out = decideStrengthProgression('Bench press', sessions, { t: '5', rpe: '8' });
    expect(out.action).toBe('progress_load');
    expect(out.prescription).toEqual({ load: 107.5 }); // 107.5, not 102.5
  });
});

describe('decideStrengthProgression — RPE classification boundaries', () => {
  /*
   * `verdictForRpe` has seven verdicts and only two of them ('right on target',
   * 'a touch under target') mean on-target here. These rows walk the band edges
   * against an rpe-8 target — the classification is the whole input to the
   * streak logic, so an off-by-one in the band would silently change every
   * decision this function makes.
   */
  const ROWS: Array<[string, string, string, string]> = [
    // felt, verdict it lands in, expected action, expected reason code
    ['7.9', 'a touch under target', 'progress_load', 'consistently_on_target'],
    ['8.5', 'right on target (upper edge)', 'progress_load', 'consistently_on_target'],
    // Still on target — and half a point under is BELOW the fold's one-point
    // threshold, so the walk banks nothing and the field still shows 100.
    // (Under the deleted `computeSetAdjustment` this row held: 7.5 banked the
    // step in-session. The fold changed that on purpose, so the suggestion now
    // genuinely moves the number the athlete is looking at.)
    ['7.5', 'a touch under target', 'progress_load', 'consistently_on_target'],
    ['7', 'easy', 'hold', 'mixed_recent_results'],
    ['6', 'too light', 'hold', 'mixed_recent_results'],
    ['4.5', 'way too light', 'hold', 'mixed_recent_results'],
    ['8.6', 'grindy', 'hold', 'mixed_recent_results'],
    ['10', 'max effort', 'hold', 'mixed_recent_results'],
    ['', 'unrated — the non-numeric guard', 'hold', 'mixed_recent_results'],
  ];

  for (const [felt, verdict, action, reason] of ROWS) {
    it(`felt ${felt || '(blank)'} reads as ${verdict} → ${action}`, () => {
      const s = (id: string, at: number) => sessionWith(id, at, set('100', '5', felt, '5', '8'));
      const sessions = [s('s0', 1000), s('s1', 2000), s('s2', 3000)];
      const out = decideStrengthProgression('Bench press', sessions, { t: '5', rpe: '8' });
      expect(out.action).toBe(action);
      expect(out.reasonCodes).toEqual([reason]);
      if (action === 'hold') expect(out.prescription).toBeUndefined();
      else expect(out.prescription).toEqual({ load: 102.5 });
    });
  }
});

describe('decideStrengthProgression is stateless', () => {
  const s = (id: string, at: number) => sessionWith(id, at, set('100', '10', '8', '8-10', '8'));
  const build = () => [s('s0', 1000), s('s1', 2000), s('s2', 3000)];

  it('returns an identical decision for the same sessions array, called twice', () => {
    // No persisted streak counter, no settings read: the same input is the same
    // answer, run after run, in either order relative to anything else.
    const sessions = build();
    const first = decideStrengthProgression('Bench press', sessions, { t: '8-10', rpe: '8' });
    const second = decideStrengthProgression('Bench press', sessions, { t: '8-10', rpe: '8' });
    expect(second).toEqual(first);
    expect(second.prescription).toEqual({ load: 102.5 });
  });

  it("leaves the caller's sessions array untouched — including its order", () => {
    // It sorts internally. Sorting the caller's array in place would reorder the
    // live session list the Logger is rendering from.
    const sessions = [s('s2', 3000), s('s0', 1000), s('s1', 2000)];
    const before = JSON.stringify(sessions);
    const ids = sessions.map((x) => x.id);
    decideStrengthProgression('Bench press', sessions, { t: '8-10', rpe: '8' });
    expect(sessions.map((x) => x.id)).toEqual(ids);
    expect(JSON.stringify(sessions)).toBe(before);
  });
});

describe('decideStrengthProgression — decision table', () => {
  type Kind = 'on' | 'miss' | 'mid';
  const PATTERNS: Array<[Kind, Kind]> = [
    ['on', 'on'],
    ['miss', 'miss'],
    ['on', 'miss'],
    ['miss', 'on'],
    ['mid', 'on'],
    ['on', 'mid'],
    ['mid', 'mid'],
    ['mid', 'miss'],
    ['miss', 'mid'],
  ];
  const REP_RANGES = ['5', '5-8', '8-12'] as const;
  /** heavy, light, and bodyweight — the load axis the two clamps depend on. */
  const LOADS = ['100', '20', ''] as const;

  /*
   * What `lift.ts` has ALREADY banked from the last exposure — i.e. what the
   * weight field is prefilled with. Written out rather than recomputed here on
   * purpose: restating the fold's walk in the test would only prove the test
   * can multiply. An on-target set holds the weight (deviation under one
   * point, the walk does not move), and a missed set is scored at effective
   * RPE 10.5 and locks — against a centre of 8 that is a −2.5 deviation, worth
   * 5% at an 8-rep floor and 6.25% at a 5-rep floor, both snapping to 2.5kg —
   * so 100 → 95, while 20 → 20, the drop being smaller than one increment.
   */
  const EARNED_AFTER_MISS: Record<string, number> = { '100': 95, '20': 20 };

  function repsFor(kind: Kind, repRange: string): number {
    if (kind === 'miss') return 3; // below any floor used here (5 or 8)
    // 'on' and 'mid' both stay at-or-above the floor; only felt differs.
    return repRange === '5' ? 5 : repRange === '5-8' ? 6 : 9;
  }
  function feltFor(kind: Kind): string {
    return kind === 'mid' ? '3' : '8'; // '3' is 5 points under an rpe:'8' center — 'way too light', neither missed nor on-target
  }

  for (const [prevKind, lastKind] of PATTERNS) {
    for (const kg of LOADS) {
      for (const repRange of REP_RANGES) {
        for (const exposureCount of [3, 6] as const) {
          const loadLabel = kg === '' ? 'bodyweight' : kg + 'kg';
          it(`prev=${prevKind} last=${lastKind} load=${loadLabel} range=${repRange} exposures=${exposureCount}`, () => {
            const older = set(kg, String(repsFor('on', repRange)), '8', repRange, '8');
            const prevSet = set(kg, String(repsFor(prevKind, repRange)), feltFor(prevKind), repRange, '8');
            const lastSet = set(kg, String(repsFor(lastKind, repRange)), feltFor(lastKind), repRange, '8');

            const filler = Array.from({ length: exposureCount - 2 }, (_, i) => sessionWith('f' + i, i, older));
            const sessions = [...filler, sessionWith('sp', exposureCount - 1, prevSet), sessionWith('sl', exposureCount, lastSet)];

            const out = decideStrengthProgression('Bench press', sessions, { t: repRange, rpe: '8' });

            const loaded = kg !== '';
            const prevOn = prevKind === 'on';
            const lastOn = lastKind === 'on';
            const prevMiss = prevKind === 'miss';
            const lastMiss = lastKind === 'miss';

            if (lastOn && prevOn) {
              const repTop = parseInt(repRange.includes('-') ? repRange.split(/[-–]/)[1] : repRange, 10);
              const lastReps = repsFor(lastKind, repRange);
              // Double progression: climb the range first, unless bodyweight
              // (no load axis) or already at the top of it.
              if (!loaded || lastReps < repTop) {
                if (lastReps + 1 > repTop) {
                  expect(out.action).toBe('progress_reps');
                  expect(out.prescription).toEqual({ reps: lastReps + 1 });
                } else {
                  // The Reps field already shows repTop — one more rep than last
                  // time would be a step DOWN from what is on screen.
                  expect(out.action).toBe('hold');
                  expect(out.prescription).toBeUndefined();
                  expect(out.reasonCodes).toEqual(['already_at_rep_target']);
                }
              } else {
                // On target at its own target RPE earns nothing in-session, so
                // the field still shows what was lifted and +2.5kg is real.
                expect(out.action).toBe('progress_load');
                expect(out.prescription?.load).toBeCloseTo(Number(kg) + 2.5);
              }
            } else if (lastMiss && prevMiss) {
              if (!loaded) {
                expect(out.action).toBe('hold');
                expect(out.dataLimitations).toContain('no_load_to_deload');
              } else {
                /*
                 * Ten percent off what was LIFTED, floored at one plate,
                 * clamped so it can never land above what the misses have
                 * already taken off, and rounded to the plate increment.
                 * Restated here rather than imported so a change to
                 * `AUTOREG.deloadPct` fails this table loudly instead of
                 * quietly agreeing with itself.
                 */
                const earned = EARNED_AFTER_MISS[kg];
                const cut = Number(kg) * 0.9;
                const offer = Math.round(Math.max(2.5, Math.min(cut, earned)) / 2.5) * 2.5;
                if (offer < earned) {
                  expect(out.action).toBe('deload');
                  expect(out.prescription?.load).toBeCloseTo(offer);
                } else {
                  // The in-session drop had already reached the tenth, so
                  // there is nothing left to cut. At 20kg the fold's 6.25%
                  // rounds away entirely and 10% is 18 → 17.5, which is why
                  // the light case still gets a real offer.
                  expect(out.action).toBe('hold');
                  expect(out.prescription).toBeUndefined();
                  expect(out.reasonCodes).toEqual(['already_at_earned_load']);
                }
              }
            } else {
              expect(out.action).toBe('hold');
              expect(out.prescription).toBeUndefined();
            }
          });
        }
      }
    }
  }
});

describe('decideStrengthProgression is reachable from @hybrid/engine\'s public surface', () => {
  it('is exported from the package index, not just the adaptive module', () => {
    expect(typeof fromIndex).toBe('function');
  });
});
