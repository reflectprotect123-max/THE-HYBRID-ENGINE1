/*
 * The port's proof of work.
 *
 * Every vector in test/golden/ was produced by running the ORIGINAL vanilla
 * app.js in a real browser (checks/golden-vectors.mjs). If any assertion here
 * fails, the TypeScript engine and the shipped app disagree about training
 * maths, and one of them is wrong. Regenerating the fixtures to make a test
 * pass is how a silent behaviour change gets shipped — don't.
 */
import { describe, expect, it } from 'vitest';

import {
  AUTOREG,
  CON_EFFORTS,
  MAX_KG,
  MODE_KEYS,
  REZONE_PROVISIONAL,
  ZONE_TO_EFFORT,
  computeSetAdjustment,
  conDownsample,
  conHrr,
  conMaxHr,
  conZoneOf,
  conZones,
  condEffort,
  condEffortGap,
  condEffortRpe,
  detectPRs,
  epley,
  isWarmup,
  mergeEngines,
  plateBreakdown,
  recoveryBand,
  roundToIncrement,
  rpeCenterOf,
  rxLine,
  saneKg,
  sanNumStr,
  sanitizeDB,
  sessionRpe,
  sessionScore,
  sessionVolume,
  verdictForRpe,
} from '../src/index';
import { CON_FORMAT_KEYS } from '../src/conditioning';
import type { Downsampled, EngineDB, Exercise, LoggedSet, Profile, Session } from '../src/types';

import epleyV from './golden/epley.json';
import roundV from './golden/roundToIncrement.json';
import saneKgV from './golden/saneKg.json';
import sanNumStrV from './golden/sanNumStr.json';
import verdictV from './golden/verdictForRpe.json';
import adjustV from './golden/computeSetAdjustment.json';
import centerV from './golden/rpeCenterOf.json';
import warmupV from './golden/isWarmup.json';
import platesV from './golden/plateBreakdown.json';
import condEffortV from './golden/condEffort.json';
import condGapV from './golden/condEffortGap.json';
import condRpeV from './golden/condEffortRpe.json';
import maxHrV from './golden/conMaxHr.json';
import zonesV from './golden/conZones.json';
import zoneOfV from './golden/conZoneOf.json';
import recBandV from './golden/recoveryBand.json';
import hrrV from './golden/conHrr.json';
import volV from './golden/sessionVolume.json';
import srpeV from './golden/sessionRpe.json';
import scoreV from './golden/sessionScore.json';
import prV from './golden/detectPRs.json';
import rxV from './golden/rxLine.json';
import sanV from './golden/sanitizeDB.json';
import mergeV from './golden/mergeEngines.json';
import constV from './golden/constants.json';

/* The fixtures were serialised through JSON, so NaN and undefined arrived as
   null / a sentinel. Rehydrate rather than weakening the assertions. */
const un = (v: unknown) => (v === '__undefined__' ? undefined : v);
const nanOk = (v: unknown) => (v === null ? NaN : v);

describe('constants still mean what they meant', () => {
  it('autoregulation', () => expect(AUTOREG).toEqual(constV.AUTOREG));
  it('max load clamp', () => expect(MAX_KG).toBe(constV.MAX_KG));
  it('re-zoning magnitudes', () => expect(REZONE_PROVISIONAL).toEqual(constV.REZONE_PROVISIONAL));
  it('effort table', () => expect(CON_EFFORTS).toEqual(constV.CON_EFFORTS));
  it('zone→effort fallback', () => expect(ZONE_TO_EFFORT).toEqual(constV.ZONE_TO_EFFORT));
  it('mode keys', () => expect(MODE_KEYS).toEqual(constV.MODES));
  it('conditioning format keys', () => expect(CON_FORMAT_KEYS).toEqual(constV.CON_FORMATS));
});

describe('numeric helpers', () => {
  it('epley', () => {
    for (const v of epleyV) expect(epley(nanOk(v.kg), v.reps), JSON.stringify(v)).toEqual(v.out);
  });
  it('roundToIncrement', () => {
    for (const v of roundV) {
      const input = v.v === null ? NaN : v.v;
      expect(roundToIncrement(input as number, v.inc), JSON.stringify(v)).toBe(v.out);
    }
  });
  it('saneKg', () => {
    for (const v of saneKgV) expect(saneKg(un(v.in)), JSON.stringify(v)).toBe(v.out);
  });
  it('sanNumStr', () => {
    for (const v of sanNumStrV) expect(sanNumStr(v.in), JSON.stringify(v)).toBe(v.out);
  });
});

