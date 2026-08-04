import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createClient, type Session as AuthSession, type SupabaseClient, type User } from '@supabase/supabase-js';
import { SUPABASE } from '@hybrid/config';
import { applyPull, buildProductSyncNamespace, buildPushState, cloudFp, sanitizeDB, type EngineDB } from '@hybrid/engine';
import { useDb } from '../store/db';
import { humanizeError } from '../errors';
import {
  applyProductSyncNamespace as applyEcosystemNamespace,
  ECOSYSTEM_SYNC_ENABLED,
  pullEcosystem,
  pushEcosystem,
} from './ecosystem';
import { PRODUCT_ID } from '../product';

/*
 * Cloud sync.
 *
 * The shape of this is dictated by one requirement: two devices must be able to
 * schedule and log between syncs without either losing work. That is why a pull
 * MERGES by record rather than overwriting, and why a push merges against
 * whatever the remote already holds.
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

const ECOSYSTEM_WRITER = `${PRODUCT_ID}:web`;

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
        draft.core = next.core;
        draft.ecosystem = next.ecosystem;
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
        // A swallowed read error was indistinguishable from an empty row, so a
        // network blip / 500 / RLS refusal turned the next push into a
        // truncating overwrite of another device's records and unrelated state
        // keys. Treat a read failure as fatal for this push, like reconcile
        // (:186) already does.
        const { data, error: e } = await client
          .from('app_state').select('state').eq('user_id', user.id).maybeSingle();
        if (e) throw e;
        existing = (data?.state ?? {}) as Record<string, unknown>;
      }

      let source = dbRef.current;
      let namespace: ReturnType<typeof buildProductSyncNamespace> | undefined;
      if (ECOSYSTEM_SYNC_ENABLED) {
        namespace = buildProductSyncNamespace(source, PRODUCT_ID, ECOSYSTEM_WRITER);
        source = { ...source, core: namespace.core, ecosystem: namespace };
        dbRef.current = source;
      }
      const state = buildPushState(source, existing);
      const { error: e } = await client.from('app_state').upsert({ user_id: user.id, state }, { onConflict: 'user_id' });
      if (e) throw e;
      if (ECOSYSTEM_SYNC_ENABLED) {
        const pushed = await pushEcosystem(client, source, ECOSYSTEM_WRITER);
        update((draft) => {
          draft.core = pushed.core;
          draft.ecosystem = pushed;
        });
      }
      lastFp.current = cloudFp(source);
      setSyncedAt(Date.now());
    },
    [user, update],
  );

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

      const { db: mergedDb, needsPush: legacyNeedsPush } = applyPull(dbRef.current, remote);
      let merged = mergedDb;
      let needsPush = legacyNeedsPush;
      if (ECOSYSTEM_SYNC_ENABLED) {
        const ecosystemRemote = await pullEcosystem(client, user.id);
        if (ecosystemRemote) {
          const ecosystemMerged = applyEcosystemNamespace(merged, ecosystemRemote);
          if (cloudFp(ecosystemMerged) !== cloudFp(merged)) needsPush = true;
          merged = ecosystemMerged;
        }
      }
      if (merged !== dbRef.current) applyMerged(merged);
      if (needsPush) await pushNow(true, remoteState);

      setSyncedAt(Date.now());
    } catch (e) {
      setError(humanizeError(e, 'sync'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [user, applyMerged, pushNow]);

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
    /* The fingerprint check used to run HERE, which meant a full
       JSON.stringify of every workout and session on every keystroke of a set
       field, purely to decide whether to arm a timer. pushNow already computes
       the same fingerprint and no-ops when it is unchanged, so the work now
       happens once per quiet period instead of once per character. */
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
