/*
 * Where the port drifted from the vanilla app.
 *
 * The golden vectors pin the functions the harvester could reach; these are the
 * ones it could not — zone banking, the movement list, and the merge paths that
 * only run at the edges. Every expectation here was read off the corresponding
 * function in the root `app.js`, which remains the specification and the
 * rollback path.
 *
 * THE GUIDED-LOGGER PREFILLS WERE THE OTHER HALF, and they went on 15 August
 * 2026 with `prefillPrimary`/`prefillSecondary` themselves. Worth being plain
 * about what that costs: this file was pinning the port against the vanilla
 * app, and eighteen of its assertions were about a screen neither product
 * ships any more. Parity with `app.js` on code nothing runs is not a safety
 * net — it is the decorative-guard shape, arrived at by deletion elsewhere
 * rather than by anyone writing a bad test. The phone's logger is pinned by
 * its own gate (`pnpm run check:parity-mobile`), against the round-major flow
 * it actually runs.
 */
import { describe, expect, it } from 'vitest';
import { repFloorOf, repTopOf } from './autoreg';
import { conZones, zoneSeconds } from './hr';
import { knownMovements, workoutStats } from './session';
import { agoLabel, barScale, byMonth, dayLabel, monthLabel } from './num';
import { mergeEngines } from './db';
import type { EngineDB, Exercise, LoggedSet, Session, Workout } from './types';

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

describe('month grouping in History', () => {
  const NOW = new Date(2026, 6, 27);

  it('drops the year in the current year and keeps it otherwise', () => {
    expect(monthLabel('2026-07-20', NOW)).toBe('July');
    expect(monthLabel('2025-11-02', NOW)).toBe('November 2025');
  });

  it('names the day without repeating the month above it', () => {
    // Parsed at local midday, like agoLabel: at midnight a DST change moves the
    // date by one, which is the whole reason the row exists.
    expect(dayLabel('2026-07-20')).toBe('Mon 20');
    expect(dayLabel('')).toBe('');
  });

  it('runs consecutive same-month items together, in the order given', () => {
    const rows = [{ d: '2026-07-20' }, { d: '2026-07-03' }, { d: '2026-06-26' }];
    const g = byMonth(rows, (r) => r.d, NOW);
    expect(g.map((m) => m.label)).toEqual(['July', 'June']);
    expect(g[0].items).toHaveLength(2);
  });

  it('does not silently re-order a list that was not sorted by date', () => {
    // Grouping by key would collapse these into two runs and quietly move a
    // row; splitting on consecutive runs renders the list as it actually is.
    const rows = [{ d: '2026-07-20' }, { d: '2026-06-26' }, { d: '2026-07-03' }];
    expect(byMonth(rows, (r) => r.d, NOW).map((m) => m.label)).toEqual(['July', 'June', 'July']);
  });

  it('gives an undated row a heading rather than an empty one', () => {
    expect(byMonth([{ d: '' }], (r) => r.d, NOW)[0].label).toBe('Undated');
    expect(byMonth([], (r: { d: string }) => r.d, NOW)).toEqual([]);
  });
});

describe('barScale — the axis under the volume chart', () => {
  it('floats the baseline when consistent training would otherwise flatten it', () => {
    // The real case: eight seeded weeks rendered as seven bars spanning
    // 92–100% of the card. The largest element on the screen, saying nothing.
    const weeks = [6100, 6200, 6050, 6300, 6180, 6400, 6548];
    const s = barScale(weeks);
    expect(s.floating).toBe(true);
    const heights = weeks.map((v) => s.pct(v));
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(50);
  });

  it('keeps a zero baseline when a week was not trained', () => {
    // A rest week among training weeks is signal, not noise to zoom past —
    // with a zero present, the distance FROM zero is the information.
    const s = barScale([6100, 0, 6300, 6548]);
    expect(s.floating).toBe(false);
    expect(s.pct(0)).toBe(0);
  });

  it('keeps a zero baseline when the spread already fills the card', () => {
    expect(barScale([1000, 5000, 9000]).floating).toBe(false);
  });

  it('does not magnify rounding into a trend that is not there', () => {
    // Under ~4% the bars genuinely ARE the same height. Zooming would invent a
    // story out of noise — the failure mode opposite the flat chart, and the
    // reason this is a band rather than "always float".
    expect(barScale([6000, 6010, 6020]).floating).toBe(false);
  });

  it('survives one week, all zeroes, and no weeks at all', () => {
    expect(barScale([5000]).floating).toBe(false);
    expect(barScale([0, 0]).pct(0)).toBe(0);
    expect(() => barScale([]).pct(1)).not.toThrow();
  });

  it('is defeated by a part-finished week, which is why the caller filters', () => {
    /*
     * The eight-bucket shape the screen actually renders: seven complete weeks
     * plus the one ending today, two days in. That stub makes the spread 98%
     * of the peak, so `barScale` correctly concludes the variation is already
     * obvious and keeps a zero baseline — and the chart stays flat.
     *
     * This is not a bug in the scale, it is the contract: a caller passes the
     * values it wants the AXIS derived from, and an in-progress bucket is not
     * one of them. Asserted here rather than left implicit because the first
     * version of the test above used seven weeks and passed while the feature
     * did nothing on screen.
     */
    const complete = [6100, 6200, 6050, 6300, 6180, 6400, 6548];
    const thisWeekSoFar = 120;
    expect(barScale([...complete, thisWeekSoFar]).floating).toBe(false);
    expect(barScale(complete).floating).toBe(true);
  });

  it('never returns a height outside 0–100', () => {
    const s = barScale([6100, 6548]);
    expect(s.pct(999999)).toBeLessThanOrEqual(100);
    expect(s.pct(-5)).toBe(0);
    expect(s.pct(NaN)).toBe(0);
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

/*
 * The set-to-set adjustment reaches the box.
 *
 * The logger printed "+2.5 kg for Set 3 (132.5 kg)" and then prefilled 130:
 * `computeSetAdjustment`'s answer went into a sentence and nowhere else, while
 * prefill only knew "repeat what is on the bar". Between sessions the same
 * formula WAS honoured, so load moved weekly and never within a session — with
 * the screen claiming otherwise both times.
 */
