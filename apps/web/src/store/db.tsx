import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  LS_KEY,
  emptyDB,
  ensureSharedCore,
  expireStaleSessions,
  loadDB,
  pruneCondTraces,
  restrictToProduct,
  saveDB,
  sessionRpe,
  type EngineDB,
  type HrContext,
  type Session,
  type Settings,
  type WhoopSample,
  type Workout,
} from '@hybrid/engine';
import { deriveAthleteState, summarizeTrainingFacts, type AthleteStateSnapshot, type TrainingFact } from '@hybrid/whole-athlete-state';
import { buildWeeklyPlan, type WeeklyPlan } from '@hybrid/coordinator-adapter';
import type { ProductId } from '@hybrid/product-scope';
import { splitActiveSession, useDiscipline } from '../discipline';

/*
 * The single owner of engine state.
 *
 * The vanilla app kept `DB` as a module global and called `save()` from ~40
 * places, which is why an unsaved mutation was such an easy bug to write. Here
 * every write goes through `update()`, which mutates a draft, persists, and
 * re-renders — so "changed but not saved" is not a state you can reach.
 *
 * Persistence is synchronous on purpose. The athlete confirms a set and may
 * immediately background the app; an async write is a lost set.
 */

/*
 * Discipline scoping, and the one rule that matters.
 *
 * READS are scoped: `workouts`, `sessions` and `activeSession` show only the
 * discipline the athlete is currently in, so a strength week and a
 * conditioning week never share a screen.
 *
 * WRITES are not, and `db` stays whole. This is the same lesson the mobile
 * sync partition paid for twice (see apps/mobile/src/cloud/sync.tsx): the
 * moment a filtered view becomes the thing you write back, the records the
 * filter excluded are invisible to the merge and get dropped. `update` and
 * `updateSession` therefore still operate on the complete database, and the
 * Coordinator and whole-athlete-state below still read every session — they
 * are the layers whose whole job is seeing both disciplines at once, and
 * scoping them is what would actually let a heavy squat land the day before
 * hard intervals.
 */
interface DbCtx {
  /** The COMPLETE database. Writes, Coordinator and athlete state use this. */
  db: EngineDB;
  /** The discipline currently on screen. */
  discipline: ProductId;
  /** Mutate a draft copy. Returning false aborts the write. */
  update: (fn: (draft: EngineDB) => void | false, opts?: { silent?: boolean }) => void;
  /** Mutate ONE session, cloning only that session — the hot path for typing a
   *  weight. Same abort contract as `update`. Mirrors the mobile store. */
  updateSession: (id: string, fn: (s: Session) => void | false) => void;
  saveFailed: boolean;
  /** true when the stored data was unreadable at boot and this DB is a fresh,
   *  empty fallback rather than what the athlete actually had. */
  dataRecovered: boolean;
  whoop: WhoopSample | null;
  setWhoop: (w: WhoopSample | null) => void;
  /** Everything the HR model needs, assembled from profile + live sample. */
  hr: HrContext;
  /** Live session IN the current discipline. */
  activeSession: Session | null;
  /**
   * A live session in the OTHER discipline, if one exists.
   *
   * Scoping `activeSession` without surfacing this would strand it: the
   * athlete switches tab mid-session, the session vanishes from every screen,
   * and `expireStaleSessions` eventually ends it at the next day boundary
   * without them ever seeing it again. Separation is a view rule, not a
   * licence to lose logged work.
   */
  foreignActiveSession: Session | null;
  /** Scoped to the current discipline. */
  workouts: Workout[];
  /** Scoped to the current discipline. */
  sessions: Session[];
  settings: Settings;
  athleteState: AthleteStateSnapshot;
  weeklyPlan: WeeklyPlan;
}

const Ctx = createContext<DbCtx | null>(null);

const webStorage = {
  getItem: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem: (k: string, v: string) => {
    localStorage.setItem(k, v);
  },
  removeItem: (k: string) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* private mode; nothing to do */
    }
  },
};

