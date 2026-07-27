/*
 * Where the port drifted from the vanilla app.
 *
 * The golden vectors pin the functions the harvester could reach; these are the
 * ones it could not — the guided-logger prefills, zone banking, and the merge
 * paths that only run at the edges. Every expectation here was read off the
 * corresponding function in the root `app.js`, which remains the specification
 * and the rollback path.
 */
import { describe, expect, it } from 'vitest';
import { prefillPrimary, prefillSecondary } from '../src/logger';
import { repFloorOf, repTopOf } from '../src/autoreg';
import { conZones, zoneSeconds } from '../src/hr';
import { knownMovements, workoutStats } from '../src/session';
import { agoLabel } from '../src/num';
import { mergeEngines } from '../src/db';
import type { EngineDB, Exercise, LoggedSet, Session, Workout } from '../src/types';

const ex = (name: string, sets: LoggedSet[]): Exercise<LoggedSet> => ({
  id: 'e1',
  name,
  mode: 'reps_kg',
  tempo: '',
  rest: 90,
  sets,
});

/** One completed session holding one exercise, for the history-backed prefills. */
const historySession = (e: Exercise<LoggedSet>): Session => ({
  id: 's-old',
  date: '2026-01-01',
  status: 'completed',
  completedAt: 1000,
  blocks: [{ id: 'b', heading: 'Main', exercises: [e] }],
});

describe('zone banking counts every beat, as conFinish does', () => {
  it('a beat under the floor still banks against Recovery', () => {
    // app.js conFinish: `ds.pts.forEach(b=>{if(b!=null)zsec[conZoneOf(b,z).key]+=ds.every;})`
    // — there is no floor test, and conZoneOf puts anything below the floor in
    // the first band. Dropping those seconds shrinks the denominator conAdapt
    // divides by, which quietly makes the level easier to earn.
    const z = conZones({ profile: { age: 30, maxHr: 190, restingHr: 50 } });
    expect(z.floor).toBe(92);
    const zsec = zoneSeconds({ every: 2, pts: [80, 100, 140, 175] }, z);
    expect(zsec).toEqual({ low: 4, mod: 2, high: 2 });
  });
});

