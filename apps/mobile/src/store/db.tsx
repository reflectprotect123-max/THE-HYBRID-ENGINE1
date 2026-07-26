import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  LS_KEY,
  expireStaleSessions,
  loadDB,
  saveDB,
  type EngineDB,
  type HrContext,
  type Session,
  type WhoopSample,
} from '@hybrid/engine';
import { storage } from './storage';

/*
 * Identical in shape to the web app's store, and deliberately so: the two apps
 * share an engine, so they must also share the rule that every write goes
 * through one place and persists immediately.
 */

interface DbCtx {
  db: EngineDB;
  update: (fn: (draft: EngineDB) => void | false) => void;
  saveFailed: boolean;
  whoop: WhoopSample | null;
  setWhoop: (w: WhoopSample | null) => void;
  hr: HrContext;
  activeSession: Session | null;
}

const Ctx = createContext<DbCtx | null>(null);

export function DbProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<EngineDB>(() => {
    const { db: loaded } = loadDB(storage, LS_KEY);
    const { sessions, changed } = expireStaleSessions(loaded.sessions);
    if (changed) {
      loaded.sessions = sessions;
      saveDB(storage, loaded, LS_KEY);
    }
    return loaded;
  });
  const [saveFailed, setSaveFailed] = useState(false);
  const [whoop, setWhoop] = useState<WhoopSample | null>(null);

  const ref = useRef(db);
  ref.current = db;

  const update = useCallback<DbCtx['update']>((fn) => {
    const draft: EngineDB = JSON.parse(JSON.stringify(ref.current));
    if (fn(draft) === false) return;
    ref.current = draft;
    setDb(draft);
    setSaveFailed(!saveDB(storage, draft, LS_KEY));
  }, []);

  const value = useMemo<DbCtx>(
    () => ({
      db,
      update,
      saveFailed,
      whoop,
      setWhoop,
      hr: { profile: db.settings.profile, whoop },
      activeSession: db.sessions.find((s) => s.status === 'active') || null,
    }),
    [db, update, saveFailed, whoop],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDb(): DbCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useDb outside DbProvider');
  return c;
}
