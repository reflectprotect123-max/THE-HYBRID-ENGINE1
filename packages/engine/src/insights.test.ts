/*
 * The insights engine.
 *
 * Half of these cases assert SILENCE, and that is the point of the module. A
 * detector that speaks from four data points, or from a difference inside its
 * own noise floor, is not a feature with a rough edge — it is a confident
 * sentence about an athlete's body that nothing in the data supports. The
 * refusals are the load-bearing behaviour, so they are tested at least as hard
 * as the findings.
 *
 * `now` is pinned rather than defaulted. The windows are relative to it, so a
 * suite that used the wall clock would drift into and out of its own fixtures
 * and start failing on a date nobody chose.
 *
 * `strengthAtEffort`, `workRate` and `volumeTolerance` were deleted whole on
 * 17 August 2026 with the rest of strength — all three compared logged sets
 * against a movement catalogue that no longer exists, and `insights()` no
 * longer reads `db.sessions` at all. Their describe blocks went with them
 * rather than being kept as fixtures for a code path that cannot fire.
 */
import { describe, expect, it } from 'vitest';
import { insights } from './insights';
import type { CondResult, EngineDB, Session } from './types';

const NOW = new Date('2026-07-28T12:00:00Z');
const at = (daysAgo: number): number => NOW.getTime() - daysAgo * 864e5;

/** Comfortably inside each window, away from either edge. */
const RECENT = [4, 9, 14, 19];
const BASE = [33, 38, 43, 48];

const db = (sessions: Session[], settings: EngineDB['settings'] = {}): EngineDB => ({
  workouts: [],
  sessions,
  settings,
});

const cond = (daysAgo: number, r: Partial<CondResult>): CondResult => ({
  id: 'c' + daysAgo + JSON.stringify(r).length,
  startedAt: at(daysAgo),
  ...r,
});

const find = (out: ReturnType<typeof insights>, key: string) => out.filter((i) => i.key === key);

/* ---------- heart-rate recovery ---------- */

describe('heart-rate recovery', () => {
  it('reports a faster settling heart', () => {
    const d = db([], {
      conditioning: [
        ...BASE.map((x) => cond(x, { hrr: 20 })),
        ...RECENT.map((x) => cond(x, { hrr: 28 })),
      ],
    });
    const [i] = find(insights(d, NOW), 'heart-rate-recovery');
    expect(i.from).toBe(20);
    expect(i.to).toBe(28);
    expect(i.unit).toBe('bpm');
    expect(i.improved).toBe(true);
  });

  it('refuses to draw a trend through simulated sessions', () => {
    const d = db([], {
      conditioning: [
        ...BASE.map((x) => cond(x, { hrr: 20 })),
        ...RECENT.map((x) => cond(x, { hrr: 28, sim: true })),
      ],
    });
    expect(find(insights(d, NOW), 'heart-rate-recovery')).toHaveLength(0);
  });

  it('ignores records with no HRR rather than counting them as zero', () => {
    const d = db([], {
      conditioning: [
        ...BASE.map((x) => cond(x, { hrr: 20 })),
        ...RECENT.map((x) => cond(x, { hrr: null })),
      ],
    });
    expect(find(insights(d, NOW), 'heart-rate-recovery')).toHaveLength(0);
  });
});

/* ---------- recovery trend ---------- */

describe('recovery trend', () => {
  it('reads the stored daily rows', () => {
    const rows = [
      ...BASE.map((x) => ({ date: new Date(at(x)).toISOString().slice(0, 10), recovery: 50, strain: null })),
      ...RECENT.map((x) => ({ date: new Date(at(x)).toISOString().slice(0, 10), recovery: 62, strain: null })),
    ];
    const [i] = find(insights(db([], { whoopDaily: rows }), NOW), 'recovery-trend');
    expect(i.from).toBe(50);
    expect(i.to).toBe(62);
    expect(i.unit).toBe('%');
  });

  it('survives whoopDaily being absent or the wrong shape', () => {
    expect(insights(db([], { whoopDaily: undefined }), NOW)).toEqual([]);
    expect(insights(db([], { whoopDaily: 'nonsense' as unknown }), NOW)).toEqual([]);
  });
});

/* ---------- zone efficiency ---------- */

describe('zone efficiency', () => {
  it('compares the hard-zone SHARE, not raw seconds', () => {
    const d = db([], {
      conditioning: [
        ...BASE.slice(0, 3).map((x) => cond(x, { felt: '7', zsec: { low: 100, mod: 100, high: 100 } })),
        ...RECENT.slice(0, 3).map((x) => cond(x, { felt: '7', zsec: { low: 100, mod: 100, high: 200 } })),
      ],
    });
    const [i] = find(insights(d, NOW), 'zone-efficiency');
    expect(i.from).toBeCloseTo(0.33, 2);
    expect(i.to).toBeCloseTo(0.5, 2);
    expect(i.improved).toBe(true);
  });

  it('is not fooled by a longer session at the same intensity', () => {
    // Twice the session, identical distribution. The share is unchanged, so
    // nothing has improved and nothing is claimed.
    const d = db([], {
      conditioning: [
        ...BASE.slice(0, 3).map((x) => cond(x, { felt: '7', zsec: { low: 100, mod: 100, high: 100 } })),
        ...RECENT.slice(0, 3).map((x) => cond(x, { felt: '7', zsec: { low: 200, mod: 200, high: 200 } })),
      ],
    });
    expect(find(insights(d, NOW), 'zone-efficiency')).toHaveLength(0);
  });
});

/* ---------- the engine itself ---------- */

describe('the engine', () => {
  it('returns nothing for an empty database', () => {
    expect(insights(db([]), NOW)).toEqual([]);
    expect(insights(null as unknown as EngineDB, NOW)).toEqual([]);
  });

  it('ignores conditioning older than the baseline window', () => {
    // 200 days ago is a different athlete, not a baseline.
    const ancient = db([], {
      conditioning: [
        ...[200, 205].map((x) => cond(x, { hrr: 15 })),
        ...RECENT.map((x) => cond(x, { hrr: 28 })),
      ],
    });
    expect(insights(ancient, NOW)).toEqual([]);
  });

  it('leads with the strongest finding and truncates nothing', () => {
    const d = db([], {
      conditioning: [
        // +100% HRR must outrank the zone-share move below.
        ...BASE.map((x) => cond(x, { hrr: 20 })),
        ...RECENT.map((x) => cond(x, { hrr: 40 })),
        ...BASE.slice(0, 3).map((x) => cond(x, { felt: '7', zsec: { low: 100, mod: 100, high: 100 } })),
        ...RECENT.slice(0, 3).map((x) => cond(x, { felt: '7', zsec: { low: 100, mod: 100, high: 200 } })),
      ],
    });
    const out = insights(d, NOW);
    expect(out.length).toBeGreaterThan(1);
    expect(out[0].key).toBe('heart-rate-recovery');
    expect(out.map((i) => i.key)).toContain('zone-efficiency');
  });

  it('gives every finding a stable id', () => {
    const d = db([], {
      conditioning: [
        ...BASE.map((x) => cond(x, { hrr: 20 })),
        ...RECENT.map((x) => cond(x, { hrr: 28 })),
      ],
    });
    const a = insights(d, NOW).map((i) => i.id);
    const b = insights(d, NOW).map((i) => i.id);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });
});
