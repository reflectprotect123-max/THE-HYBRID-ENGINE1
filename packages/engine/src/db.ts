import { CON_RETENTION, MODES } from './constants';
import { uid, uniqArr, ymd } from './num';
import { isCond, newEx, newSet, sessionScore, hasLoggedWork } from './session';
import type {
  Block,
  EngineDB,
  Exercise,
  LiftState,
  LoggedSet,
  ProgressState,
  Session,
  Settings,
  StrengthBlock,
  Workout,
} from './types';

export function emptyDB(): EngineDB {
  return { workouts: [], sessions: [], settings: {} };
}

/**
 * Coerce anything that claims to be an engine DB into one that every read path
 * can survive.
 *
 * This runs on every load, every import, and every coach-authored session
 * arriving from the network, so it is the app's single trust boundary for
 * shape. It is deliberately forgiving about extra keys — per-record fields like
 * `origin` and `assignmentId` must survive — and unforgiving about structure.
 */
export function sanitizeDB(d: unknown): EngineDB {
  const src = (d && typeof d === 'object' ? d : {}) as Partial<EngineDB>;
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

  const cleanEx = (e: unknown): Exercise<LoggedSet> => {
    const ex = (e && typeof e === 'object' ? e : {}) as Exercise<LoggedSet>;
    ex.sets = arr<LoggedSet>(ex.sets).map((s) => (s && typeof s === 'object' ? s : ({} as LoggedSet)));
    if (!ex.sets.length) ex.sets = [newSet() as LoggedSet];
    ex.mode = MODES[ex.mode] ? ex.mode : 'reps_kg';
    return ex;
  };

  const cleanBlock = (b: unknown): Block<LoggedSet> => {
    const bl = (b && typeof b === 'object' ? b : {}) as Block<LoggedSet>;
    if (isCond(bl)) {
      // A conditioning block has no exercises. An older blob may carry an empty
      // array from before the split; drop it so no read path treats the block
      // as strength work with zero movements.
      delete (bl as { exercises?: unknown }).exercises;
      return bl;
    }
    const sb = bl as StrengthBlock<LoggedSet>;
    sb.exercises = arr<unknown>(sb.exercises).map(cleanEx);
    if (!sb.exercises.length) sb.exercises = [newEx() as Exercise<LoggedSet>];
    return sb;
  };

  const cleanBlocks = (v: unknown): Block<LoggedSet>[] => arr<unknown>(v).map(cleanBlock);

  return {
    workouts: arr<unknown>(src.workouts).map((w0) => {
      const w = (w0 && typeof w0 === 'object' ? w0 : {}) as Workout;
      w.blocks = cleanBlocks(w.blocks);
      if (!w.id) w.id = uid();
      if ('days' in w) w.days = arr<number>(w.days).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
      if ('dates' in w) w.dates = arr<string>(w.dates).filter((k) => typeof k === 'string');
      return w;
    }),
    sessions: arr<unknown>(src.sessions).map((s0) => {
      const s = (s0 && typeof s0 === 'object' ? s0 : {}) as Session;
      s.blocks = cleanBlocks(s.blocks);
      if (!s.id) s.id = uid();
      return s;
    }),
    settings: (src.settings && typeof src.settings === 'object' ? src.settings : {}) as Settings,
  };
}

/* ---------- record-level cloud merge ----------
   Workouts and sessions merge BY ID rather than last-write-wins, so two
   devices can schedule and log between syncs without either side losing data.
   dates/days are unioned (additive — never drop a scheduled day); name and
   blocks take the side with the newer per-record updatedAt; deletions are
   honoured via tombstones so a merge cannot resurrect something you deleted. */

function mergeById<T extends { id?: string }>(a: T[], b: T[], pick: (x: T, y: T) => T): T[] {
  const map = new Map<string, T>();
  (a || []).forEach((x) => {
    if (x && x.id) map.set(x.id, x);
  });
  (b || []).forEach((y) => {
    if (!y || !y.id) return;
    const x = map.get(y.id);
    map.set(y.id, x ? pick(x, y) : y);
  });
  return Array.from(map.values());
}

function notTombstoned<T extends { id?: string; updatedAt?: number }>(t: Record<string, number>) {
  const tomb = t || {};
  return (x: T) => {
    const d = tomb[(x && x.id) as string];
    return !(d && d >= (x.updatedAt || 0));
  };
}

