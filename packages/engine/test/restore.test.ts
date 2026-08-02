import { describe, expect, it } from 'vitest';
import { emptyDB, pruneCondTraces, restoreDb, sanitizeDB } from '../src/db';
import type { CondBlock, EngineDB, Session, Workout } from '../src/types';

/*
 * Restoring a backup.
 *
 * The export button has existed since the sync work and there was no way to
 * load one back — so these are the first assertions that a backup is worth
 * taking at all. The ones that matter are the destructive-mistake tests: a
 * restore that quietly eats work logged since the backup, or resurrects
 * something deliberately deleted, is worse than no restore button.
 */

const wk = (id: string, name: string, at = 1): Workout =>
  ({ id, name, blocks: [], updatedAt: at }) as unknown as Workout;
const sess = (id: string, date: string, at = 1): Session =>
  ({ id, date, status: 'completed', blocks: [], updatedAt: at }) as unknown as Session;

const db = (w: Workout[], s: Session[], settings = {}): EngineDB => ({ workouts: w, sessions: s, settings });

describe('restoreDb', () => {
  it('refuses a file that is not a backup rather than importing nothing', () => {
    // sanitizeDB would happily turn any object into an empty database, and an
    // import that silently produces nothing is worse than one that says why.
    expect(() => restoreDb(emptyDB(), null)).toThrow(/not a backup/);
    expect(() => restoreDb(emptyDB(), [1, 2, 3])).toThrow(/not a backup/);
    expect(() => restoreDb(emptyDB(), { hello: 'world' })).toThrow(/no workouts, sessions or settings/);
  });

  it('accepts a backup that only carries settings', () => {
    // A profile-and-zones-only export is a legitimate thing to restore.
    const { db: out } = restoreDb(emptyDB(), { settings: { profile: { age: 30 } } });
    expect(out.settings.profile).toEqual({ age: 30 });
  });

  it('loads an empty app from a backup', () => {
    const file = db([wk('w1', 'Lower')], [sess('s1', '2026-01-02')]);
    const { db: out, report } = restoreDb(emptyDB(), file);
    expect(out.workouts).toHaveLength(1);
    expect(out.sessions).toHaveLength(1);
    expect(report).toMatchObject({ workouts: 1, sessions: 1, mode: 'merge' });
  });

  it('does NOT eat a session logged since the backup was taken', () => {
    // The whole reason merge is the default. Someone restores last week's
    // backup after a sync scare; the three sessions since must survive.
    const current = db([], [sess('s1', '2026-01-02'), sess('s2', '2026-01-04'), sess('s3', '2026-01-06')]);
    const old = db([], [sess('s1', '2026-01-02')]);
    const { db: out } = restoreDb(current, old);
    expect(out.sessions.map((s) => s.id).sort()).toEqual(['s1', 's2', 's3']);
  });

  it('does not resurrect something deliberately deleted after the backup', () => {
    // Tombstones outrank the file. Otherwise every restore undoes every delete
    // that came after it, which is how a Library fills back up with junk.
    const current = db([], [], { deletedIds: { w1: 9 } });
    const old = db([wk('w1', 'Deleted on purpose')], []);
    const { db: out } = restoreDb(current, old);
    expect(out.workouts).toHaveLength(0);
  });

  /*
   * `report.kept` — "records already present that the incoming file did not
   * add". It used to be inferred from how the totals moved
   * (`before + incoming − after`), which silently assumed the merge only ever
   * grows. Every record `notTombstoned` DROPPED shrank the after-total and so
   * inflated `kept` by one: a purge counted as a keep.
   */
  it('does not count a tombstoned record it correctly dropped as "kept"', () => {
    const current = db([], [], { deletedIds: { w1: 9 } });
    const old = db([wk('w1', 'Deleted on purpose')], []);
    const { db: out, report } = restoreDb(current, old);
    // Nothing survived at all, so nothing can have been kept.
    expect(out.workouts).toHaveLength(0);
    expect(report.kept).toBe(0); // was 1
  });

  it('does not count a tombstoned record present on BOTH sides as kept', () => {
    const current = db([wk('w1', 'Deleted on purpose')], [], { deletedIds: { w1: 9 } });
    const old = db([wk('w1', 'Deleted on purpose')], []);
    const { db: out, report } = restoreDb(current, old);
    expect(out.workouts).toHaveLength(0);
    expect(report.kept).toBe(0); // was 2 — more kept than the database holds
  });

  it('counts a local record the file knows nothing about as kept', () => {
    const current = db([wk('w1', 'Mine')], []);
    const file = db([wk('w2', 'Theirs')], []);
    const { db: out, report } = restoreDb(current, file);
    expect(out.workouts).toHaveLength(2);
    expect(report.kept).toBe(1); // w1 was already here and the file did not add it
  });

  it('counts a record present on both sides once, not twice', () => {
    const current = db([wk('w1', 'Mine', 500)], [sess('s1', '2026-01-02')]);
    const file = db([wk('w1', 'Older', 100)], []);
    const { report } = restoreDb(current, file);
    expect(report).toMatchObject({ workouts: 1, sessions: 1, kept: 2 });
  });

  it('keeps the newer of two records that exist on both sides', () => {
    const current = db([wk('w1', 'Renamed today', 500)], []);
    const old = db([wk('w1', 'Old name', 100)], []);
    expect(restoreDb(current, old).db.workouts[0].name).toBe('Renamed today');
  });

  it('replace throws away what is here, which is the point of it', () => {
    // For a corrupt local store, where merge cannot express "this file is the
    // truth". Destructive, so the caller has to ask for it by name.
    const current = db([wk('w9', 'Local junk')], [sess('s9', '2026-01-09')]);
    const file = db([wk('w1', 'Lower')], []);
    const { db: out, report } = restoreDb(current, file, 'replace');
    expect(out.workouts.map((w) => w.id)).toEqual(['w1']);
    expect(out.sessions).toHaveLength(0);
    expect(report.mode).toBe('replace');
  });

  it('survives a backup with junk inside it', () => {
    const file = { workouts: [null, { id: 'w1', blocks: 'nonsense' }], sessions: 'nope', settings: 7 };
    const { db: out } = restoreDb(emptyDB(), file);
    expect(out.sessions).toEqual([]);
    expect(out.workouts).toHaveLength(2);
    expect(Array.isArray(out.workouts[1].blocks)).toBe(true);
  });

  it('drops non-object entries from settings.conditioning, keeping the valid record', () => {
    // A backup restore in 'replace' mode (or a stale local blob) can carry a
    // poisoned settings.conditioning array straight through sanitizeDB — which
    // then crashes condEfforts/datedEfforts/pushCondHistory on the null/number
    // entries. sanitizeDB is the trust boundary, so it should scrub these.
    const out = sanitizeDB({
      settings: { conditioning: [null, 'garbage', { id: 'c1', startedAt: 123 }, 42] },
    });
    expect(out.settings.conditioning).toEqual([{ id: 'c1', startedAt: 123 }]);
  });

  it('a __proto__ key in restored settings cannot wipe the library', () => {
    const cur = sanitizeDB({
      workouts: [{ id: 'w1', name: 'A', updatedAt: 1, blocks: [] }],
      sessions: [
        { id: 's1', date: '2026-01-01', status: 'completed', completedAt: 1, blocks: [] },
        { id: 's2', date: '2026-01-02', status: 'completed', completedAt: 1, blocks: [] },
      ],
      settings: {},
    });
    const hostile = JSON.parse(
      '{"workouts":[],"sessions":[],"settings":{"__proto__":{"deletedIds":' +
        '{"w1":9007199254740991,"s1":9007199254740991,"s2":9007199254740991}}}}',
    );
    const { db } = restoreDb(cur, hostile, 'merge');
    expect(db.workouts.length).toBe(1);
    expect(db.sessions.length).toBe(2);
    // the poison never became a prototype
    expect(Object.getPrototypeOf(db.settings)).toBe(Object.prototype);
  });
});