describe('autoregulation', () => {
  it('verdictForRpe', () => {
    for (const v of verdictV) expect(verdictForRpe(v.rpe, v.center), JSON.stringify(v)).toBe(v.out);
  });
  it('computeSetAdjustment', () => {
    for (const v of adjustV) {
      expect(computeSetAdjustment(v.reps, v.rpe, v.low, v.weight, v.center), JSON.stringify(v)).toEqual(v.out);
    }
  });
  it('rpeCenterOf', () => {
    for (const v of centerV) expect(rpeCenterOf(v.in as { rpe: string }), JSON.stringify(v)).toBe(v.out);
  });
  it('isWarmup', () => {
    for (const v of warmupV) {
      expect(isWarmup({ t: un(v.t) as string }), JSON.stringify(v)).toBe(v.out);
    }
  });
});

describe('plate maths', () => {
  it('plateBreakdown', () => {
    for (const v of platesV) {
      expect(plateBreakdown(v.total, v.bar, v.plates), JSON.stringify({ t: v.total, b: v.bar })).toEqual(v.out);
    }
  });

  it('refuses a non-finite load instead of looping forever', () => {
    // "1e309" parses to Infinity and is typeable into the logger's weight
    // field. The greedy loop has no upper bound, so without the guard this
    // allocates until the tab dies with "Invalid array length" — taking the
    // athlete's live session with it.
    const plates = [25, 20, 15, 10, 5, 2.5, 1.25];
    for (const bad of [Infinity, -Infinity, NaN, 1e309, MAX_KG + 1]) {
      const r = plateBreakdown(bad, 20, plates);
      expect(r.perSide, String(bad)).toEqual([]);
      expect(r.loadable, String(bad)).toBe(false);
      expect(Number.isFinite(r.achievableKg), String(bad)).toBe(true);
    }
    expect(plateBreakdown(100, Infinity, plates).perSide).toEqual([]);
    // The guard must not have changed anything that was already loadable:
    // 100kg on a 20kg bar is 40 a side, greedy from the heaviest plate.
    expect(plateBreakdown(100, 20, plates).perSide).toEqual([25, 15]);
    expect(plateBreakdown(100, 20, plates).loadable).toBe(true);
  });
});

describe('conditioning effort', () => {
  it('condEffort resolves effort, then legacy zone, then medium', () => {
    for (const v of condEffortV) expect(condEffort(v.in as never), JSON.stringify(v.in)).toEqual(v.out);
  });
  it('condEffortGap scores against the band, not its centre', () => {
    for (const v of condGapV) {
      const felt = v.felt === null ? null : v.felt;
      expect(condEffortGap(CON_EFFORTS[v.effort as 'easy'], felt), JSON.stringify(v)).toBe(v.out);
    }
  });
  it('condEffortRpe', () => {
    for (const v of condRpeV) expect(condEffortRpe(CON_EFFORTS[v.effort as 'easy'])).toBe(v.out);
  });
});

describe('heart-rate model', () => {
  it('conMaxHr — Tanaka, manual override, observed max', () => {
    for (const v of maxHrV) expect(conMaxHr(v.profile as Profile), JSON.stringify(v)).toBe(v.out);
  });

  it('recoveryBand', () => {
    for (const v of recBandV) expect(recoveryBand(un(v.in)), JSON.stringify(v)).toBe(v.out);
  });

  it('conZones — all 72 combinations of max / resting / recovery', () => {
    for (const v of zonesV) {
      const z = conZones({
        profile: { age: 30, maxHr: v.maxHr, restingHr: v.rest },
        whoop: v.rec == null ? null : { recoveryScore: v.rec, restingHr: v.rest || null },
      });
      expect(
        {
          floor: z.floor,
          max: z.max,
          rest: z.rest,
          rec: z.rec,
          adj: z.adj,
          method: z.method,
          bands: z.list.map((b) => ({ key: b.key, lo: b.lo, hi: b.hi })),
        },
        JSON.stringify({ maxHr: v.maxHr, rest: v.rest, rec: v.rec }),
      ).toEqual(v.out);
    }
  });

  it('conZoneOf', () => {
    const z = conZones({ profile: { age: 30, maxHr: 190, restingHr: 50 }, whoop: null });
    for (const v of zoneOfV) expect(conZoneOf(v.bpm, z).key, String(v.bpm)).toBe(v.out);
  });

  it('conHrr', () => {
    for (const v of hrrV) expect(conHrr(v.in as Downsampled), JSON.stringify(v.in)).toEqual(v.out);
  });
});

/* The session fixtures were built inside the harvester; rebuild the identical
   shapes here so the same inputs reach the ported functions. */
const mkSet = (t: string, rpe: string, aVal: string, aVal2: string, done: boolean, felt: string): LoggedSet => ({
  t,
  rpe,
  aVal,
  aVal2,
  done,
  felt,
});

