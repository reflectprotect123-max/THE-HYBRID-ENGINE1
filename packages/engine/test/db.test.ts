/*
 * The trust boundary and the merge rules, tested directly — the paths that
 * lose or corrupt a folder if they go wrong, none of them observable from the
 * UI until the damage is already done.
 */
import { describe, expect, it } from 'vitest';
import { mergeSettings, pickWorkout, sanitizeDB } from '../src/db';
import type { Workout } from '../src/types';

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