export function pickWorkout(x: Workout, y: Workout): Workout {
  const newer = (y.updatedAt || 0) >= (x.updatedAt || 0) ? y : x;
  return Object.assign({}, newer, {
    days: uniqArr((x.days || []).concat(y.days || [])).sort((m, n) => m - n),
    dates: uniqArr((x.dates || []).concat(y.dates || [])).sort(),
  });
}

/**
 * Which copy of a session to keep. Logged work outranks a timestamp: a session
 * with sets recorded on it always beats an empty one, however recently the
 * empty one was touched. Only when both carry the same amount of work does
 * `updatedAt` decide.
 */
export function pickSession(x: Session, y: Session): Session {
  const sx = sessionScore(x);
  const sy = sessionScore(y);
  if (sy !== sx) return sy > sx ? y : x;
  return (y.updatedAt || 0) >= (x.updatedAt || 0) ? y : x;
}

/**
 * Merge two settings blobs without losing additive data.
 *
 * `winner` (second arg) takes scalar fields — profile, flags — so callers pass
 * the newer/local side there depending on sync direction. Everything additive
 * is unioned instead.
 */
export function mergeSettings(base: Settings = {}, winner: Settings = {}): Settings {
  const out: Settings = Object.assign({}, base, winner);

  // Earned progression: take the higher level, but the HIGHER miss count too.
  // Taking `miss` from whichever side won on level meant two devices could each
  // bank a miss and neither deload ever fired — progression only ratcheted up.
  const bp = base.conProgress || {};
  const wp = winner.conProgress || {};
  const pk = new Set([...Object.keys(bp), ...Object.keys(wp)]);
  if (pk.size) {
    const cp: Record<string, ProgressState> = {};
    pk.forEach((k) => {
      const a = (bp[k] && bp[k].level | 0) || 0;
      const b = (wp[k] && wp[k].level | 0) || 0;
      const am = (bp[k] && bp[k].miss | 0) || 0;
      const bm = (wp[k] && wp[k].miss | 0) || 0;
      cp[k] = Object.assign({}, (b >= a ? wp[k] : bp[k]) || {}, {
        level: Math.max(a, b),
        miss: Math.max(am, bm),
      });
    });
    out.conProgress = cp;
  }

  // Earned working weights: NEWEST wins per lift, by the `at` the session that
  // earned it finished.
  //
  // This looks inconsistent with the max-wins rule directly above and is not.
  // `conProgress.level` only ever climbs a ladder, so taking the higher side is
  // safe. A working weight must be able to go DOWN — a set that missed its rep
  // floor, or a deload — and max-wins would ratchet it up forever, so the one
  // outcome the athlete most needs to survive a sync is the one it would eat.
  const bl2 = base.liftProgress || {};
  const wl2 = winner.liftProgress || {};
  const lk = new Set([...Object.keys(bl2), ...Object.keys(wl2)]);
  if (lk.size) {
    const lp: Record<string, LiftState> = {};
    lk.forEach((k) => {
      const a = bl2[k];
      const b = wl2[k];
      if (!a) {
        if (b) lp[k] = b;
        return;
      }
      if (!b) {
        lp[k] = a;
        return;
      }
      // `winner` takes an exact tie, matching how every scalar above resolves.
      lp[k] = (b.at || 0) >= (a.at || 0) ? b : a;
    });
    out.liftProgress = lp;
  }

  // Conditioning history: union by id, but MERGE each record rather than taking
  // whichever side was seen first. A rating added locally to a record the
  // server already knew about used to be discarded, because `base` won ties.
  const bc = Array.isArray(base.conditioning) ? base.conditioning : [];
  const wc = Array.isArray(winner.conditioning) ? winner.conditioning : [];
  if (bc.length || wc.length) {
    const by = new Map<string, (typeof bc)[number]>();
    bc.concat(wc).forEach((r) => {
      if (!r || !r.id) return;
      const prev = by.get(r.id);
      by.set(r.id, prev ? Object.assign({}, prev, r) : r);
    });
    const m = Array.from(by.values());
    m.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
    out.conditioning = m.slice(-CON_RETENTION);
  }

  // The importer's learned shorthand. This package has no importer — `app.js`
  // at the repo root does, and it syncs into the same blob — so the field is
  // foreign data that has to be UNIONED and not taken from a side. Letting a
  // winner clobber it would both discard what the other client learned and
  // leave two devices swapping the field back and forth on every sync, each
  // push changing the fingerprint the other one just settled on.
  const bl = base.lexicon || {};
  const wl = winner.lexicon || {};
  if (bl.kw || bl.ex || wl.kw || wl.ex) {
    out.lexicon = { kw: Object.assign({}, bl.kw, wl.kw), ex: Object.assign({}, bl.ex, wl.ex) };
  }

  // Tombstones: union keeping the newest timestamp per id, capped at 300.
  const bd = base.deletedIds || {};
  const wd = winner.deletedIds || {};
  const dk = Object.keys(bd).concat(Object.keys(wd));
  if (dk.length) {
    const dd: Record<string, number> = {};
    dk.forEach((k) => {
      dd[k] = Math.max(bd[k] || 0, wd[k] || 0);
    });
    const ks = Object.keys(dd);
    if (ks.length > 300) {
      ks.sort((a, b) => dd[a] - dd[b])
        .slice(0, ks.length - 300)
        .forEach((k) => delete dd[k]);
    }
    out.deletedIds = dd;
  }

  const bv = base.devices || {};
  const wv = winner.devices || {};
  const vk = Object.keys(bv).concat(Object.keys(wv));
  if (vk.length) {
    const vv: Record<string, { seen?: number; name?: string }> = {};
    Array.from(new Set(vk)).forEach((k) => {
      const a = bv[k] || {};
      const b = wv[k] || {};
      vv[k] = (b.seen || 0) >= (a.seen || 0) ? b : a;
    });
    out.devices = vv;
  }

  return out;
}

