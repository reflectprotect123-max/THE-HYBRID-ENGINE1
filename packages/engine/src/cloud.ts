import { cloudFp, mergeEngines, sanitizeDB } from './db';
import type { EngineDB } from './types';

/*
 * The sync protocol, as logic.
 *
 * Every rule here exists because breaking it loses an athlete's work, so they
 * are kept out of the network layer where they would be untestable.
 */

/**
 * What to send up, given what is already there.
 *
 * Known gap (2026-08-03, strength/conditioning split): this does not run the
 * merge result through `sanitizeDB` before push. For a legacy mixed-block
 * session whose conditioning half was already logged, `pickSession` ranks
 * logged-work-count above `updatedAt`, so a still-mixed remote copy keeps
 * winning `mergeEngines` and gets pushed back up unsanitized, un-split,
 * forever. This is bounded and non-corrupting — the LOCAL db stays correct
 * and split (`sanitizeDB` runs on every pull/load) — only the server's copy
 * of that one historical record never converges to the split shape. Wrapping
 * this return value's `hybridEngine` in `sanitizeDB(...)` would fix it, and
 * was verified to work, but was deliberately not done here: it changes what
 * EVERY push writes app-wide, which is a broader call than one migration's
 * scope. Worth doing next time this function is touched.
 */
export function buildPushState(local: EngineDB, remoteState: Record<string, unknown>): Record<string, unknown> {
  const rawEx = ((remoteState && remoteState.hybridEngine) || {}) as Partial<EngineDB>;
  const exEngine: EngineDB = {
    workouts: rawEx.workouts || [],
    sessions: rawEx.sessions || [],
    settings: rawEx.settings || {},
  };
  return { ...remoteState, hybridEngine: mergeEngines(local, exEngine) };
}

export interface PullOutcome {
  db: EngineDB;
  /** true when the merge produced something the remote does not yet have */
  needsPush: boolean;
}

/**
 * Fold a pulled remote state into the local DB.
 *
 * Record-level MERGE, never last-write-wins: two devices can schedule and log
 * between syncs and neither may lose work. The pulled state is re-sanitised
 * because it is foreign input — it may have been written by an older client, or
 * by a client with a bug.
 */
export function applyPull(local: EngineDB, remote: EngineDB | null): PullOutcome {
  if (!remote) return { db: local, needsPush: true };
  if (cloudFp(remote) === cloudFp(local)) return { db: local, needsPush: false };
  const merged = mergeEngines(local, remote);
  return { db: sanitizeDB(merged), needsPush: cloudFp(merged) !== cloudFp(remote) };
}
