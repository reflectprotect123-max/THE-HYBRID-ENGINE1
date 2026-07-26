import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { createClient, type Session as AuthSession, type SupabaseClient, type User } from '@supabase/supabase-js';
import { SUPABASE } from '@hybrid/config';
import {
  applyPull,
  buildPushState,
  cloudFp,
  coachDigest,
  reconcileAssignments,
  sanitizeDB,
  type AssignmentRow,
  type EngineDB,
} from '@hybrid/engine';
import { useDb } from '../store/db';
import { storage } from '../store/storage';

/*
 * Cloud sync, native edition.
 *
 * The protocol is identical to the web app's and deliberately so: two devices
 * must be able to schedule and log between syncs without either losing work.
 * That is why a pull MERGES by record rather than overwriting, why a push
 * merges against whatever the remote already holds, and why coach assignments
 * are reconciled separately — they live in their own table, outside the state
 * fingerprint.
 *
 * All of those rules live in @hybrid/engine and are tested there. This file is
 * only the network and the React wiring. What differs from the web file is
 * strictly the three things a phone does not share with a browser:
 *
 *  1. There is no localStorage, so Supabase is handed the MMKV-backed storage
 *     port explicitly. Without it gotrue falls back to memory and the athlete
 *     is signed out by every cold start.
 *  2. There is no address bar, so `detectSessionInUrl` must be off — on native
 *     it would parse a URL that never exists and can throw during init.
 *  3. There is no `document.visibilitychange` and no `window`; AppState and the
 *     bare timer globals stand in.
 */

interface SyncCtx {
  enabled: boolean;
  user: User | null;
  busy: boolean;
  error: string;
  syncedAt: number;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  syncNow: () => Promise<void>;
  /** True once an active coach link exists for this athlete. */
  coachLinked: boolean;
  /** Redeem a coach's invite code. Resolves to an error message, or null. */
  claimInvite: (code: string) => Promise<string | null>;
}

const Ctx = createContext<SyncCtx | null>(null);

const client: SupabaseClient | null = (() => {
  try {
    if (!SUPABASE.url || !SUPABASE.anonKey) return null;
    return createClient(SUPABASE.url, SUPABASE.anonKey, {
      auth: {
        /*
         * THE line that decides whether a sign-in survives an app restart.
         *
         * On the web gotrue defaults to window.localStorage. React Native has
         * no such global, and gotrue's silent fallback is an in-memory store —
         * so persistSession: true alone is a lie: the session is "persisted"
         * into a Map that dies with the JS context. The storage port here is
         * MMKV (see ../store/storage), which is synchronous and survives a
         * cold start; on a build without the native module it degrades to the
         * same in-memory shim the rest of the app uses, and sign-in then
         * simply does not stick — which is the honest behaviour.
         */
        storage,
        persistSession: true,
        autoRefreshToken: true,
        // No URL fragment to read on native. Leaving this on makes gotrue reach
        // for `window.location` during construction.
        detectSessionInUrl: false,
      },
    });
  } catch {
    return null;
  }
})();

