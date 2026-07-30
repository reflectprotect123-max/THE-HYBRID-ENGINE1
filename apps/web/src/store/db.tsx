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
  expireStaleSessions,
  loadDB,
  pruneCondTraces,
  saveDB,
  type EngineDB,
  type HrContext,
  type Session,
  type Settings,
  type WhoopSample,
  type Workout,
} from '@hybrid/engine';

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

interface DbCtx {
  db: EngineDB;
  /** Mutate a draft copy. Returning false aborts the write. */
  update: (fn: (draft: EngineDB) => void | false, opts?: { silent?: boolean }) => void;
  /** Mutate ONE session, cloning only that session — the hot path for typing a
   *  weight. Same abort contract as `update`. Mirrors the mobile store. */
  updateSession: (id: string, fn: (s: Session) => void | false) => void;
  saveFailed: boolean;
  whoop: WhoopSample | null;
  setWhoop: (w: WhoopSample | null) => void;
  /** Everything the HR model needs, assembled from profile + live sample. */
  hr: HrContext;
  activeSession: Session | null;
  workouts: Workout[];
  sessions: Session[];
  settings: Settings;
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
  const [db, setDb] = useState<EngineDB>(() => {
    const { db: loaded } = loadDB(webStorage, LS_KEY);
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

  const value = useMemo<DbCtx>(() => {
    const activeSession = db.sessions.find((s) => s.status === 'active') || null;
    return {
      db,
      update,
      updateSession,
      saveFailed,
      whoop,
      setWhoop,
      hr: { profile: db.settings.profile, whoop },
      activeSession,
      workouts: db.workouts,
      sessions: db.sessions,
      settings: db.settings,
    };
  }, [db, update, updateSession, saveFailed, whoop]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDb(): DbCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useDb outside DbProvider');
  return c;
}

export { emptyDB };
