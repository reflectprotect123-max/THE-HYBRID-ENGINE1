import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import {
  LS_KEY,
  ensureSharedCore,
  expireStaleSessions,
  loadDB,
  pruneCondTraces,
  saveDB,
  sessionRpe,
  restrictToProduct,
  type EngineDB,
  type HrContext,
  type Session,
  type WhoopSample,
  type Workout,
} from '@hybrid/engine';
import { deriveAthleteState, summarizeTrainingFacts, type AthleteStateSnapshot, type TrainingFact } from '@hybrid/whole-athlete-state';
import { buildWeeklyPlan, type WeeklyPlan } from '@hybrid/coordinator-adapter';
import type { ProductId } from '@hybrid/product-scope';
import { storage } from './storage';
import { splitActiveSession, useDiscipline } from '../discipline';

/*
 * Identical in shape to the web app's store, and deliberately so: the two apps
 * share an engine, so they must also share the rule that every write goes
 * through one place and persists immediately.
 */

/*
 * Merged-app scoping: READS are scoped — `workouts`, `sessions` and
 * `activeSession` show only the world the athlete is in. `db` and WRITES are
 * not: a filtered view must never become the thing written back or merged
 * (the 5 Aug C1/C2 data-loss lesson, see cloud/sync.tsx), and the Coordinator
 * and whole-athlete-state below read every session because seeing both worlds
 * is their whole job. Legacy single-product builds scope nothing — their db
 * is already narrowed by sync.
 */
interface DbCtx {
  /** The COMPLETE database. Writes, sync, Coordinator, athlete state, backup. */
  db: EngineDB;
  /** The world currently on screen ('strength' in legacy builds' terms). */
  discipline: ProductId;
  /** Scoped to the current world in the merged app. */
  workouts: Workout[];
  /** Scoped to the current world in the merged app. */
  sessions: Session[];
  /**
   * A live session in the OTHER world, if any. Scoping `activeSession` without
   * surfacing this would strand mid-session work for expireStaleSessions to
   * silently end at the next day boundary.
   */
  foreignActiveSession: Session | null;
  update: (fn: (draft: EngineDB) => void | false) => void;
  /**
   * Mutate ONE session, cloning only that session rather than the whole
   * database. Same contract as `update` otherwise — return false to abandon.
   * For hot paths like typing a weight, where cloning every session ever
   * logged to change four characters is the entire cost.
   */
  updateSession: (id: string, fn: (s: Session) => void | false) => void;
  saveFailed: boolean;
  /** true when the stored data was unreadable at boot and this DB is a fresh,
   *  empty fallback rather than what the athlete actually had. */
  dataRecovered: boolean;
  whoop: WhoopSample | null;
  setWhoop: (w: WhoopSample | null) => void;
  hr: HrContext;
  activeSession: Session | null;
  athleteState: AthleteStateSnapshot;
  weeklyPlan: WeeklyPlan;
}

const Ctx = createContext<DbCtx | null>(null);

/** Long enough to coalesce a burst of typing, short enough that leaving the
 *  screen or the app always beats it to the disk. */
const SAVE_DEBOUNCE_MS = 400;

