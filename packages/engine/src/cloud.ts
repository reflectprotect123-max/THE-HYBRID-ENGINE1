import { cloudFp, materializeAssignment, mergeEngines, sanitizeDB } from './db';
import { blockExercises, hasLoggedWork, isCond, sessionRpe, sessionVolume } from './session';
import { ymd } from './num';
import type { CondResult, EngineDB, Session, Settings, Workout } from './types';

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
 * THE SHAPE HERE IS A CONTRACT with the coach dashboard, which reads
 * `payload.sessions[].{volumeKg,setsDone,setsTotal,exercises}`,
 * `payload.conditioning[]` and `payload.whoop[]`. Emit anything else and an
 * athlete's whole week renders as "0 sessions / NaN kg" on the coach's screen
 * — the coach site does not error, it just quietly shows nothing.
 *
 * Never the whole local blob: no settings, no lexicon, and no HR point traces.
 * Ninety days, because a coach looking further back than that is doing
 * something the athlete did not agree to when they accepted the link. `sim`
 * survives deliberately — without it a coach cannot tell a demo run from a
 * real session.
 *
 * Windowed on `date`, NOT `completedAt`: a session left unfinished has a date
 * but may have no completion timestamp, and dropping those would hide exactly
 * the sessions a coach most wants to ask about.
 */
export function coachDigest(db: EngineDB, now = Date.now(), days = 90) {
  const cut = ymd(new Date(now - days * 864e5));
  const cutMs = now - days * 864e5;

  const sessions = db.sessions
    .filter((s) => s.status !== 'active' && s.date && s.date >= cut)
    .map((s) => {
      let done = 0;
      let tot = 0;
      (s.blocks || []).forEach((b) =>
        blockExercises(b).forEach((e) =>
          (e.sets || []).forEach((st) => {
            tot += 1;
            if (st.done) done += 1;
          }),
        ),
      );
      const r = sessionRpe(s);
      return {
        id: s.id,
        date: s.date,
        name: s.name || 'Session',
        status: s.status,
        volumeKg: sessionVolume(s),
        setsDone: done,
        setsTotal: tot,
        rpeTarget: r.target,
        rpeFelt: r.felt,
        minutes: s.completedAt && s.startedAt ? Math.round((s.completedAt - s.startedAt) / 6e4) : null,
        exercises: (s.blocks || [])
          .flatMap((b) => blockExercises(b).map((e) => e.name).filter(Boolean))
          .slice(0, 12),
      };
    })
    .slice(-120);

  /* The full point trace is deliberately dropped — it is large and adds
     nothing to a review view. */
  const slim = (r: CondResult) => ({
    id: r.id,
    date: (r as { date?: string }).date ?? (r.startedAt ? ymd(new Date(r.startedAt)) : undefined),
    fmt: r.fmt,
    dur: r.dur,
    avg: (r as { avg?: number }).avg,
    max: (r as { max?: number }).max,
    hrr: r.hrr,
    zsec: r.zsec,
    effort: r.effort,
    targetRpe: r.targetRpe ?? undefined,
    felt: r.felt || undefined,
    sim: r.sim || undefined,
  });

  const cond: ReturnType<typeof slim>[] = (
    Array.isArray(db.settings.conditioning) ? db.settings.conditioning : []
  )
    .filter((r) => r && (r.startedAt || 0) >= cutMs)
    .map(slim);
  db.sessions.forEach((s) => {
    if (s.date >= cut) {
      (s.blocks || []).forEach((b) => {
        if (isCond(b) && b.condResult) cond.push(slim(b.condResult));
      });
    }
  });

  const whoop = (
    Array.isArray(db.settings.whoopDaily)
      ? (db.settings.whoopDaily as { date: string; recovery: number | null; strain: number | null }[])
      : []
  ).filter((h) => h && h.date >= cut);

  return { v: 1, updatedAt: now, sessions, conditioning: cond.slice(-120), whoop };
}
