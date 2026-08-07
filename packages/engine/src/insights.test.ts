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
 */
import { describe, expect, it } from 'vitest';
import { insights } from './insights';
import type { CondResult, EngineDB, LoggedSet, Session } from './types';

const NOW = new Date('2026-07-28T12:00:00Z');
const at = (daysAgo: number): number => NOW.getTime() - daysAgo * 864e5;

/** Comfortably inside each window, away from either edge. */
const RECENT = [4, 9, 14, 19];
const BASE = [33, 38, 43, 48];

const set = (kg: number, reps: number, felt: string): LoggedSet => ({
  t: String(reps),
  rpe: '8',
  aVal: String(kg),
  aVal2: String(reps),
  felt,
  done: true,
});

function session(
  daysAgo: number,
  sets: LoggedSet[],
  extra: Partial<Session> = {},
  name = 'Bench press',
): Session {
  return {
    id: 's' + daysAgo + name,
    date: '2026-01-01',
    status: 'completed',
    completedAt: at(daysAgo),
    blocks: [{ id: 'b' + daysAgo, heading: 'Main', exercises: [{ id: 'e1', name, mode: 'reps_kg', sets }] }],
    ...extra,
  };
}

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

/* ---------- strength at matched effort ---------- */

describe('strength at matched effort', () => {
  /** Two sets at the same felt in each window, at a heavier load now. */
  const improving = db([
    ...BASE.slice(0, 2).map((d) => session(d, [set(100, 5, '8'), set(100, 5, '8')])),
    ...RECENT.slice(0, 2).map((d) => session(d, [set(110, 5, '8'), set(110, 5, '8')])),
  ]);

  it('reports more weight at the SAME felt RPE', () => {
    const [i] = find(insights(improving, NOW), 'strength-at-effort');
    expect(i).toBeTruthy();
    expect(i.subject).toBe('Bench press');
    expect(i.improved).toBe(true);
    // Epley: 100×5 → 116.67, 110×5 → 128.33.
    expect(i.from).toBeCloseTo(116.67, 1);
    expect(i.to).toBeCloseTo(128.33, 1);
    expect(i.title).toContain('same effort, more weight');
  });

  it('carries the evidence for its own claim', () => {
    const [i] = find(insights(improving, NOW), 'strength-at-effort');
    expect(i.evidence.recentN).toBe(4);
    expect(i.evidence.baselineN).toBe(4);
    expect(i.evidence.windowDays).toBe(28);
  });

  it('says NOTHING when the extra weight was bought with extra effort', () => {
    // Same load increase, but every recent set was rated a 9.5 rather than an
    // 8. There is no shared effort to compare across, so there is no finding —
    // grinding is not adaptation, and congratulating it would encourage it.
    const grinding = db([
      ...BASE.slice(0, 2).map((d) => session(d, [set(100, 5, '8'), set(100, 5, '8')])),
      ...RECENT.slice(0, 2).map((d) => session(d, [set(110, 5, '9.5'), set(110, 5, '9.5')])),
    ]);
    expect(find(insights(grinding, NOW), 'strength-at-effort')).toHaveLength(0);
  });

  it('says nothing when the change is inside the noise floor', () => {
    const flat = db([
      ...BASE.slice(0, 2).map((d) => session(d, [set(100, 5, '8'), set(100, 5, '8')])),
      // +1kg on 100 is under the 2% floor: rounding, not a trend.
      ...RECENT.slice(0, 2).map((d) => session(d, [set(101, 5, '8'), set(101, 5, '8')])),
    ]);
    expect(find(insights(flat, NOW), 'strength-at-effort')).toHaveLength(0);
  });

  it('says nothing without enough sets in both windows', () => {
    const thin = db([
      session(BASE[0], [set(100, 5, '8'), set(100, 5, '8')]),
      // One recent session of two sets clears the per-bucket minimum but not
      // the per-window one.
      session(RECENT[0], [set(110, 5, '8'), set(110, 5, '8')]),
    ]);
    expect(find(insights(thin, NOW), 'strength-at-effort')).toHaveLength(0);
  });

  it('says nothing when there is no baseline at all', () => {
    const newAthlete = db(RECENT.map((d) => session(d, [set(100, 5, '8'), set(100, 5, '8')])));
    expect(insights(newAthlete, NOW)).toHaveLength(0);
  });

  it('ignores warm-up sets and warm-up blocks', () => {
    // The recent windows' only WORKING sets match the baseline exactly; the
    // heavy-looking numbers are all prep. Nothing has changed.
    const withPrep = db([
      ...BASE.slice(0, 2).map((d) => session(d, [set(100, 5, '8'), set(100, 5, '8')])),
      ...RECENT.slice(0, 2).map((d) =>
        session(d, [
          set(100, 5, '8'),
          set(100, 5, '8'),
          { ...set(200, 5, '8'), t: 'W5' },
        ]),
      ),
    ]);
    expect(find(insights(withPrep, NOW), 'strength-at-effort')).toHaveLength(0);
  });

  it('reports a decline rather than hiding it', () => {
    const declining = db([
      ...BASE.slice(0, 2).map((d) => session(d, [set(110, 5, '8'), set(110, 5, '8')])),
      ...RECENT.slice(0, 2).map((d) => session(d, [set(100, 5, '8'), set(100, 5, '8')])),
    ]);
    const [i] = find(insights(declining, NOW), 'strength-at-effort');
    expect(i.improved).toBe(false);
    expect(i.title).toContain('less weight');
  });
});

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

/* ---------- work rate ---------- */

