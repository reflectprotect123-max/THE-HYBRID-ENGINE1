import type { EngineDB } from '@hybrid/engine';

/**
 * Clear the training content out of the athlete's own store.
 *
 * The reason this exists: an app can fill up with sessions that are real rows
 * and no real content — a session called "Session", a block called "NEW
 * BLOCK", exercises called "Exercise", nothing prescribed — with no way to get
 * rid of them short of clearing the app's storage, which also takes the
 * settings, the connected devices and the nutrition log.
 *
 * IDENTICAL to `apps/web/src/store/startFresh.ts`, deliberately. Both apps
 * write the same `EngineDB` to the same backend, so "start fresh" has to mean
 * the same thing on each — a phone that cleared less than the web did would
 * hand the difference straight back on the next sync.
 *
 * WHAT IT TOUCHES, and nothing else:
 *   workouts, sessions — the training content
 *   settings.deletedIds — a tombstone per removed id
 *
 * WHAT IT LEAVES: every other setting, the shared-core facts, the ecosystem
 * snapshots, and the whole nutrition slice — which is its own sync partition
 * and has nothing to do with a junk workout (CLAUDE.md). "Start fresh" means
 * start the TRAINING fresh; silently binning someone's food log alongside it
 * would be a different, much larger promise.
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

  return {
    ...db,
    workouts: [],
    sessions: [],
    settings: { ...db.settings, deletedIds },
  };
}

/** What `startFresh` would remove, for a confirmation the athlete can trust. */
export function startFreshCounts(db: EngineDB): { workouts: number; sessions: number } {
  return { workouts: db.workouts.length, sessions: db.sessions.length };
}
