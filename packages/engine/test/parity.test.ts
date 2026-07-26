/*
 * Where the port drifted from the vanilla app.
 *
 * The golden vectors pin the functions the harvester could reach; these are the
 * ones it could not — the guided-logger prefills, zone banking, and the two
 * merge/import paths that only run at the edges. Every expectation here was
 * read off the corresponding function in the root `app.js`, which remains the
 * specification and the rollback path.
 */
import { describe, expect, it } from 'vitest';
import { prefillPrimary, prefillSecondary } from '../src/logger';
import { repFloorOf, repTopOf } from '../src/autoreg';
import { conZones, zoneSeconds } from '../src/hr';
import { mergeEngines } from '../src/db';
import { impParse, impToWorkout } from '../src/importer';
import type { EngineDB, Exercise, LoggedSet, Session } from '../src/types';

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

describe('import → workout', () => {
  it('a movement the importer could not name still gets a name', () => {
    // "Strength 5x5" parses to a heading plus a placeholder exercise with no
    // name. app.js impSave writes 'Movement' there; an empty name renders as a
    // blank row and is invisible to every history lookup, which key on name.
    const r = impParse('Strength 5x5');
    const w = impToWorkout(r, () => 'id');
    expect(w.blocks[0].exercises[0].name).toBe('Movement');
  });
});