describe('the guided-logger prefills', () => {
  const today = ex('Back squat', [
    { t: 'W10', rpe: '' },
    { t: '5', rpe: '8' },
    { t: '5', rpe: '8' },
  ]);
  const last = historySession(
    ex('Back squat', [
      { t: 'W10', rpe: '', aVal: '40', aVal2: '10', done: true },
      { t: '5', rpe: '8', aVal: '100', aVal2: '5', done: true },
      { t: '5', rpe: '8', aVal: '110', aVal2: '5', done: true },
    ]),
  );

  it('never carries a working weight into a warm-up', () => {
    // The whole reason `same()` exists. Reading history through the compacted
    // exLogFor list drops the warm-ups, so index 0 of "last time" became the
    // first WORKING set and 100kg landed in the warm-up field.
    expect(prefillPrimary(today, 0, [last])).toBe('40');
  });

  it('lines up with the same set index as last time', () => {
    // Set 2 must prefill from set 2 of last time (100), not from whatever is
    // second once warm-ups and unlogged sets have been squeezed out (110).
    expect(prefillPrimary(today, 1, [last])).toBe('100');
  });

  it('carries the previous set’s reps forward', () => {
    // app.js glogVal2Prefill walks back through the earlier sets before it
    // falls back to the plan. Without it, an athlete who did 9 on set 1 is
    // handed the target again on set 2 instead of what they actually did.
    const e = ex('Back squat', [
      { t: '8-10', rpe: '8', aVal2: '9', done: true },
      { t: '8-10', rpe: '8' },
    ]);
    expect(prefillSecondary(e, 1)).toBe('9');
  });

  it('offers the TOP of a rep range, not the bottom', () => {
    const e = ex('Back squat', [{ t: '8-10', rpe: '8' }]);
    expect(prefillSecondary(e, 0)).toBe('10');
  });

  /* The earned weight sits BETWEEN this exercise's own earlier sets and last
     time's history. Every neighbour in that order is load-bearing. */
  describe('the earned working weight', () => {
    const earned = { liftProgress: { 'back squat': { kg: 105, at: 2000 } } };

    it('outranks repeating what was lifted last time', () => {
      // The whole point. Without this the app prints "+2.5 kg for next session"
      // and then offers the same 100 it always did.
      expect(prefillPrimary(today, 1, [last], { settings: earned })).toBe('105');
    });

    it('never reaches a warm-up', () => {
      // A warm-up prefilled from the working weight is the same contamination
      // `same()` exists to stop, arriving through the front door instead.
      expect(prefillPrimary(today, 0, [last], { settings: earned })).toBe('40');
    });

    it('never overwrites a number already typed', () => {
      const typed = ex('Back squat', [{ t: '5', rpe: '8', aVal: '97.5' }]);
      expect(prefillPrimary(typed, 0, [last], { settings: earned })).toBe('97.5');
    });

    it('yields to an earlier set of the SAME exercise', () => {
      // What is on the bar right now beats what last week decided you'd be on.
      const mid = ex('Back squat', [
        { t: '5', rpe: '8', aVal: '102.5', done: true },
        { t: '5', rpe: '8' },
      ]);
      expect(prefillPrimary(mid, 1, [last], { settings: earned })).toBe('102.5');
    });

    it('falls back to history for a lift that has earned nothing', () => {
      expect(prefillPrimary(today, 1, [last], { settings: { liftProgress: {} } })).toBe('100');
    });

    it('finds both history and earned weight through a trailing space', () => {
      // lastTimeFor lowercased but did not trim, while every OTHER keyer did —
      // so a name saved as "Back squat " found its PRs and its earned weight
      // but silently missed its own last session. Before the fix the first
      // assertion returned '' (no history matched at all), not the wrong
      // number — which is why nobody noticed.
      const padded = ex('Back squat ', [{ t: '5', rpe: '8' }]);
      expect(prefillPrimary(padded, 0, [last]), 'history').toBe('100');
      expect(prefillPrimary(padded, 0, [], { settings: earned }), 'earned').toBe('105');
    });

    it('is eased on a red recovery morning, but not on a green one', () => {
      const red = prefillPrimary(today, 1, [last], {
        settings: earned,
        whoop: { recoveryScore: 20 },
      });
      const green = prefillPrimary(today, 1, [last], {
        settings: earned,
        whoop: { recoveryScore: 80 },
      });
      expect(red).toBe('102.5');
      expect(green).toBe('105');
    });
  });
});

describe('the movement list the Planner offers back', () => {
  const mk = (names: string[], at: number): Session => ({
    id: 's' + at,
    date: '2026-01-01',
    status: 'completed',
    completedAt: at,
    blocks: [{ id: 'b', exercises: names.map((n, i) => ({ ...ex(n, []), id: 'e' + i })) }],
  });

  it('collapses spellings that differ only in case, keeping the newest', () => {
    // The whole reason this exists: "Back Squat" and "back squat" are two
    // separate lifts to exLogFor, detectPRs and the earned working weight.
    const out = knownMovements([], [mk(['back squat'], 100), mk(['Back Squat'], 200)]);
    expect(out).toEqual(['Back Squat']);
  });

  it('trims, and drops blanks', () => {
    expect(knownMovements([], [mk(['  Bench  ', '', '   '], 1)])).toEqual(['Bench']);
  });

  it('reads workouts as well as sessions, since a plan may be unlogged', () => {
    const w: Workout = { id: 'w1', name: 'A', updatedAt: 5, blocks: [{ id: 'b', exercises: [ex('Overhead press', [])] }] };
    expect(knownMovements([w], [])).toEqual(['Overhead press']);
  });

  it('ignores conditioning and non-lift modes', () => {
    const w: Workout = {
      id: 'w1',
      name: 'A',
      updatedAt: 1,
      blocks: [
        { id: 'c', kind: 'conditioning', condFmt: 'intervals' },
        { id: 'b', exercises: [{ ...ex('Plank', []), mode: 'seconds' }] },
      ],
    };
    expect(knownMovements([w], [])).toEqual([]);
  });
});

