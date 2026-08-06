import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { createClient, type Session as AuthSession, type SupabaseClient, type User } from '@supabase/supabase-js';
import { SUPABASE } from '@hybrid/config';
import {
  applyPull,
  buildMergedSyncNamespace,
  buildPushState,
  cloudFp,
  mergeEngines,
  sanitizeDB,
  type EngineDB,
} from '@hybrid/engine';
import { useDb } from '../store/db';
import { storage } from '../store/storage';
import { humanizeError } from '../errors';
import {
  applyProductSyncNamespace as applyEcosystemNamespace,
  ECOSYSTEM_SYNC_ENABLED,
  pullEcosystem,
  pushEcosystem,
} from './ecosystem';
import '../product'; // build-config guard

/*
 * Cloud sync, native edition.
 *
 * The protocol is identical to the web app's and deliberately so: two devices
 * must be able to schedule and log between syncs without either losing work.
 * That is why a pull MERGES by record rather than overwriting a push merges
 * against whatever the remote already holds.
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

/* One writer identity for both domains. */
const ECOSYSTEM_WRITER = 'hybrid:mobile';

export function SyncProvider({ children }: { children: ReactNode }) {
  const { db, update } = useDb();
  const [user, setUser] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [syncedAt, setSyncedAt] = useState(0);

  // The DB changes on every logged set; reading it through a ref keeps the
  // reconcile callback stable so the AppState listener isn't torn down and
  // rebuilt mid-session.
  const dbRef = useRef(db);
  dbRef.current = db;
  const lastFp = useRef<string | null>(null);
  const inFlight = useRef(false);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /*
   * Fold a reconciled snapshot back into the store WITHOUT overwriting it.
   *
   * `draft` is always the store's true current state — store/db.tsx's `update`
   * builds it from a plain synchronous ref that every `update()` call mutates
   * immediately, so it is never stale across an await. `next`, by contrast, is
   * a snapshot computed BEFORE `pushNow` was awaited: a set logged on this
   * device while that push was in flight has already landed in the store
   * through its own `update()` call, and `pushNow` itself ends by writing
   * fresher `core`/`ecosystem` bookkeeping the same way when ecosystem sync is
   * on. Assigning `next` over `draft` discarded both. Merging `next` INTO
   * `draft` — with the same engine primitives the rest of the sync path
   * trusts — cannot.
   *
   * HISTORY: until the apps merged (Aug 2026), single-product builds narrowed
   * this fold with restrictToProduct, and an other-product record authored
   * during the push's await window could be pruned before reaching the server
   * — a documented, bounded residual. The merged app never narrows, so that
   * residual is structurally gone; see git history and the merge spec if you
   * need the full account.
   *
   */
  const applyMerged = useCallback(
    (next: EngineDB) => {
      update((draft) => {
        const folded = sanitizeDB(mergeEngines(draft, next));
        draft.workouts = folded.workouts;
        draft.sessions = folded.sessions;
        draft.settings = folded.settings;
        draft.core = folded.core;
        draft.ecosystem = folded.ecosystem;
      });
      // `dbRef.current = next` used to live here and is deliberately gone:
      // `next` is the unfolded snapshot, so pinning the ref to it would put
      // back the staleness this merge exists to remove. `dbRef.current = db`
      // in the component body runs on the render `update()` always schedules,
      // and nothing between here and that render reads the ref.
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
        // (:198) already does.
        const { data, error: e } = await client
          .from('app_state').select('state').eq('user_id', user.id).maybeSingle();
        if (e) throw e;
        existing = (data?.state ?? {}) as Record<string, unknown>;
      }

      let source = dbRef.current;
      if (ECOSYSTEM_SYNC_ENABLED) {
        const namespace = buildMergedSyncNamespace(source, ECOSYSTEM_WRITER);
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

      const previousLocal = dbRef.current;
      const { db: mergedDb, needsPush: legacyNeedsPush } = applyPull(previousLocal, remote);
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

      // The merge above is deliberately unfiltered — it must never lose a
      // record that exists only locally or only in an un-split legacy remote
      // blob. Push runs against that full, unfiltered `merged` data BEFORE
      // any product filtering happens, so a wrong-kind record authored on
      // this device (nothing gates authoring by product — see the design
      // spec's Non-goals) reaches the server first. Only after that is the
      // device's own on-disk storage narrowed to its own product — pruning a
      // record locally here can never mean losing it IF it was part of that
      // pushed snapshot, because by that point it is already durable on the
      // server. Exception: an OTHER-product record authored during the push's
      // await window never made it into that snapshot, so it can still be
      // pruned before reaching the server.
      if (merged !== previousLocal) dbRef.current = merged;
      if (needsPush) await pushNow(true, remoteState);

      // The app hosts both worlds — nothing is narrowed.
      const local = merged;
      if (cloudFp(local) !== cloudFp(previousLocal)) {
        applyMerged(local);
      } else {
        dbRef.current = previousLocal;
      }

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
  // this is what pulls in whatever another device pushed while this one was
  // backgrounded. On the web this hangs off document.visibilitychange; native
  // has no document, and AppState 'active' is the equivalent edge.
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
    /* The fingerprint check used to run HERE, which meant a full
       JSON.stringify of every workout and session on every keystroke of a set
       field, purely to decide whether to arm a timer. pushNow already computes
       the same fingerprint and no-ops when it is unchanged, so the work now
       happens once per quiet period instead of once per character. */
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      void pushNow(false).catch((e) => setError(humanizeError(e, 'sync')));
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
