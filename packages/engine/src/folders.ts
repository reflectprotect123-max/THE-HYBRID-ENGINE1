import type { Folder, Workout } from './types';

/**
 * Workouts actually rendered under one folder.
 */
export function workoutsInFolder(workouts: Workout[], folderId: string): Workout[] {
  return workouts.filter((w) => (w.folderIds || []).includes(folderId));
}

/**
 * A workout with no CURRENTLY VALID folder membership.
 *
 * Membership is checked against the live `folders` list, not just whether
 * `folderIds` is non-empty — a folderId left over from a deleted folder
 * (revived by a sync race before its own tombstone catches up, see
 * `mergeSettings`) must not strand a workout invisible in neither the folder
 * view (the folder itself is gone) nor the flat ungrouped list.
 */
export function ungroupedWorkouts(workouts: Workout[], folders: Folder[]): Workout[] {
  const known = new Set(folders.map((f) => f.id));
  return workouts.filter((w) => !(w.folderIds || []).some((id) => known.has(id)));
}
