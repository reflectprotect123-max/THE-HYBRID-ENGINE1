import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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

/*
 * Cloud sync.
 *
 * The shape of this is dictated by one requirement: two devices must be able to
 * schedule and log between syncs without either losing work. That is why a pull
 * MERGES by record rather than overwriting, why a push merges against whatever
 * the remote already holds, and why coach assignments are reconciled separately
 * — they live in their own table, outside the state fingerprint.
 *
 * All of those rules are in @hybrid/engine and tested there. This file is only
 * the network and the React wiring.
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
}

const Ctx = createContext<SyncCtx | null>(null);

const client: SupabaseClient | null = (() => {
  try {
    if (!SUPABASE.url || !SUPABASE.anonKey) return null;
    return createClient(SUPABASE.url, SUPABASE.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
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

  // The DB changes on every logged set; reading it through a ref keeps the
  // reconcile callback stable so the visibility listener isn't torn down and
  // rebuilt mid-session.
  const dbRef = useRef(db);
  dbRef.current = db;
  const lastFp = useRef<string | null>(null);
  const inFlight = useRef(false);
  const pushTimer = useRef<number | null>(null);

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
      // makes a freshly assigned session appear without a reload.
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

  // Reconcile on sign-in, and whenever the app comes back to the foreground —
  // this is what pulls a freshly assigned session onto the calendar.
  useEffect(() => {
    if (!user) return;
    void reconcile();
    const onVis = () => {
      if (document.visibilityState === 'visible') void reconcile();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [user, reconcile]);

  // Debounced push on local change. 900ms because a set confirm writes several
  // times in quick succession and each one must not become a round trip.
  useEffect(() => {
    if (!user) return;
    if (cloudFp(db) === lastFp.current) return;
    if (pushTimer.current) window.clearTimeout(pushTimer.current);
    pushTimer.current = window.setTimeout(() => {
      void pushNow(false).catch((e) => setError(String((e as Error)?.message || e)));
    }, 900);
    return () => {
      if (pushTimer.current) window.clearTimeout(pushTimer.current);
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
      },
      syncNow: reconcile,
    }),
    [user, busy, error, syncedAt, reconcile],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSync(): SyncCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSync outside SyncProvider');
  return c;
}
