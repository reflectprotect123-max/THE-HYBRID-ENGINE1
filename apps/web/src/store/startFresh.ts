import type { EngineDB } from '@hybrid/engine';

/**
 * Clear the training content out of the athlete's own store.
 *
 * The reason this exists: a live app filled with sessions built while the
 * builder's Save button was still a stub — a session called "Session", a block
 * called "NEW BLOCK", exercises called "Exercise", nothing prescribed. Real
 * rows, no real content, and no way to get rid of them short of clearing site
 * data (which also takes the settings and the nutrition log).
 *
 * WHAT IT TOUCHES, and nothing else:
 *   workouts, sessions — the training content
 *   settings.deletedIds — a tombstone per removed id
 *   ecosystem.partitions.strength / .conditioning / .athleteState / .weeklyPlan
 *   ecosystem.events — the training half of the sync scaffolding
 *
 * WHAT IT LEAVES: every other setting, the shared-core facts (recovery, life
 * load, illness — observations about the athlete, not workouts), and the whole
 * nutrition slice, which is its own sync partition and has nothing to do with
 * a junk workout (CLAUDE.md). "Start fresh" means start the TRAINING fresh;
 * silently binning someone's food log alongside it would be a different, much
 * larger promise.
 *
 * THE SYNC SCAFFOLDING GOES TOO, added 12 August 2026. Clearing `workouts`
 * and `sessions` alone leaves the domain snapshots and the event log holding
 * the same content, and those are what a second device pulls — so the junk a
 * coach just deleted on their phone reappeared from the web, and from the
 * server. Tombstones cover records that travel BY ID; a snapshot is a whole
 * blob under a revision and answers to nothing but being replaced.
 *
 * TOMBSTONES, not just deletion. `mergeEngines` filters an incoming record
 * through `notTombstoned`, comparing the deletion time against the record's
 * `updatedAt`. Without a tombstone the server's copy of every session would
 * come straight back on the next pull, and the clear would look like it had
 * silently failed. `now` is a parameter so the caller stamps it — a tombstone
 * is a timestamp comparison, and a test must be able to control both sides.
 */
export function startFresh(db: EngineDB, now: number): EngineDB {
  const ids = [
    ...db.workouts.map((w) => w.id),
    ...db.sessions.map((s) => s.id),
  ].filter((id): id is string => typeof id === 'string' && id.length > 0);

  const deletedIds = { ...(db.settings.deletedIds || {}) };
  for (const id of ids) deletedIds[id] = now;

  /*
   * Training partitions emptied, nutrition's left exactly as it is. Kept as
   * present-but-empty snapshots rather than deleted keys: the sync layer reads
   * a missing partition as "this device has nothing to say" and a stale remote
   * copy then wins the merge, which is how a clear undoes itself.
   */
  const eco = db.ecosystem;
  const ecosystem = eco
    ? {
        ...eco,
        partitions: {
          ...eco.partitions,
          strength: undefined,
          conditioning: undefined,
          athleteState: undefined,
          weeklyPlan: undefined,
        },
        events: [],
      }
    : eco;

  return {
    ...db,
    workouts: [],
    sessions: [],
    settings: { ...db.settings, deletedIds },
    ...(ecosystem ? { ecosystem } : {}),
  };
}

/** What `startFresh` would remove, for a confirmation the athlete can trust. */
export function startFreshCounts(db: EngineDB): { workouts: number; sessions: number } {
  return { workouts: db.workouts.length, sessions: db.sessions.length };
}