export function DbProvider({ children }: { children: ReactNode }) {
  // Written by the `db` lazy initializer below, on the same render, before
  // this is read — the two useState calls run in declaration order on mount.
  const recoveredAtBoot = useRef(false);
  const [db, setDb] = useState<EngineDB>(() => {
    const { db: loaded, recovered } = loadDB(storage, LS_KEY);
    recoveredAtBoot.current = recovered;
    const { sessions, changed } = expireStaleSessions(loaded.sessions);
    if (changed) {
      loaded.sessions = sessions;
      saveDB(storage, loaded, LS_KEY);
    }
    // Inline HR/GPS traces are unbounded otherwise and eventually cross the
    // store's quota, after which every save fails forever.
    const { sessions: pruned, changed: ch2 } = pruneCondTraces(loaded.sessions);
    if (ch2) {
      loaded.sessions = pruned;
      saveDB(storage, loaded, LS_KEY);
    }
    return loaded;
  });
  const [dataRecovered] = useState(() => recoveredAtBoot.current);
  const [saveFailed, setSaveFailed] = useState(false);
  const [whoop, setWhoop] = useState<WhoopSample | null>(null);
  const discipline = useDiscipline();

  const ref = useRef(db);
  ref.current = db;

  /*
   * The write is COALESCED; the in-memory truth is not.
   *
   * Every keystroke in a set field calls update(), and saveDB serialises the
   * WHOLE database and writes it synchronously. That is invisible on an empty
   * account and quietly becomes typing lag as history accumulates — measured
   * at ~24ms per keystroke by 300 sessions on a desktop CPU, and a phone is
   * several times slower. `ref.current` and React state still move
   * immediately, so nothing reads stale data; only the disk write waits.
   *
   * The crash-safety this replaces is preserved by flushing on the way out of
   * the foreground, which is the transition Android actually gives you before
   * reclaiming a process. The exposure is a few hundred ms of typing, and only
   * if the process dies without ever being backgrounded.
   */
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSave = useRef<EngineDB | null>(null);

  const flush = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    let draft = pendingSave.current;
    if (!draft) return;
    pendingSave.current = null;
    let ok = saveDB(storage, draft, LS_KEY);
    if (!ok) {
      // Quota is usually the unbounded HR/GPS trace history, not this
      // session's own data — prune old ones and retry once before giving up.
      const { sessions: pr, changed } = pruneCondTraces(draft.sessions);
      if (changed) {
        draft = { ...draft, sessions: pr };
        ref.current = draft;
        setDb(draft);
        ok = saveDB(storage, draft, LS_KEY);
      }
    }
    setSaveFailed(!ok);
  }, []);

  const update = useCallback<DbCtx['update']>(
    (fn) => {
      const draft: EngineDB = JSON.parse(JSON.stringify(ref.current));
      if (fn(draft) === false) return;
      ref.current = draft;
      setDb(draft);
      pendingSave.current = draft;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  /*
   * The same immutability guarantee for a fraction of the work: every session
   * except the edited one is carried across by reference, so React still sees
   * a new `db` and a new `sessions` array, but only ~2KB is copied instead of
   * the whole history. At 300 sessions the full-database clone was ~15ms per
   * keystroke on a desktop CPU and grows forever; this does not grow at all.
   */
  const updateSession = useCallback<DbCtx['updateSession']>(
    (id, fn) => {
      const cur = ref.current;
      const i = cur.sessions.findIndex((x) => x.id === id);
      if (i < 0) return;
      const copy: Session = JSON.parse(JSON.stringify(cur.sessions[i]));
      if (fn(copy) === false) return;
      const sessions = cur.sessions.slice();
      sessions[i] = copy;
      const next: EngineDB = { ...cur, sessions };
      ref.current = next;
      setDb(next);
      pendingSave.current = next;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  // Leaving the foreground is the last reliable moment before Android may
  // reclaim the process, so anything still pending goes to disk there.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s !== 'active') flush();
    });
    return () => {
      sub.remove();
      flush();
    };
  }, [flush]);

  const value = useMemo<DbCtx>(
    () => {
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
      const live = db.sessions.find((s) => s.status === 'active') || null;
      const { activeSession, foreignActiveSession } = splitActiveSession(live, discipline);
      // Derived from the full db every time rather than stored — one source of
      // truth, no second copy to desync.
      const scoped = restrictToProduct(db, discipline);
      return {
        db,
        discipline,
        workouts: scoped.workouts,
        sessions: scoped.sessions,
        update,
        updateSession,
        saveFailed,
        dataRecovered,
        whoop,
        setWhoop,
        hr: { profile: db.settings.profile, whoop },
        activeSession,
        foreignActiveSession,
        athleteState,
        weeklyPlan,
      };
    },
    [db, discipline, update, updateSession, saveFailed, dataRecovered, whoop],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDb(): DbCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useDb outside DbProvider');
  return c;
}