describe('work rate', () => {
  const rep = (daysAgo: number, minutes: number): Session =>
    session(daysAgo, [set(100, 5, '8'), set(100, 5, '8'), set(100, 5, '8')], {
      workoutId: 'w1',
      startedAt: at(daysAgo) - minutes * 60000,
      name: 'Upper A',
    });

  it('compares a session only against ITSELF', () => {
    const d = db([...BASE.slice(0, 2).map((x) => rep(x, 60)), ...RECENT.slice(0, 2).map((x) => rep(x, 50))]);
    const [i] = find(insights(d, NOW), 'work-rate');
    expect(i.subject).toBe('Upper A');
    // 1500kg over 60min vs over 50min.
    expect(i.from).toBeCloseTo(25, 1);
    expect(i.to).toBeCloseTo(30, 1);
    expect(i.improved).toBe(true);
  });

  it('does not compare two DIFFERENT sessions', () => {
    const other = (daysAgo: number, minutes: number): Session => ({
      ...rep(daysAgo, minutes),
      workoutId: 'w2',
    });
    const d = db([...BASE.slice(0, 2).map((x) => rep(x, 60)), ...RECENT.slice(0, 2).map((x) => other(x, 50))]);
    expect(find(insights(d, NOW), 'work-rate')).toHaveLength(0);
  });

  it('discards a session left open for hours', () => {
    // Without the clamp this baseline reads as 2.5kg/min and the recent window
    // looks like a twelvefold improvement invented by a forgotten browser tab.
    const d = db([...BASE.slice(0, 2).map((x) => rep(x, 600)), ...RECENT.slice(0, 2).map((x) => rep(x, 50))]);
    expect(find(insights(d, NOW), 'work-rate')).toHaveLength(0);
  });
});

/* ---------- volume tolerance ---------- */

describe('volume tolerance', () => {
  const bulk = (daysAgo: number, sets: number, felt: string): Session =>
    session(daysAgo, Array.from({ length: sets }, () => set(100, 5, felt)));

  it('fires when tonnage rose and the effort did not', () => {
    const d = db([
      ...BASE.slice(0, 3).map((x) => bulk(x, 3, '8')),
      ...RECENT.slice(0, 3).map((x) => bulk(x, 4, '8')),
    ]);
    const [i] = find(insights(d, NOW), 'volume-tolerance');
    expect(i).toBeTruthy();
    expect(i.from).toBe(1500);
    expect(i.to).toBe(2000);
    expect(i.improved).toBe(true);
  });

  it('stays silent when the extra tonnage cost more effort', () => {
    // The whole finding is "more work at no more cost". Drop the second half
    // and it is just "you did more sets", which the athlete already knows.
    const d = db([
      ...BASE.slice(0, 3).map((x) => bulk(x, 3, '7')),
      ...RECENT.slice(0, 3).map((x) => bulk(x, 4, '9')),
    ]);
    expect(find(insights(d, NOW), 'volume-tolerance')).toHaveLength(0);
  });

  it('stays silent when tonnage fell', () => {
    const d = db([
      ...BASE.slice(0, 3).map((x) => bulk(x, 4, '8')),
      ...RECENT.slice(0, 3).map((x) => bulk(x, 3, '8')),
    ]);
    expect(find(insights(d, NOW), 'volume-tolerance')).toHaveLength(0);
  });

  it('stays silent with no felt RPE to judge the cost by', () => {
    const noFelt = (daysAgo: number, sets: number): Session =>
      session(
        daysAgo,
        Array.from({ length: sets }, () => ({ ...set(100, 5, ''), felt: undefined })),
      );
    const d = db([...BASE.slice(0, 3).map((x) => noFelt(x, 3)), ...RECENT.slice(0, 3).map((x) => noFelt(x, 4))]);
    expect(find(insights(d, NOW), 'volume-tolerance')).toHaveLength(0);
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

  it('ignores sessions with nothing logged on them', () => {
    const empty: Session = {
      id: 'x',
      date: '2026-07-01',
      status: 'completed',
      completedAt: at(5),
      blocks: [{ id: 'b', heading: 'Main', exercises: [{ id: 'e', name: 'Bench press', mode: 'reps_kg', sets: [] }] }],
    };
    expect(insights(db([empty]), NOW)).toEqual([]);
  });

  it('ignores work older than the baseline window', () => {
    // 200 days ago is a different athlete, not a baseline.
    const ancient = db([
      ...[200, 205].map((d) => session(d, [set(60, 5, '8'), set(60, 5, '8')])),
      ...RECENT.slice(0, 2).map((d) => session(d, [set(110, 5, '8'), set(110, 5, '8')])),
    ]);
    expect(insights(ancient, NOW)).toEqual([]);
  });

  it('leads with the strongest finding and truncates nothing', () => {
    const d = db(
      [
        ...BASE.slice(0, 2).map((x) => session(x, [set(100, 5, '8'), set(100, 5, '8')])),
        ...RECENT.slice(0, 2).map((x) => session(x, [set(110, 5, '8'), set(110, 5, '8')])),
      ],
      {
        conditioning: [
          ...BASE.map((x) => cond(x, { hrr: 20 })),
          // +100% HRR must outrank the ~10% strength move.
          ...RECENT.map((x) => cond(x, { hrr: 40 })),
        ],
      },
    );
    const out = insights(d, NOW);
    expect(out.length).toBeGreaterThan(1);
    expect(out[0].key).toBe('heart-rate-recovery');
    expect(out.map((i) => i.key)).toContain('strength-at-effort');
  });

  it('gives every finding a stable id', () => {
    const d = db([
      ...BASE.slice(0, 2).map((x) => session(x, [set(100, 5, '8'), set(100, 5, '8')])),
      ...RECENT.slice(0, 2).map((x) => session(x, [set(110, 5, '8'), set(110, 5, '8')])),
    ]);
    const a = insights(d, NOW).map((i) => i.id);
    const b = insights(d, NOW).map((i) => i.id);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });
});
