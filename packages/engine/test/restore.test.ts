import { describe, expect, it } from 'vitest';
import { emptyDB, restoreDb } from '../src/db';
import type { EngineDB, Session, Workout } from '../src/types';

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
});