/** Local scalar edits win; additive fields are unioned; tombstones are applied. */
export function mergeEngines(local: EngineDB, remote: EngineDB): EngineDB {
  const settings = mergeSettings(remote.settings || {}, local.settings || {});
  const t = settings.deletedIds || {};
  const workouts = mergeById(local.workouts, remote.workouts, pickWorkout).filter(notTombstoned<Workout>(t));
  const sessions = mergeById(local.sessions, remote.sessions, pickSession).filter(notTombstoned<Session>(t));
  return { workouts, sessions, settings };
}

/**
 * A fingerprint of what is worth pushing.
 *
 * `whoopDaily` and `devices` are excluded because they are device-local and
 * re-derived, and would otherwise churn the fingerprint on every WHOOP sample.
 * Coach-assigned workouts are excluded because they are local materialisations
 * of the authoritative assignments table — pushing them would poison shared
 * state and churn sync forever.
 */
export function cloudFp(engine: EngineDB): string {
  try {
    const st: Settings = Object.assign({}, engine.settings || {});
    delete st.whoopDaily;
    delete st.devices;
    const w = (engine.workouts || []).filter((x) => !x || x.origin !== 'coach');
    return JSON.stringify({ w, s: engine.sessions || [], st });
  } catch {
    return 'fp-' + Math.random();
  }
}

/**
 * Turn a coach assignment row into a local workout. The id is namespaced so it
 * can never collide with a locally created one, and `origin: 'coach'` keeps it
 * out of the sync fingerprint.
 */
export function materializeAssignment(r: {
  id: string;
  session_snapshot?: unknown;
  scheduled_date?: string | null;
  updated_at?: string;
}): Workout {
  const snap = (r.session_snapshot && typeof r.session_snapshot === 'object' ? r.session_snapshot : {}) as Partial<Workout>;
  const w = Object.assign({}, snap, {
    id: 'coach:' + r.id,
    origin: 'coach' as const,
    assignmentId: r.id,
    _rev: r.updated_at || '',
    dates: r.scheduled_date ? [r.scheduled_date] : Array.isArray(snap.dates) ? snap.dates : [],
  });
  return sanitizeDB({ workouts: [w], sessions: [], settings: {} }).workouts[0];
}

/**
 * An abandoned session from a past day is either promoted to `incomplete` (if
 * anything was actually logged) or dropped. Left alone, it would keep showing
 * as today's live session forever.
 */
export function expireStaleSessions(
  sessions: Session[],
  today = ymd(new Date()),
  now = Date.now(),
): { sessions: Session[]; changed: boolean } {
  let changed = false;
  const out = sessions.filter((s) => {
    if (s.status !== 'active' || s.date >= today) return true;
    changed = true;
    if (hasLoggedWork(s)) {
      s.status = 'incomplete';
      s.completedAt = s.completedAt || s.startedAt || now;
      return true;
    }
    return false;
  });
  return { sessions: out, changed };
}