const sessions: Session[] = [
  {
    id: 's1',
    date: '2026-01-10',
    status: 'completed',
    completedAt: 1000,
    startedAt: 900,
    blocks: [
      {
        id: 'b1',
        exercises: [
          {
            id: 'e1',
            name: 'Back Squat',
            mode: 'reps_kg',
            sets: [
              mkSet('W10', '', '40', '10', true, '4'),
              mkSet('5', '8', '100', '5', true, '8'),
              mkSet('5', '8', '100', '5', true, '9'),
            ],
          },
        ],
      },
    ],
  },
  {
    id: 's2',
    date: '2026-01-12',
    status: 'completed',
    completedAt: 2000,
    startedAt: 1900,
    blocks: [
      {
        id: 'b2',
        exercises: [
          {
            id: 'e2',
            name: 'Bench',
            mode: 'reps_kg',
            sets: [mkSet('8', '7', '60', '8', true, '7'), mkSet('8', '7', '60', '6', false, '')],
          },
        ],
      },
      {
        id: 'b3',
        kind: 'conditioning',
        condFmt: 'intervals',
        effort: 'hard',
        condResult: { effort: 'hard', felt: '7', targetRpe: 8.5 },
      },
    ],
  },
  { id: 's3', date: '2026-01-14', status: 'active', startedAt: 3000, blocks: [] },
];

describe('session maths', () => {
  it('sessionVolume excludes warm-ups and unlogged sets', () => {
    volV.forEach((v, i) => expect(sessionVolume(sessions[i]), v.id).toBe(v.out));
  });
  it('sessionRpe', () => {
    srpeV.forEach((v, i) => expect(sessionRpe(sessions[i]), v.id).toEqual(v.out));
  });
  it('sessionScore counts a finished conditioning block as work', () => {
    scoreV.forEach((v, i) => expect(sessionScore(sessions[i]), v.id).toBe(v.out));
  });
  it('detectPRs ignores warm-ups', () => {
    prV.forEach((v, i) => expect(detectPRs(sessions[i], []), v.id).toEqual(v.out));
  });
});

describe('prescription line', () => {
  it('rxLine', () => {
    for (const v of rxV) expect(rxLine(v.in as Exercise), JSON.stringify(v.in)).toBe(v.out);
  });
});

describe('the data-loss surface', () => {
  it('sanitizeDB coerces every malformed shape the audit found', () => {
    for (const v of sanV) {
      const got = sanitizeDB(JSON.parse(JSON.stringify(v.in)));
      // ids are minted randomly when missing, so compare everything else.
      const strip = (db: EngineDB) => ({
        workouts: db.workouts.map((w) => ({ ...w, id: w.id.length ? 'ID' : w.id })),
        sessions: db.sessions.map((s) => ({ ...s, id: s.id.length ? 'ID' : s.id })),
        settings: db.settings,
      });
      expect(strip(got), JSON.stringify(v.in)).toEqual(strip(v.out as unknown as EngineDB));
    }
  });

  it('mergeEngines — newer wins, ties go to the second side', () => {
    const dbA: EngineDB = {
      workouts: [{ id: 'w1', name: 'A', updatedAt: 100, blocks: [] }],
      sessions: [{ id: 's1', date: '2026-01-01', status: 'completed', completedAt: 100, blocks: [] }],
      settings: { maxHr: 190, updatedAt: 100 },
    };
    const dbB: EngineDB = {
      workouts: [{ id: 'w1', name: 'B', updatedAt: 200, blocks: [] }],
      sessions: [{ id: 's1', date: '2026-01-01', status: 'completed', completedAt: 200, blocks: [] }],
      settings: { maxHr: 185, updatedAt: 200 },
    };
    const dbC: EngineDB = {
      workouts: [{ id: 'w1', name: 'C', updatedAt: 200, blocks: [] }],
      sessions: [],
      settings: {},
    };
    const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

    const got = [
      mergeEngines(clone(dbA), clone(dbB)),
      mergeEngines(clone(dbB), clone(dbA)),
      mergeEngines(clone(dbB), clone(dbC)),
      mergeEngines({ workouts: [], sessions: [], settings: {} }, clone(dbA)),
    ];
    got.forEach((g, i) => expect(g, mergeV[i].label).toEqual(mergeV[i].out));
  });
});

describe('trace compression', () => {
  it('widens the bin instead of clamping the index — a long session keeps its tail', () => {
    // 3 hours at 1Hz: the old fixed-2s binning folded everything past ~90min
    // into the final bin. The last point must reflect the last samples.
    const samples = Array.from({ length: 10800 }, (_, i) => ({ t: i, bpm: 100 + (i > 10000 ? 60 : 0) }));
    const ds = conDownsample(samples, 10800);
    expect(ds.every).toBeGreaterThan(2);
    expect(ds.pts[0]).toBe(100);
    // n is ceil(dur/every)+1, so the final bin can legitimately be empty — the
    // guarantee is that the last bin that DID receive samples carries the tail,
    // which is exactly what the clamped version destroyed.
    const filled = ds.pts.filter((p) => p != null);
    expect(filled[filled.length - 1]).toBe(160);
    expect(ds.pts.length * ds.every).toBeGreaterThanOrEqual(10800);
  });
});
