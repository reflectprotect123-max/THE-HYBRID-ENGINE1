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
import { humanizeError } from '../errors';

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
  /** Claim a coach's invite code. Returns null on success, else a message. */
  claimInvite: (code: string) => Promise<string | null>;
  coachLinked: boolean;
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
  const [coachLinked, setCoachLinked] = useState(false);

  // The DB changes on every logged set; reading it through a ref keeps the
  // reconcile callback stable so the visibility listener isn't torn down and
  // rebuilt mid-session.
  const dbRef = useRef(db);
  dbRef.current = db;
  const lastFp = useRef<string | null>(null);
  const inFlight = useRef(false);
  const pushTimer = useRef<number | null>(null);
  // Fingerprint of the last digest actually published. `reconcile` runs on every
  // return to the foreground, so without this an athlete tabbing back and forth
  // re-uploads the whole 90-day digest each time. The vanilla app guards this
  // the same way (`_feedFp` in app.js).
  const lastFeedFp = useRef<string | null>(null);

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

    const payload = coachDigest(dbRef.current);
    // `updatedAt` is deliberately excluded from the fingerprint: it changes on
    // every call, so including it would make the guard below never match and
    // the whole 90-day digest would re-upload on every return to the app.
    const { updatedAt: _updatedAt, ...stable } = payload;
    let fp: string;
    try {
      fp = JSON.stringify(stable);
    } catch {
      fp = '';
    }
    if (fp && fp === lastFeedFp.current) return;

    const { error: e } = await client
      .from('athlete_feed')
      .upsert(
        { athlete_id: user.id, payload, updated_at: new Date().toISOString() },
        { onConflict: 'athlete_id' },
      );
    if (!e) lastFeedFp.current = fp;
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
      setError(humanizeError(e, 'sync'));
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
      void pushNow(false).catch((e) => setError(humanizeError(e, 'sync')));
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
        return e ? humanizeError(e, 'sign-in') : null;
      },
      signUp: async (email, password) => {
        if (!client) return 'Cloud sync is not configured.';
        const { data, error: e } = await client.auth.signUp({ email: email.trim(), password });
        if (e) return humanizeError(e, 'sign-up');
        // Without email confirmation there is no session yet — say so rather
        // than leaving the user staring at an unchanged screen.
        return data.session ? null : 'Account created. Check your email to confirm, then sign in.';
      },
      signOut: async () => {
        if (!client) return;
        await client.auth.signOut();
        setUser(null);
        lastFp.current = null;
        // Otherwise the next account to sign in on this device inherits the
        // previous one's digest fingerprint and never publishes its first feed.
        lastFeedFp.current = null;
      },
      syncNow: reconcile,
      coachLinked,
      /*
       * The ONLY way to establish a coach link. `claim_invite` is a
       * security-definer RPC because the RLS policies deliberately give a coach
       * no UPDATE on coach_athletes — otherwise a coach could flip any row to
       * active against an athlete who never agreed. Consent flows one way:
       * the athlete types the code.
       */
      claimInvite: async (code) => {
        if (!client) return 'Cloud sync is not configured.';
        if (!user) return 'Sign in first — a coach link is tied to your account.';
        const token = code.trim().toUpperCase();
        if (!token) return 'Enter the code your coach gave you.';
        const { error: e } = await client.rpc('claim_invite', { p_token: token });
        if (e) return humanizeError(e, 'invite');
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
