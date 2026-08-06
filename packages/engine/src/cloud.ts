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
