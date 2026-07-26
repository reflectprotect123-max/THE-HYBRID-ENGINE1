import { cloudFp, materializeAssignment, mergeEngines, sanitizeDB } from './db';
import { hasLoggedWork } from './session';
import type { EngineDB, Session, Settings, Workout } from './types';

/*
 * The sync protocol, as logic.
 *
 * Every rule here exists because breaking it loses an athlete's work, so they
 * are kept out of the network layer where they would be untestable.
 */

export interface AssignmentRow {
  id: string;
  scheduled_date?: string | null;
  session_snapshot?: unknown;
  updated_at?: string;
  status?: string;
}

export interface ReconcileResult {
  workouts: Workout[];
  changed: boolean;
}

/**
 * Fold the athlete's current assignment set into local workouts.
 *
 * Coach-assigned work is a MATERIALISATION of the authoritative `assignments`
 * table, never a local record — hence `id = 'coach:' + assignmentId` and
 * `origin: 'coach'`. The three rules that matter:
 *
 *  - ADD when absent.
 *  - UPDATE only when the session has not been started and the row's
 *    `updated_at` actually changed. Re-materialising a started session would
 *    throw away sets the athlete has already logged against it.
 *  - REMOVE templates that are no longer assigned, unless a started or logged
 *    session still references them — otherwise finishing a session the coach
 *    unassigned mid-workout deletes it out from under you.
 *
 * A workout the athlete deleted locally must not be resurrected just because
 * the assignment row still exists (a remote delete that didn't land), so a
 * tombstone newer than the row wins until the coach changes it again.
 */
export function reconcileAssignments(
  workouts: Workout[],
  sessions: Session[],
  settings: Settings,
  rows: AssignmentRow[],
): ReconcileResult {
  const live = new Map<string, AssignmentRow>();
  rows.forEach((r) => live.set('coach:' + r.id, r));

  const started = (wid: string) =>
    sessions.some((s) => s.workoutId === wid && (s.status === 'active' || hasLoggedWork(s)));

  const tomb = settings.deletedIds || {};
  const deleted = (wid: string, r: AssignmentRow) => {
    const d = tomb[wid];
    return !!d && d >= (Date.parse(r.updated_at || '') || 0);
  };

  let changed = false;
  const out = workouts.slice();
  const byId = new Map<string, Workout>();
  out.forEach((w) => {
    if (w && w.origin === 'coach') byId.set(w.id, w);
  });

  live.forEach((r, wid) => {
    if (deleted(wid, r)) return;
    const cur = byId.get(wid);
    if (!cur) {
      out.push(materializeAssignment(r as Parameters<typeof materializeAssignment>[0]));
      changed = true;
    } else if (!started(wid) && String(cur._rev || '') !== String(r.updated_at || '')) {
      const i = out.indexOf(cur);
      if (i >= 0) {
        out[i] = materializeAssignment(r as Parameters<typeof materializeAssignment>[0]);
        changed = true;
      }
    }
  });

  const kept = out.filter((w) => {
    if (!w || w.origin !== 'coach') return true;
    if (live.has(w.id) || started(w.id)) return true;
    changed = true;
    return false;
  });

  return { workouts: kept, changed };
}

/**
 * What to send up, given what is already there.
 *
 * Coach materialisations are stripped from BOTH sides. They are re-derived from
 * the assignments table on every reconcile, so pushing them would churn the
 * fingerprint forever — and filtering only the local side would leave legacy
 * coach rows festering in the remote blob.
 */
export function buildPushState(local: EngineDB, remoteState: Record<string, unknown>): Record<string, unknown> {
  const rawEx = ((remoteState && remoteState.hybridEngine) || {}) as Partial<EngineDB>;
  const exEngine: EngineDB = {
    workouts: (rawEx.workouts || []).filter((w) => !w || w.origin !== 'coach'),
    sessions: rawEx.sessions || [],
    settings: rawEx.settings || {},
  };
  const localForPush: EngineDB = {
    workouts: local.workouts.filter((w) => !w || w.origin !== 'coach'),
    sessions: local.sessions,
    settings: local.settings,
  };
  return { ...remoteState, hybridEngine: mergeEngines(localForPush, exEngine) };
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

/**
 * The bounded digest a linked coach is allowed to read.
 *
 * Never the whole local blob: no settings, no lexicon, and no raw HR point
 * traces. Ninety days, because a coach looking further back than that is doing
 * something the athlete did not agree to when they accepted the link.
 */
export function coachDigest(db: EngineDB, now = Date.now(), days = 90) {
  const since = now - days * 864e5;
  return {
    generatedAt: now,
    sessions: db.sessions
      .filter((s) => s.status !== 'active' && (s.completedAt || 0) >= since)
      .map((s) => ({
        id: s.id,
        date: s.date,
        name: s.name || '',
        status: s.status,
        completedAt: s.completedAt || 0,
        blocks: s.blocks.map((b) => ({
          heading: b.heading || '',
          kind: b.kind || 'strength',
          exercises: ((b as { exercises?: unknown[] }).exercises || []).map((e) => {
            const ex = e as { name?: string; mode?: string; sets?: { t?: string; rpe?: string; aVal?: string; aVal2?: string; felt?: string; done?: boolean }[] };
            return {
              name: ex.name || '',
              mode: ex.mode || '',
              sets: (ex.sets || []).map((st) => ({
                t: st.t || '',
                rpe: st.rpe || '',
                aVal: st.aVal || '',
                aVal2: st.aVal2 || '',
                felt: st.felt || '',
                done: !!st.done,
              })),
            };
          }),
          // the HR trace itself is deliberately NOT included
          cond: (b as { condResult?: { fmt?: string; effort?: string; dur?: number; felt?: string; zsec?: unknown; hrr?: number | null } }).condResult
            ? {
                fmt: (b as { condResult?: { fmt?: string } }).condResult?.fmt || '',
                effort: (b as { condResult?: { effort?: string } }).condResult?.effort || '',
                dur: (b as { condResult?: { dur?: number } }).condResult?.dur || 0,
                felt: (b as { condResult?: { felt?: string } }).condResult?.felt || '',
                zsec: (b as { condResult?: { zsec?: unknown } }).condResult?.zsec || null,
                hrr: (b as { condResult?: { hrr?: number | null } }).condResult?.hrr ?? null,
              }
            : null,
        })),
      })),
  };
}
