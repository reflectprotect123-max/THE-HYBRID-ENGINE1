import { CON_RETENTION, CON_TRACE_KEEP } from './constants';
import { uid, uniqArr, ymd } from './num';
import { isCond, isText, loggedWorkCount, hasLoggedWork } from './session';
import {
  migrateLegacySettings,
  emptyEcosystemNamespace,
  mergeEcosystemNamespaces,
  mergeSharedCore,
  sanitizeEcosystemNamespace,
  sanitizeSharedCore,
  type EcosystemSyncNamespace,
  type SharedCoreState,
} from '@hybrid/shared-core';
import type {
  Block,
  CondBlock,
  CondResult,
  EngineDB,
  Folder,
  LoggedSet,
  ProgressState,
  Session,
  Settings,
  Workout,
} from './types';

export function emptyDB(): EngineDB {
  return { workouts: [], sessions: [], settings: {} };
}

/**
 * Attach the shared-core namespace to a legacy local DB without removing any
 * old Settings fields. This is intentionally separate from `sanitizeDB`:
 * sanitizeDB must remain a lossless compatibility boundary for older tests,
 * backups and clients, while a current app load opts into the migration.
 */
export function ensureSharedCore(d: EngineDB, now = Date.now()): EngineDB {
  const migratedCore = d.core ? sanitizeSharedCore(d.core) : migrateLegacySettings(d.settings, now);
  const namespace = d.ecosystem
    ? sanitizeEcosystemNamespace(d.ecosystem)
    : emptyEcosystemNamespace(migratedCore);
  const core = mergeSharedCore(migratedCore, namespace.core);
  return { ...d, core, ecosystem: { ...namespace, core } };
}

/**
 * Coerce anything that claims to be an engine DB into one that every read path
 * can survive.
 *
 * This runs on every load, every import, and every session arriving from the
 * network, so it is the app's single trust boundary for shape. It is
 * deliberately forgiving about extra keys and unforgiving about structure.
 */