describe('what the Library says about a session', () => {
  const w: Workout = { id: 'w1', name: 'Lower', blocks: [] };
  const logged: Session = {
    id: 's1',
    date: '2026-03-02',
    status: 'completed',
    completedAt: 200,
    workoutId: 'w1',
    blocks: [{ id: 'b', exercises: [ex('Squat', [{ t: '5', rpe: '8', aVal: '100', done: true }])] }],
  };
  const abandoned: Session = { id: 's2', date: '2026-03-09', status: 'completed', completedAt: 900, workoutId: 'w1', blocks: [] };

  it('does not count a session that was started and never logged', () => {
    // Otherwise opening Training by mistake makes the Library claim a history
    // the athlete knows they do not have — and moves "last trained" forward.
    const st = workoutStats(w, [logged, abandoned]);
    expect(st.count).toBe(1);
    expect(st.lastDate).toBe('2026-03-02');
  });

  it('is zeroed for a session never trained', () => {
    expect(workoutStats({ id: 'w9', name: 'X', blocks: [] }, [logged])).toEqual({ lastDate: null, lastAt: 0, count: 0 });
  });
});

describe('agoLabel', () => {
  const now = new Date(2026, 2, 20, 9); // 20 Mar 2026, morning

  it('names the near days rather than counting them', () => {
    expect(agoLabel('2026-03-20', now)).toBe('today');
    expect(agoLabel('2026-03-19', now)).toBe('yesterday');
    expect(agoLabel('2026-03-16', now)).toBe('4 days ago');
  });

  it('coarsens as it gets further away', () => {
    expect(agoLabel('2026-03-01', now)).toBe('2 weeks ago');
    expect(agoLabel('2025-12-20', now)).toBe('3 months ago');
  });

  it('handles a future date and a missing one without producing nonsense', () => {
    expect(agoLabel('2026-04-01', now)).toBe('scheduled');
    expect(agoLabel('', now)).toBe('');
    expect(agoLabel(null, now)).toBe('');
  });
});

describe('rep targets', () => {
  it('repTopOf reads the top of a range', () => {
    expect(repTopOf('8-10')).toBe('10');
    expect(repTopOf('5')).toBe('5');
    expect(repTopOf('max')).toBe('');
    expect(repTopOf(undefined)).toBe('');
  });

  it('repFloorOf reads the FIRST number written, not the smallest', () => {
    // app.js repFloorOf is `match(/(\d+)/)`. Taking the minimum instead turns a
    // descending target into a floor of 8, so a set that missed by two reps is
    // scored as having made it and the load goes UP.
    expect(repFloorOf('10-8')).toBe(10);
    expect(repFloorOf('8-10')).toBe(8);
    expect(repFloorOf('5')).toBe(5);
    expect(repFloorOf('max')).toBe(0);
  });
});

describe('merge does not admit holes', () => {
  it('a null scheduled date is dropped rather than merged in', () => {
    // app.js uniqArr filters null/undefined before de-duping. buildPushState
    // merges WITHOUT sanitizing afterwards, so a hole here is written straight
    // back to the remote blob.
    const local: EngineDB = {
      workouts: [{ id: 'w1', name: 'A', blocks: [], dates: ['2026-01-01'] }],
      sessions: [],
      settings: {},
    };
    const remote: EngineDB = {
      workouts: [{ id: 'w1', name: 'A', blocks: [], dates: [null as unknown as string] }],
      sessions: [],
      settings: {},
    };
    expect(mergeEngines(local, remote).workouts[0].dates).toEqual(['2026-01-01']);
  });
});