/*
 * pruneCondTraces
 *
 * Inline HR/GPS traces are ~78% of the serialised blob and, left unbounded,
 * they cross the localStorage quota — after which EVERY save fails forever.
 * These assert the fix keeps trace/route on the most recent `keep` sessions
 * that carry a conditioning result and strips them from every older one,
 * while leaving the zone-seconds (the numbers progression actually reads)
 * untouched everywhere.
 */
const condSession = (id: string, completedAt: number): Session => {
  const block: CondBlock = {
    id: id + '-b',
    kind: 'conditioning',
    condFmt: 'steady',
    condResult: {
      id: id + '-c',
      fmt: 'steady',
      effort: 'medium',
      dur: 600,
      zsec: { low: 100, mod: 400, high: 100 },
      trace: { every: 2, pts: [120, 130, 140] },
      route: { every: 2, pts: [{ lat: 1, lon: 1 }] },
    },
  };
  return {
    id,
    date: '2026-01-01',
    status: 'completed',
    completedAt,
    blocks: [block],
  } as unknown as Session;
};

describe('pruneCondTraces', () => {
  it('keeps trace/route on the most recent `keep` conditioning sessions and strips older ones', () => {
    // 15 sessions, timestamps 1..15 — keep the newest 12 (a small keep here to
    // exercise the boundary without an unwieldy fixture).
    const sessions = Array.from({ length: 15 }, (_, i) => condSession('s' + (i + 1), i + 1));
    const { sessions: out, changed } = pruneCondTraces(sessions, 12);
    expect(changed).toBe(true);

    const byId = new Map(out.map((s) => [s.id, s]));
    // The 3 oldest (s1..s3) must have trace/route stripped, zsec intact.
    for (const id of ['s1', 's2', 's3']) {
      const r = (byId.get(id)!.blocks[0] as CondBlock).condResult!;
      expect(r.trace).toBeUndefined();
      expect((r as { route?: unknown }).route).toBeUndefined();
      expect(r.zsec).toEqual({ low: 100, mod: 400, high: 100 });
    }
    // The 12 most recent (s4..s15) keep both.
    for (const id of ['s4', 's5', 's15']) {
      const r = (byId.get(id)!.blocks[0] as CondBlock).condResult!;
      expect(r.trace).toEqual({ every: 2, pts: [120, 130, 140] });
      expect((r as { route?: unknown }).route).toEqual({ every: 2, pts: [{ lat: 1, lon: 1 }] });
    }
  });

  it('returns changed: false and leaves sessions untouched when nothing needs stripping', () => {
    const sessions = Array.from({ length: 5 }, (_, i) => condSession('s' + (i + 1), i + 1));
    const { sessions: out, changed } = pruneCondTraces(sessions, 12);
    expect(changed).toBe(false);
    expect(out).toEqual(sessions);
  });

  it('leaves sessions with no conditioning result alone', () => {
    const plain = { id: 'p1', date: '2026-01-01', status: 'completed', blocks: [] } as unknown as Session;
    const { sessions: out, changed } = pruneCondTraces([plain], 0);
    expect(changed).toBe(false);
    expect(out).toEqual([plain]);
  });
});