export function sanitizeDB(d: unknown): EngineDB {
  const src = (d && typeof d === 'object' ? d : {}) as Partial<EngineDB>;
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

  /*
   * A block that is neither text nor conditioning is a LEGACY strength block
   * — real data from before 17 August 2026, when strength (engine, builder,
   * logger) was deleted whole. Nothing left in this codebase can render or
   * run one, so `cleanBlock` drops it here rather than half-coercing it into
   * a `Block` union that no longer has a member shaped like it. This is a
   * read-time filter only: the stored row itself is untouched, so nothing is
   * destroyed — it simply stops appearing to a running app.
   */
  const cleanBlock = (b: unknown): Block<LoggedSet> | null => {
    const bl = (b && typeof b === 'object' ? b : {}) as Block<LoggedSet>;
    if (isText(bl)) {
      delete (bl as { exercises?: unknown }).exercises;
      return bl;
    }
    if (isCond(bl)) {
      // An older blob may carry an empty `exercises` array from before the
      // split; drop it so no read path treats the block as strength work.
      delete (bl as { exercises?: unknown }).exercises;
      return bl;
    }
    return null;
  };

  const cleanBlocks = (v: unknown): Block<LoggedSet>[] =>
    arr<unknown>(v)
      .map(cleanBlock)
      .filter((b): b is Block<LoggedSet> => b !== null);

  // settings is the one hole in this trust boundary: JSON.parse materialises a
  // hostile "__proto__" as an OWN enumerable property, and mergeSettings'
  // Object.assign would then invoke the prototype setter, poisoning
  // deletedIds and wiping every record. Rebuild from own keys, dropping the
  // three keys that can re-home a prototype. Also reject an array.
  const cleanSettings = (s: unknown): Settings => {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return {};
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(s as Record<string, unknown>)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      out[k] = (s as Record<string, unknown>)[k];
    }
    // `conditioning` is read by condEfforts/datedEfforts/pushCondHistory with
    // no per-record guard (unlike insights.ts), so a null/non-object entry —
    // reachable via backup restore in 'replace' mode or a stale local blob —
    // crashes those reads. Drop anything that isn't a real record; this is
    // the same shape mergeSettings already enforces on its own merge path.
    if (Array.isArray(out.conditioning)) {
      out.conditioning = (out.conditioning as unknown[]).filter(
        (r) => r != null && typeof r === 'object' && !Array.isArray(r),
      );
    }
    // Same shape guard as `conditioning` above: only touch it when it IS an
    // array, and require both fields to actually be strings — a folder with a
    // missing/garbage id can never be targeted by workoutsInFolder/removal,
    // and a missing name would render an empty pill with no way to identify it.
    if (Array.isArray(out.folders)) {
      out.folders = (out.folders as unknown[])
        .filter((f): f is Record<string, unknown> => f != null && typeof f === 'object' && !Array.isArray(f))
        .filter((f) => typeof f.id === 'string' && f.id && typeof f.name === 'string')
        .map((f) => ({ id: f.id as string, name: f.name as string }));
    }
    // The coach's exercise library, guarded the same way and for the same
    // reason. `buildCatalogue` maps over it with no per-value check, so a
    // string or an object here — reachable through a backup restore, a hand-
    // edited blob or a bad merge — crashes the picker outright. Only touch it
    // when it IS an array, so ABSENT still means "never set" and `[]` still
    // means an emptied library; those two are not the same and the fallback
    // to mining history turns on the difference.
    if (Array.isArray(out.movements)) {
      out.movements = (out.movements as unknown[])
        .filter((m): m is string => typeof m === 'string' && !!m.trim())
        .map((m) => m.trim());
    } else if (out.movements !== undefined) {
      delete out.movements;
    }
    return out as Settings;
  };

  /*
   * Every id in the incoming array, mapped to whatever `kind` that record
   * stores. `splitMixedWorkout`/`splitMixedSession` derive their sibling's id
   * from the source record's id (see `condSiblingId`) and need to know what is
   * already taken — including siblings minted earlier in this same pass.
   */
  const kindsById = (records: unknown[]): Map<string, string | undefined> => {
    const m = new Map<string, string | undefined>();
    records.forEach((r) => {
      const rec = r as { id?: unknown; kind?: unknown };
      if (!rec || typeof rec !== 'object' || typeof rec.id !== 'string' || !rec.id) return;
      m.set(rec.id, typeof rec.kind === 'string' ? rec.kind : undefined);
    });
    return m;
  };

  const rawWorkouts = arr<unknown>(src.workouts);
  const rawSessions = arr<unknown>(src.sessions);
  const workoutIds = kindsById(rawWorkouts);
  const sessionIds = kindsById(rawSessions);

  /**
   * The id for the conditioning sibling split out of the record `srcId`, or
   * `null` when that sibling already exists and must not be minted twice.
   *
   * DERIVED from the source id rather than minted with `uid()`, because
   * sanitizeDB is not a load-time-only function: `applyPull` (cloud.ts) runs it
   * over the merge result of EVERY pull and `restoreDb` over every imported
   * backup. A random id meant the same legacy record produced a different
   * conditioning workout on every device, every boot and every pull — and since
   * the server keeps its own copy of the un-split original until it is
   * overwritten, those duplicates accumulated without bound. Deriving the id
   * makes re-splitting the ORIGINAL blob produce the very same record, so the
   * duplicate collapses into itself no matter how many times or where it runs.
   */
  const condSiblingId = (srcId: string, taken: Map<string, string | undefined>): string | null => {
    const base = `${srcId}-cond`;
    // Already migrated — this exact sibling is in the blob. (Its conditioning
    // blocks live there, so dropping them from the mixed original below loses
    // nothing.)
    if (taken.get(base) === 'conditioning') return null;
    // Improbable, but an unrelated record could already hold the derived id.
    // Step aside deterministically — the same input must give the same id on
    // every device — rather than emitting two records with one id.
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    taken.set(id, 'conditioning');
    return id;
  };

  /**
   * A workout mixing a conditioning block with strength/text blocks (the old
   * "finisher tacked onto a lift day" pattern) is split into a strength
   * sibling and a conditioning sibling — once, here, rather than carrying an
   * inferred mix forever. A workout already single-kind keeps the `kind` it
   * stores, and has one inferred from its blocks only when it stores none.
   *
   * `kind` is never overwritten: the Planner's per-block ✕ can legitimately
   * empty a conditioning workout, and re-stamping that 'strength' on the next
   * load would strand it — no screen anywhere can set `kind` back. A workout
   * with no blocks AND no stored kind is left with `kind` unset rather than
   * guessed; `isCondWorkout` already reads `undefined` as false and Home and
   * Library both branch on "no blocks" separately.
   */
  const splitMixedWorkout = (w: Workout): Workout[] => {
    const condBlocks = w.blocks.filter(isCond);
    const otherBlocks = w.blocks.filter((b) => !isCond(b));
    if (!condBlocks.length) {
      if (w.kind) return [w];
      return w.blocks.length ? [{ ...w, kind: 'strength' }] : [w];
    }
    if (!otherBlocks.length) return [{ ...w, kind: w.kind ?? 'conditioning' }];
    // The strength sibling keeps the original id, so it is what a still
    // un-migrated copy on the server collides with on the next sync. Its
    // `updatedAt` is bumped — and only on this mixed branch, so a load that
    // splits nothing changes nothing — because pickWorkout gives an exact tie
    // to the remote: without the bump the stale mixed record wins the merge,
    // is re-split, and the server never converges.
    //
    // One tick past the original rather than Date.now(), which is all it takes
    // to outrank the stale copy of the SAME record, and which keeps two things
    // that a wall-clock stamp would break: the output stays a pure function of
    // the input (two devices splitting the same legacy record produce identical
    // records, so neither re-pushes the other's), and a tombstone recorded when
    // the athlete deleted this workout still outranks it — `notTombstoned`
    // compares the deletion time against `updatedAt`, so a Date.now() here would
    // resurrect a deleted workout every time the server served the mixed
    // original back.
    const strength: Workout = { ...w, kind: 'strength', blocks: otherBlocks, updatedAt: (w.updatedAt || 0) + 1 };
    const condId = condSiblingId(w.id, workoutIds);
    if (!condId) return [strength];
    return [
      strength,
      {
        ...w,
        id: condId,
        kind: 'conditioning',
        name: `${w.name || 'Session'} — Conditioning`,
        blocks: condBlocks,
        // `updatedAt` is left as the original's (inherited by the spread)
        // rather than stamped with the clock: this record's content is exactly
        // as old as the block it was split out of, and a clock stamp would both
        // churn the sync fingerprint on every load and outrank the tombstone of
        // an athlete who has already deleted this sibling.
        //
        // Same rule duplicateWorkout follows when it mints a new-id record:
        // `_rev` is sync bookkeeping belonging to the record this was split out
        // of, and `sample` marks seeded demo data. Neither survives a new id.
        _rev: undefined,
        sample: undefined,
      },
    ];
  };

  /** Same reasoning as `splitMixedWorkout`, for a logged Session instead of a
   *  Workout template. */
  const splitMixedSession = (s: Session): Session[] => {
    const condBlocks = s.blocks.filter(isCond);
    const otherBlocks = s.blocks.filter((b) => !isCond(b));
    if (!condBlocks.length) {
      if (s.kind) return [s];
      return s.blocks.length ? [{ ...s, kind: 'strength' }] : [s];
    }
    if (!otherBlocks.length) return [{ ...s, kind: s.kind ?? 'conditioning' }];
    // Both stores treat the active session as a singleton
    // (`sessions.find((s) => s.status === 'active')`), so splitting one in
    // flight hands the athlete back the strength half and strands the
    // conditioning half as a second, unreachable active session. Leave a
    // legacy mixed session alone until it is finished — the split then happens
    // on the next load, when nothing is mid-workout.
    if (s.status === 'active') return [s];
    // One tick past the original, for the same reasons as splitMixedWorkout's
    // strength sibling above.
    const strength: Session = { ...s, kind: 'strength', blocks: otherBlocks, updatedAt: (s.updatedAt || 0) + 1 };
    const condId = condSiblingId(s.id, sessionIds);
    if (!condId) return [strength];
    return [
      strength,
      {
        ...s,
        id: condId,
        kind: 'conditioning',
        blocks: condBlocks,
        // The original workoutId now names the STRENGTH-only sibling. Left in
        // place it makes workoutStats count one training day as two trainings
        // of that workout and files this half's volume-rate under it in
        // insights.ts.
        workoutId: undefined,
      },
    ];
  };

  const core = src.core ? sanitizeSharedCore(src.core) : undefined;
  const ecosystem = src.ecosystem ? sanitizeEcosystemNamespace(src.ecosystem) : undefined;
  return {
    workouts: rawWorkouts.flatMap((w0) => {
      const w = (w0 && typeof w0 === 'object' ? w0 : {}) as Workout;
      w.blocks = cleanBlocks(w.blocks);
      if (!w.id) w.id = uid();
      if ('days' in w) w.days = arr<number>(w.days).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
      if ('dates' in w) w.dates = arr<string>(w.dates).filter((k) => typeof k === 'string');
      if ('folderIds' in w) w.folderIds = arr<string>(w.folderIds).filter((id) => typeof id === 'string' && id);
      return splitMixedWorkout(w);
    }),
    sessions: rawSessions.flatMap((s0) => {
      const s = (s0 && typeof s0 === 'object' ? s0 : {}) as Session;
      s.blocks = cleanBlocks(s.blocks);
      if (!s.id) s.id = uid();
      return splitMixedSession(s);
    }),
    settings: cleanSettings(src.settings),
    ...(core ? { core } : {}),
    ...(ecosystem ? { ecosystem } : {}),
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
    folderIds: uniqArr((x.folderIds || []).concat(y.folderIds || [])),
  });
}