export function SyncProvider({ children }: { children: ReactNode }) {
  const { db, update } = useDb();
  const [user, setUser] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [syncedAt, setSyncedAt] = useState(0);
  const [coachLinked, setCoachLinked] = useState(false);

  // The DB changes on every logged set; reading it through a ref keeps the
  // reconcile callback stable so the AppState listener isn't torn down and
  // rebuilt mid-session.
  const dbRef = useRef(db);
  dbRef.current = db;
  const lastFp = useRef<string | null>(null);
  const inFlight = useRef(false);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyMerged = useCallback(
    (next: EngineDB) => {
      update((draft) => {
        draft.workouts = next.workouts;
        draft.sessions = next.sessions;
        draft.settings = next.settings;
      });
      dbRef.current = next;
    },
    [update],
  );

  const pushNow = useCallback(
    async (force: boolean, knownRemote?: Record<string, unknown>) => {
      if (!client || !user) return;
      const fp = cloudFp(dbRef.current);
      if (!force && fp === lastFp.current) return;

      // Read the current row first so unrelated keys in this user's state
      // survive, and so the merge is against what is actually up there rather
      // than against what we last saw.
      let existing = knownRemote;
      if (!existing) {
        const { data } = await client.from('app_state').select('state').eq('user_id', user.id).maybeSingle();
        existing = (data?.state ?? {}) as Record<string, unknown>;
      }

      const state = buildPushState(dbRef.current, existing);
      const { error: e } = await client.from('app_state').upsert({ user_id: user.id, state }, { onConflict: 'user_id' });
      if (e) throw e;
      lastFp.current = fp;
      setSyncedAt(Date.now());
    },
    [user],
  );

  const pullAssignments = useCallback(async () => {
    if (!client || !user) return;
    const { data, error: e } = await client
      .from('assignments')
      .select('id,scheduled_date,session_snapshot,updated_at,status')
      .eq('athlete_id', user.id)
      .eq('status', 'assigned');
    // A project without the assignments table provisioned must not break sync.
    if (e) return;

    const cur = dbRef.current;
    const { workouts, changed } = reconcileAssignments(
      cur.workouts,
      cur.sessions,
      cur.settings,
      (data || []) as AssignmentRow[],
    );
    if (changed) {
      update((draft) => {
        draft.workouts = workouts;
      });
    }
  }, [user, update]);

  const publishDigest = useCallback(async () => {
    if (!client || !user) return;
    // Only when a coach link is actually active — an athlete with no coach
    // publishes nothing at all.
    const { data: link } = await client
      .from('coach_athletes')
      .select('id')
      .eq('athlete_id', user.id)
      .eq('status', 'active')
      .maybeSingle();
    setCoachLinked(!!link);
    if (!link) return;
    await client
      .from('athlete_feed')
      .upsert(
        { athlete_id: user.id, payload: coachDigest(dbRef.current), updated_at: new Date().toISOString() },
        { onConflict: 'athlete_id' },
      );
  }, [user]);

  const reconcile = useCallback(async () => {
    if (!client || !user || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const { data, error: e1 } = await client
        .from('app_state')
        .select('state,updated_at')
        .eq('user_id', user.id)
        .maybeSingle();
      if (e1) throw e1;

      const remoteState = (data?.state ?? {}) as Record<string, unknown>;
      const rawRemote = remoteState.hybridEngine as EngineDB | undefined;
      // The pulled state is foreign input — an older client, or a buggy one,
      // may have written it — so it is hardened before it can reach a merge.
      const remote = rawRemote ? sanitizeDB(rawRemote) : null;

      const { db: mergedDb, needsPush } = applyPull(dbRef.current, remote);
      if (mergedDb !== dbRef.current) applyMerged(mergedDb);
      if (needsPush) await pushNow(true, remoteState);

      // Assignments live in their own table, outside the state fingerprint, so
      // they are reconciled whether or not app_state changed. This is what
      // makes a freshly assigned session appear without a manual refresh.
      await pullAssignments();
      await publishDigest();

      setSyncedAt(Date.now());
    } catch (e) {
      setError(String((e as Error)?.message || e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [user, applyMerged, pushNow, pullAssignments, publishDigest]);

  /* ---- auth ---- */
  useEffect(() => {
    if (!client) return;
    let alive = true;
    void client.auth.getSession().then(({ data }) => {
      if (alive) setUser(data.session?.user ?? null);
    });
    const { data: sub } = client.auth.onAuthStateChange((_e, session: AuthSession | null) => {
      setUser(session?.user ?? null);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  /*
   * gotrue's refresh loop is a JS timer, and JS timers do not run while the app
   * is backgrounded — so left alone it wakes up holding an expired token and
   * the first query after a long background fails with a 401. Driving it off
   * AppState is the documented React Native handling.
   */
  useEffect(() => {
    if (!client) return;
    const c = client;
    if (AppState.currentState === 'active') c.auth.startAutoRefresh();
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') c.auth.startAutoRefresh();
      else c.auth.stopAutoRefresh();
    });
    return () => {
      sub.remove();
      c.auth.stopAutoRefresh();
    };
  }, []);

  // Reconcile on sign-in, and whenever the app comes back to the foreground —
  // this is what pulls a freshly assigned session onto the calendar. On the web
  // this hangs off document.visibilitychange; native has no document, and
  // AppState 'active' is the equivalent edge.
  useEffect(() => {
    if (!user) return;
    void reconcile();
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') void reconcile();
    });
    return () => sub.remove();
  }, [user, reconcile]);

  // Debounced push on local change. 900ms because a set confirm writes several
  // times in quick succession and each one must not become a round trip. No
  // `window` on native — the timer globals are used directly, and the handle is
  // typed off setTimeout itself because RN's is not the DOM's number.
  useEffect(() => {
    if (!user) return;
    if (cloudFp(db) === lastFp.current) return;
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      void pushNow(false).catch((e) => setError(String((e as Error)?.message || e)));
    }, 900);
    return () => {
      if (pushTimer.current) clearTimeout(pushTimer.current);
    };
  }, [db, user, pushNow]);

  const value = useMemo<SyncCtx>(
    () => ({
      enabled: !!client,
      user,
      busy,
      error,
      syncedAt,
      signIn: async (email, password) => {
        if (!client) return 'Cloud sync is not configured.';
        const { error: e } = await client.auth.signInWithPassword({ email: email.trim(), password });
        return e ? e.message : null;
      },
      signUp: async (email, password) => {
        if (!client) return 'Cloud sync is not configured.';
        const { data, error: e } = await client.auth.signUp({ email: email.trim(), password });
        if (e) return e.message;
        // Without email confirmation there is no session yet — say so rather
        // than leaving the user staring at an unchanged screen.
        return data.session ? null : 'Account created. Check your email to confirm, then sign in.';
      },
      signOut: async () => {
        if (!client) return;
        await client.auth.signOut();
        setUser(null);
        lastFp.current = null;
        // Otherwise the next account on this device inherits the previous
        // athlete's link state and is told it already has a coach.
        setCoachLinked(false);
      },
      syncNow: reconcile,
      coachLinked,
      /*
       * The ONLY way to establish a coach link. `claim_invite` is a
       * security-definer RPC because the RLS policies deliberately give a coach
       * no UPDATE on coach_athletes — otherwise a coach could flip any row to
       * active against an athlete who never agreed. Consent flows one way: the
       * athlete types the code.
       */
      claimInvite: async (code) => {
        if (!client) return 'Cloud sync is not configured.';
        if (!user) return 'Sign in first — a coach link is tied to your account.';
        const token = code.trim().toUpperCase();
        if (!token) return 'Enter the code your coach gave you.';
        const { error: e } = await client.rpc('claim_invite', { p_token: token });
        if (e) return e.message;
        await reconcile();
        return null;
      },
    }),
    [user, busy, error, syncedAt, reconcile, coachLinked],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSync(): SyncCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSync outside SyncProvider');
  return c;
}