export function DbProvider({ children }: { children: ReactNode }) {
  // Written by the `db` lazy initializer below, on the same render, before
  // this is read — the two useState calls run in declaration order on mount.
  const recoveredAtBoot = useRef(false);
  const [db, setDb] = useState<EngineDB>(() => {
    const { db: loaded, recovered } = loadDB(webStorage, LS_KEY);
    recoveredAtBoot.current = recovered;
    // An abandoned session from a past day would otherwise keep presenting
    // itself as today's live session forever.
    const { sessions, changed } = expireStaleSessions(loaded.sessions);
    if (changed) {
      loaded.sessions = sessions;
      saveDB(webStorage, loaded, LS_KEY);
    }
    // Inline HR/GPS traces are unbounded otherwise and eventually cross the
    // localStorage quota, after which every save fails forever.
    const { sessions: pruned, changed: ch2 } = pruneCondTraces(loaded.sessions);
    if (ch2) {
      loaded.sessions = pruned;
      saveDB(webStorage, loaded, LS_KEY);
    }
    return loaded;
  });
  const [dataRecovered] = useState(() => recoveredAtBoot.current);
  const [saveFailed, setSaveFailed] = useState(false);
  const [whoop, setWhoop] = useState<WhoopSample | null>(null);

  // Held in a ref as well as state so `update` can read the latest DB without
  // being re-created on every change — otherwise every callback downstream
  // would churn its identity on each keystroke in the logger.
  const ref = useRef(db);
  ref.current = db;

  const update = useCallback<DbCtx['update']>((fn, opts) => {
    let draft: EngineDB = structuredClone(ref.current);
    if (fn(draft) === false) return;
    ref.current = draft;
    setDb(draft);
    if (!opts?.silent) {
      let ok = saveDB(webStorage, draft, LS_KEY);
      if (!ok) {
        // Quota is usually the unbounded HR/GPS trace history, not this
        // session's own data — prune old ones and retry once before giving up.
        const { sessions: pr, changed } = pruneCondTraces(draft.sessions);
        if (changed) {
          draft = { ...draft, sessions: pr };
          ref.current = draft;
          setDb(draft);
          ok = saveDB(webStorage, draft, LS_KEY);
        }
      }
      setSaveFailed(!ok);
    }
  }, []);

  /*
   * The same immutability guarantee for a fraction of the work: every session
   * except the edited one is carried across by reference, so React still sees
   * a new `db` and a new `sessions` array, but only ~2KB is copied instead of
   * the whole history. At 300 sessions the full-database clone was ~228ms per
   * keystroke; this does not grow at all.
   */
  const updateSession = useCallback<DbCtx['updateSession']>((id, fn) => {
    const cur = ref.current;
    const i = cur.sessions.findIndex((x) => x.id === id);
    if (i < 0) return;
    const copy: Session = structuredClone(cur.sessions[i]);
    if (fn(copy) === false) return;
    const sessions = cur.sessions.slice();
    sessions[i] = copy;
    let next: EngineDB = { ...cur, sessions };
    ref.current = next;
    setDb(next);
    let ok = saveDB(webStorage, next, LS_KEY);
    if (!ok) {
      const { sessions: pr, changed } = pruneCondTraces(next.sessions);
      if (changed) {
        next = { ...next, sessions: pr };
        ref.current = next;
        setDb(next);
        ok = saveDB(webStorage, next, LS_KEY);
      }
    }
    setSaveFailed(!ok);
  }, []);

  /* Another tab logging a set is the same athlete on the same data. Pick up
     its write rather than silently diverging until one tab overwrites the
     other. */
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== LS_KEY || !e.newValue) return;
      const { db: fresh } = loadDB(webStorage, LS_KEY);
      ref.current = fresh;
      setDb(fresh);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const discipline = useDiscipline();

  const value = useMemo<DbCtx>(() => {
    const live = db.sessions.find((s) => s.status === 'active') || null;
    const { activeSession, foreignActiveSession } = splitActiveSession(live, discipline);
    // The scoped view. Derived from the full db every time rather than stored,
    // so there is exactly one source of truth and no second copy to desync.
    const scoped = restrictToProduct(db, discipline);
    const core = db.core || ensureSharedCore(db).core!;
    const facts: TrainingFact[] = db.sessions
      .filter((s) => s.status !== 'active' && !!s.completedAt)
      .map((s) => {
        const rpe = sessionRpe(s);
        return {
          completedAt: s.completedAt as number,
          domain: s.kind,
          hard: (rpe.felt ?? rpe.target ?? 0) >= 8,
        };
      });
    const today = new Date().toISOString().slice(0, 10);
    const athleteState = deriveAthleteState({
      core,
      today,
      recentTraining: summarizeTrainingFacts(facts),
    });
    const weeklyPlan = buildWeeklyPlan(db, athleteState, today);
    return {
      db,
      discipline,
      update,
      updateSession,
      saveFailed,
      dataRecovered,
      whoop,
      setWhoop,
      hr: { profile: db.settings.profile, whoop },
      activeSession,
      foreignActiveSession,
      workouts: scoped.workouts,
      sessions: scoped.sessions,
      settings: db.settings,
      athleteState,
      weeklyPlan,
    };
  }, [db, discipline, update, updateSession, saveFailed, dataRecovered, whoop]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDb(): DbCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useDb outside DbProvider');
  return c;
}

export { emptyDB };