/**
 * Which copy of a session to keep. Logged work outranks a timestamp: a session
 * with sets recorded on it always beats an empty one, however recently the
 * empty one was touched. Only when both carry the same amount of work does
 * recency decide — `updatedAt` when present, falling back to
 * completedAt/startedAt for the many sessions that only ever carry those.
 */
export function pickSession(x: Session, y: Session): Session {
  const nx = loggedWorkCount(x);
  const ny = loggedWorkCount(y);
  if (ny !== nx) return ny > nx ? y : x;
  const recency = (s: Session) => s.updatedAt || s.completedAt || s.startedAt || 0;
  return recency(y) >= recency(x) ? y : x;
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

  // The mobility list is a UNION, not winner-wins. Adding a stretch on the
  // phone and another on the web are both real edits, and Object.assign would
  // silently drop whichever side lost.
  if (base.mobility || winner.mobility) {
    const seen = new Set<string>();
    out.mobility = [...(base.mobility || []), ...(winner.mobility || [])].filter((m) => {
      const k = String(m || '').trim().toLowerCase();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  // The coach's exercise library is a UNION too, and for exactly the reason
  // `mobility` above is: adding a movement on the bench and another on the
  // phone are both real edits, and `Object.assign` drops whichever side loses.
  // Found in review on 16 August 2026, before the field had shipped — the
  // owner had just asked for the derived library emptied so he could rebuild
  // it by hand, so silently dropping half of what he typed would have been the
  // worst possible bug in the worst possible place.
  //
  // Case-insensitive, matching `addMovement` and `buildCatalogue`: two entries
  // disagreeing over "Back Squat" and "back squat" are worse than either.
  if (base.movements || winner.movements) {
    const seen = new Set<string>();
    out.movements = [...(base.movements || []), ...(winner.movements || [])].filter((m) => {
      const k = String(m || '').trim().toLowerCase();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

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

  /* `liftProgress` (earned working weights) merge was deleted whole on
     17 August 2026 — the field no longer exists on `Settings`. */

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

  // Folders: union by id, same reasoning as mobility above — creating a
  // folder on two devices before either syncs are both real edits. But a
  // folder whose id is tombstoned in the MERGED deletedIds map (just computed
  // above) must not be revived by a stale copy the other side still carries
  // — the same protection workouts and sessions already get via
  // `notTombstoned`, applied here to a Settings-level list instead of an
  // EngineDB-level array.
  const bf = base.folders || [];
  const wf = winner.folders || [];
  if (bf.length || wf.length) {
    const byId = new Map<string, Folder>();
    bf.forEach((f) => f && f.id && byId.set(f.id, f));
    wf.forEach((f) => f && f.id && byId.set(f.id, f)); // winner's copy wins an id present on both sides
    const tomb = out.deletedIds || {};
    out.folders = Array.from(byId.values()).filter((f) => !tomb[f.id]);
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

/**
 * Record that a record is deleted, so the deletion SURVIVES a merge.
 *
 * Removing a record from the array is only half of a delete. The merge is
 * additive, so the other device still holds it and hands it straight back on
 * the next sync — the deletion is the thing that gets lost, not the record.
 * `notTombstoned` is what suppresses it, and it reads this map.
 *
 * Exported because eight call sites were hand-rolling the same two lines and
 * the three on the coach surface did not: a workout deleted from the bench
 * came back from the phone. One helper, so the next caller cannot forget.
 */
export function tombstone(db: { settings: Settings }, id: string, now: number = Date.now()): void {
  db.settings.deletedIds = { ...(db.settings.deletedIds || {}), [id]: now };
}

/** Local scalar edits win; additive fields are unioned; tombstones are applied. */
export function mergeEngines(local: EngineDB, remote: EngineDB): EngineDB {
  const settings = mergeSettings(remote.settings || {}, local.settings || {});
  const t = settings.deletedIds || {};
  const workouts = mergeById(local.workouts, remote.workouts, pickWorkout).filter(notTombstoned<Workout>(t));
  const sessions = mergeById(local.sessions, remote.sessions, pickSession).filter(notTombstoned<Session>(t));
  const core: SharedCoreState | undefined = local.core || remote.core
    ? mergeSharedCore(remote.core, local.core)
    : undefined;
  const ecosystem: EcosystemSyncNamespace | undefined = local.ecosystem || remote.ecosystem
    ? mergeEcosystemNamespaces(remote.ecosystem, local.ecosystem)
    : undefined;
  return {
    workouts,
    sessions,
    settings,
    ...(core ? { core } : {}),
    ...(ecosystem ? { ecosystem } : {}),
  };
}

/**
 * A fingerprint of what is worth pushing.
 *
 * `whoopDaily` and `devices` are excluded because they are device-local and
 * re-derived, and would otherwise churn the fingerprint on every WHOOP sample.
 */
export function cloudFp(engine: EngineDB): string {
  try {
    const st: Settings = Object.assign({}, engine.settings || {});
    delete st.whoopDaily;
    delete st.devices;
    return JSON.stringify({
      w: engine.workouts || [],
      s: engine.sessions || [],
      st,
      core: engine.core || null,
      ecosystem: engine.ecosystem || null,
    });
  } catch {
    return 'fp-' + Math.random();
  }
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

/** Inline HR/GPS traces are ~78% of the serialised blob; unbounded, they cross
 *  the localStorage quota and then EVERY save fails forever. Keep the maps on
 *  recent runs (Recap/History still draw them) and strip them from older ones —
 *  the zone SECONDS that drive progression stay, only the point arrays go. */
export function pruneCondTraces(
  sessions: Session[],
  keep = CON_TRACE_KEEP,
): { sessions: Session[]; changed: boolean } {
  const withCond = sessions
    .map((s, i) => ({
      i,
      at: s.completedAt || s.startedAt || 0,
      has: (s.blocks || []).some((b) => isCond(b) && !!(b as CondBlock).condResult),
    }))
    .filter((x) => x.has)
    .sort((a, b) => b.at - a.at);
  const spare = new Set(withCond.slice(0, keep).map((x) => x.i));
  let changed = false;
  const out = sessions.map((s, i) => {
    if (spare.has(i)) return s;
    let touched = false;
    const blocks = (s.blocks || []).map((b) => {
      if (isCond(b) && (b as CondBlock).condResult) {
        const r = (b as CondBlock).condResult!;
        if (r.trace || (r as { route?: unknown }).route) {
          touched = true;
          const { trace: _t, route: _r, ...rest } = r as CondResult & { route?: unknown };
          return { ...b, condResult: rest };
        }
      }
      return b;
    });
    if (!touched) return s;
    changed = true;
    return { ...s, blocks };
  });
  return { sessions: out, changed };
}

export interface RestoreReport {
  workouts: number;
  sessions: number;
  /**
   * Records already present that the incoming file did not add — counted as
   * what SURVIVED, id by id, not inferred from how the totals moved.
   *
   * The arithmetic version (`before + incoming − after`) quietly assumed the
   * merge only ever grows: every record it dropped shrank `after` and so
   * inflated `kept` by one. A workout deleted on another device arrives in the
   * backup, `notTombstoned` correctly purges it, and the report called that
   * purge a keep — restoring a file with nothing left in it reported one record
   * kept out of a database holding zero.
   */
  kept: number;
  mode: 'merge' | 'replace';
}

/**
 * Read a backup back in.
 *
 * Settings has offered "Export a backup" since the sync work, and says
 * "export a backup before you train again" when a save fails — while offering
 * no way on earth to load one. The safety net only had one end. This is the
 * other end, and it is also the road any historical import travels: convert an
 * export from wherever into this same shape and it arrives through one
 * reviewed, tested path rather than a bespoke one per source.
 *
 * `merge` is the default and the safe one. It runs the same record-level merge
 * the cloud sync uses, so a restore cannot silently drop a session logged since
 * the backup was taken, and tombstones still win — restoring an old file must
 * not resurrect a workout deliberately deleted afterwards.
 *
 * `replace` exists because merge cannot express "this file is the truth, throw
 * away what is here" — the case after a corrupt local store. It is destructive
 * and the caller is responsible for confirming it.
 *
 * Throws on anything that is not an object with at least one of the three
 * top-level keys. `sanitizeDB` would happily turn a photo of a cat into an
 * empty database, and an import that silently produces nothing is worse than
 * one that says the file is wrong.
 */
export function restoreDb(
  current: EngineDB,
  raw: unknown,
  mode: 'merge' | 'replace' = 'merge',
): { db: EngineDB; report: RestoreReport } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('That file is not a backup — expected a JSON object.');
  }
  const keys = raw as Record<string, unknown>;
  if (!('workouts' in keys) && !('sessions' in keys) && !('settings' in keys)) {
    throw new Error('That file has no workouts, sessions or settings in it.');
  }

  const incoming = sanitizeDB(raw);
  // mergeEngines(local, remote): the incoming file is `remote`, so a record
  // present in both is resolved by the same updatedAt rule sync already uses
  // rather than by which side happened to be the file.
  const db = mode === 'replace' ? incoming : mergeEngines(current, incoming);

  // Namespaced because a workout and a session are different records even if
  // some ancient export gave them the same id.
  const ids = (e: EngineDB) =>
    (e.workouts || []).map((w) => 'w:' + w.id).concat((e.sessions || []).map((s) => 's:' + s.id));
  const had = new Set(ids(current));
  // Present before AND still present after: the only records that were truly
  // kept. Anything `notTombstoned` purged is absent from `db` and so counts for
  // nothing, which is the whole correction.
  const kept = ids(db).filter((k) => had.has(k)).length;

  return {
    db,
    report: {
      workouts: db.workouts.length,
      sessions: db.sessions.length,
      // `replace` is defined as "throw away what is here", so nothing it leaves
      // standing was kept from the old database — it all came from the file.
      kept: mode === 'replace' ? 0 : kept,
      mode,
    },
  };
}
