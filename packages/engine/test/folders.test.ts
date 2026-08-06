import { describe, expect, it } from 'vitest';
import { ungroupedWorkouts, workoutsInFolder } from '../src/folders';
import type { Folder, Workout } from '../src/types';

const wk = (id: string, folderIds?: string[]): Workout => ({ id, blocks: [], folderIds });

describe('workoutsInFolder', () => {
  it('returns only workouts tagged with that folder id', () => {
    const workouts = [wk('a', ['f1']), wk('b', ['f2']), wk('c', ['f1', 'f2'])];
    expect(workoutsInFolder(workouts, 'f1').map((w) => w.id).sort()).toEqual(['a', 'c']);
  });

  it('returns nothing for a folder with no members', () => {
    expect(workoutsInFolder([wk('a', ['f1'])], 'f2')).toEqual([]);
  });
});

describe('ungroupedWorkouts', () => {
  const folders: Folder[] = [{ id: 'f1', name: 'Week 1' }];

  it('lists a workout with no folderIds', () => {
    expect(ungroupedWorkouts([wk('a')], folders).map((w) => w.id)).toEqual(['a']);
  });

  it('excludes a workout tagged into a folder that still exists', () => {
    expect(ungroupedWorkouts([wk('a', ['f1'])], folders)).toEqual([]);
  });

  it('a stale folderId left over from a DELETED folder still counts as ungrouped', () => {
    // The exact sync-race edge case the spec calls out: a workout's folderIds
    // union back in a deleted folder's id before that folder's own tombstone
    // catches up. It must not vanish from both the folder view (the folder is
    // gone) and the flat list (folderIds is non-empty).
    expect(ungroupedWorkouts([wk('a', ['deleted-folder'])], folders).map((w) => w.id)).toEqual(['a']);
  });
});
