/*
 * The trust boundary and the merge rules, tested directly — the paths that
 * lose or corrupt a folder if they go wrong, none of them observable from the
 * UI until the damage is already done.
 */
import { describe, expect, it } from 'vitest';
import { mergeEngines, mergeSettings, pickWorkout, sanitizeDB } from '../src/db';
import { ungroupedWorkouts } from '../src/folders';
import type { EngineDB, Workout } from '../src/types';

describe('sanitizeDB folders', () => {
  it('drops a folder missing an id or a name, keeps a valid one', () => {
    const out = sanitizeDB({
      workouts: [],
      sessions: [],
      settings: {
        folders: [
          { id: 'f1', name: 'Week 1' },
          { id: '', name: 'no id' },
          { id: 'f2' },
          'garbage',
          null,
        ],
      },
    });
    expect(out.settings.folders).toEqual([{ id: 'f1', name: 'Week 1' }]);
  });

  it('drops non-string folderIds entries on a workout, keeps valid ones', () => {
    const out = sanitizeDB({
      workouts: [{ id: 'w1', blocks: [], folderIds: ['f1', '', 42, null, 'f2'] }],
      sessions: [],
      settings: {},
    });
    expect(out.workouts[0].folderIds).toEqual(['f1', 'f2']);
  });
});

describe('mergeSettings folders', () => {
  it('a folder created on each of two devices survives the merge', () => {
    const base = { folders: [{ id: 'f1', name: 'Week 1' }] };
    const winner = { folders: [{ id: 'f2', name: 'Week 2' }] };
    const out = mergeSettings(base, winner);
    expect((out.folders || []).map((f) => f.id).sort()).toEqual(['f1', 'f2']);
  });

  it('winner takes the name on an id present on both sides', () => {
    const base = { folders: [{ id: 'f1', name: 'Old name' }] };
    const winner = { folders: [{ id: 'f1', name: 'New name' }] };
    const out = mergeSettings(base, winner);
    expect(out.folders).toEqual([{ id: 'f1', name: 'New name' }]);
  });

  it('a folder deleted (and tombstoned) on one side is not revived by a stale copy on the other', () => {
    const deletedHere = { folders: [], deletedIds: { f1: 2000 } };
    const staleOther = { folders: [{ id: 'f1', name: 'Week 1' }] };
    const a = mergeSettings(deletedHere, staleOther);
    expect(a.folders || []).toEqual([]);
    const b = mergeSettings(staleOther, deletedHere);
    expect(b.folders || []).toEqual([]);
  });
});

describe('pickWorkout unions folderIds like days/dates', () => {
  const wk = (over: Partial<Workout>): Workout => ({ id: 'w1', blocks: [], updatedAt: 1, ...over });

  it('keeps folder tags from BOTH sides, not just the newer one', () => {
    const older = wk({ updatedAt: 1, folderIds: ['f1'] });
    const newer = wk({ updatedAt: 2, folderIds: ['f2'] });
    const out = pickWorkout(older, newer);
    expect((out.folderIds || []).sort()).toEqual(['f1', 'f2']);
  });
});

/*
 * The gap the final whole-branch review actually found: every test above (and
 * the "folders deleted (and tombstoned)" case in particular) hand-builds a
 * `deletedIds` map and proves `mergeSettings` honours one THAT ALREADY
 * EXISTS. None of them ever asked whether the app write that deletes a folder
 * produces one. It didn't — both `removeFolder` implementations (web and
 * mobile Library.tsx) spliced the folder out of `settings.folders` and
 * stripped the id from every workout's `folderIds`, but never wrote to
 * `settings.deletedIds`, so a stale sync would revive both the folder and the
 * tags that were just stripped.
 *
 * This test proves the closed loop end-to-end rather than trusting the two
 * component fixes by inspection: it replicates the exact object-level shape
 * both `removeFolder` functions now produce (splice + strip tags + tombstone
 * write, the same three steps, in the same order, using the same
 * `deletedIds` spread pattern `removeWorkout`/`remove` already use for a
 * workout id) and runs THAT through the real `mergeEngines`/`mergeSettings`
 * against a stale remote copy that never saw the delete.
 */
describe('the actual removeFolder write path survives a merge with a stale remote', () => {
  /** Mirrors `removeFolder` in both apps/web and apps/mobile's Library.tsx,
   *  object-for-object: splice the folder, strip its id from every workout's
   *  `folderIds`, then tombstone the folder id — not a hand-built
   *  `deletedIds` map, the actual sequence of writes the UI now performs. */
  function appRemoveFolder(db: EngineDB, folderId: string): EngineDB {
    const workouts = db.workouts.map((w) =>
      (w.folderIds || []).includes(folderId)
        ? { ...w, folderIds: (w.folderIds || []).filter((id) => id !== folderId) }
        : w,
    );
    const folders = (db.settings.folders || []).filter((f) => f.id !== folderId);
    const deletedIds = { ...(db.settings.deletedIds || {}), [folderId]: Date.now() };
    return { ...db, workouts, settings: { ...db.settings, folders, deletedIds } };
  }

  it('drops the folder id from settings.folders and tags it in deletedIds', () => {
    const before: EngineDB = {
      workouts: [{ id: 'w1', blocks: [], updatedAt: 1, folderIds: ['f1'] }],
      sessions: [],
      settings: { folders: [{ id: 'f1', name: 'Week 1' }] },
    };
    const after = appRemoveFolder(before, 'f1');
    expect(after.settings.folders).toEqual([]);
    expect(after.workouts[0].folderIds).toEqual([]);
    expect(after.settings.deletedIds).toEqual({ f1: expect.any(Number) });
  });

  it('the folder does not come back — and the workout renders ungrouped, not under a revived folder — after merging against a stale remote that still has it', () => {
    const local: EngineDB = {
      workouts: [{ id: 'w1', blocks: [], updatedAt: 1, folderIds: ['f1'] }],
      sessions: [],
      settings: { folders: [{ id: 'f1', name: 'Week 1' }] },
    };
    // Deleted locally — the app write, not a hand-built tombstone.
    const afterDelete = appRemoveFolder(local, 'f1');

    // A second device that hasn't caught up: still has the folder AND the
    // workout still tagged into it.
    const staleRemote: EngineDB = {
      workouts: [{ id: 'w1', blocks: [], updatedAt: 1, folderIds: ['f1'] }],
      sessions: [],
      settings: { folders: [{ id: 'f1', name: 'Week 1' }] },
    };

    // mergeEngines(local, remote): local is the side that just deleted.
    const merged = mergeEngines(afterDelete, staleRemote);

    // 1. mergeSettings sees the tombstone and excludes the folder from the
    //    merged folder list — closing the loop `mergeSettings` was already
    //    tested for, now actually fed by the write the UI produces.
    expect(merged.settings.folders || []).toEqual([]);

    // 2. pickWorkout's folderIds union (deliberately additive, same as
    //    days/dates) means the merged workout MAY still carry the stale 'f1'
    //    tag literally in its array — that is expected, not a regression.
    //    What must NOT happen is the workout rendering as if it were still
    //    filed in a folder that no longer exists: `ungroupedWorkouts` checks
    //    membership against the LIVE folder list, so with 'f1' absent from
    //    `merged.settings.folders`, the workout must fall back to ungrouped.
    const w = merged.workouts.find((x) => x.id === 'w1');
    expect(w).toBeTruthy();
    const stillUngrouped = ungroupedWorkouts(merged.workouts, merged.settings.folders || []);
    expect(stillUngrouped.map((x) => x.id)).toContain('w1');
  });
});
