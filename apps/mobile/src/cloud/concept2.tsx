import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Linking } from 'react-native';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { FN, SITE_ORIGIN, SUPABASE } from '@hybrid/config';
import { type Concept2Result } from '@hybrid/engine';
import { useSync } from './sync';
import { storage } from '../store/storage';
import { humanizeError } from '../errors';

/*
 * Concept2 Logbook, native edition.
 *
 * The client never touches Concept2 directly — the OAuth tokens live
 * server-side in the Netlify functions, and this only talks to those. The
 * identity model is the one WHOOP's native integration established (see
 * ./whoop.tsx for the full story): the connection is filed under the SUPABASE
 * USER, consent happens in the system browser, and every call from here is an
 * ABSOLUTE URL carrying `Authorization: Bearer <supabase access token>`.
 *
 * Unlike WHOOP's single daily sample, a sync returns a LIST of logged results
 * (rower, SkiErg, BikeErg). The status poll deliberately does NOT carry that
 * list — it can be hundreds of records — so `refresh` only learns
 * connected/lastSyncAt and the first `sync` fetches the results themselves.
 * Nothing here writes to the training database: this provider is state + fetch
 * and no more. The engine's matcher (packages/engine/src/concept2.ts) exists
 * for attaching results to sessions but is NOT wired up yet — synced results
 * are viewable, not merged into History/Progress.
 */

const fnUrl = (path: string) => (/^https?:/i.test(path) ? path : SITE_ORIGIN + path);

/*
 * A read-only Supabase client, same construction and same reasoning as
 * ./whoop.tsx: cloud sync owns the client that refreshes the session, this one
 * only READS it, so `autoRefreshToken` is off and the shared storage key lets
 * gotrue's own lock serialise the instances.
 */
const auth: SupabaseClient | null = (() => {
  try {
    if (!SUPABASE.url || !SUPABASE.anonKey) return null;
    return createClient(SUPABASE.url, SUPABASE.anonKey, {
      auth: { storage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
    });
  } catch {
    return null;
  }
})();

const accessToken = async (): Promise<string | null> => {
  if (!auth) return null;
  try {
    const { data } = await auth.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
};

export interface Concept2State {
  loaded: boolean;
  connected: boolean;
  results: Concept2Result[];
  lastSyncAt: string | null;
  busy: boolean;
  error: string;
}

interface Concept2Ctx extends Concept2State {
  connect: () => void;
  sync: (silent?: boolean) => Promise<void>;
  disconnect: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<Concept2Ctx | null>(null);

const SIGN_IN_FIRST = 'Sign in to cloud sync first — Concept2 is linked to your account, not to this phone.';

/*
 * `cache: 'no-store'` is a no-op on RN's fetch, so freshness is asked for with
 * a header the function layer honours and a cache-busting param. Cookies are
 * deliberately NOT sent — identity is the bearer token (see ./whoop.tsx).
 */
const call = async (path: string, init?: RequestInit) => {
  const u = fnUrl(path);
  const bust = (u.includes('?') ? '&' : '?') + '_=' + Date.now();
  const token = await accessToken();
  const r = await fetch(u + bust, {
    ...init,
    headers: {
      accept: 'application/json',
      'cache-control': 'no-store',
      ...(token ? { authorization: 'Bearer ' + token } : {}),
      ...((init?.headers as Record<string, string> | undefined) || {}),
    },
  });
  if (!r.ok) throw new Error('Request failed (' + r.status + ')');
  return r.json();
};

export function Concept2Provider({ children }: { children: ReactNode }) {
  // Mounted INSIDE SyncProvider (see App.tsx). Reading the signed-in user here
  // is what makes the Concept2 card correct itself the moment someone signs
  // in, instead of waiting for the next cold start.
  const { user } = useSync();
  const [s, setS] = useState<Concept2State>({
    loaded: false,
    connected: false,
    results: [],
    lastSyncAt: null,
    busy: false,
    error: '',
  });
  const busyRef = useRef(false);
  // Whether a sync has answered this session — an athlete with zero logged
  // results still counts, or the lazy fetch below would re-ask forever.
  const fetchedRef = useRef(false);

  const sync = useCallback(async (silent = false) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setS((p) => ({ ...p, busy: true }));
    try {
      const d = await call(FN.concept2Sync);
      if (d.connected === false) throw new Error('Concept2 is not connected.');
      const results = Array.isArray(d.normalized) ? (d.normalized as Concept2Result[]) : [];
      fetchedRef.current = true;
      setS((p) => ({ ...p, connected: true, results, lastSyncAt: d.syncedAt || new Date().toISOString(), error: '' }));
    } catch (e) {
      // A silent background refresh must not put an error banner in front of
      // someone mid-session.
      if (!silent) setS((p) => ({ ...p, error: humanizeError(e, 'concept2') }));
    } finally {
      busyRef.current = false;
      setS((p) => ({ ...p, busy: false }));
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const d = await call(FN.integrationsStatus);
      const connected = !!d.concept2?.connected;
      if (!connected) fetchedRef.current = false;
      setS((p) => ({
        ...p,
        loaded: true,
        connected,
        results: connected ? p.results : [],
        lastSyncAt: d.concept2?.lastSyncAt ?? null,
        error: '',
      }));

      // Status carries no result list by design — fetch it once, lazily.
      if (connected && !fetchedRef.current && !busyRef.current) void sync(true);
    } catch (e) {
      fetchedRef.current = false;
      setS((p) => ({
        ...p,
        loaded: true,
        connected: false,
        results: [],
        error: humanizeError(e, 'concept2'),
      }));
    }
  }, [sync]);

  // Re-ask on mount and whenever the signed-in identity changes: the connection
  // belongs to the account, so a different account is a different answer.
  useEffect(() => {
    void refresh();
  }, [refresh, user?.id]);

  /*
   * Coming back from the browser is the moment a connection becomes real.
   *
   * The return scheme is shared with WHOOP, so every Concept2 completion is
   * stamped with `integration=concept2` by the server — a URL without that
   * exact stamp belongs to another integration and is ignored here (WHOOP's
   * handler applies the mirror-image filter). `status` is the server's fixed
   * outcome word — read it for the message, then ask the server what it now
   * knows rather than believing the URL.
   *
   * getInitialURL covers the cold-start case: on a low-memory device the OS may
   * have killed the app while the athlete was on Concept2's consent screen, and
   * the deep link then arrives as the launch URL with no event to listen for.
   */
  const handleReturn = useCallback(
    (url: string | null) => {
      if (!url) return;
      if (!/[?&]integration=concept2\b/i.test(url)) return;
      const status = /[?&]status=([a-z_]+)/i.exec(url)?.[1] || '';
      if (status === 'denied') setS((p) => ({ ...p, error: 'Concept2 authorization was cancelled.' }));
      else if (status === 'error') setS((p) => ({ ...p, error: 'Concept2 could not be connected. Please try again.' }));
      else if (status === 'connected') setS((p) => ({ ...p, error: '' }));
      void refresh();
    },
    [refresh],
  );

  useEffect(() => {
    const sub = Linking.addEventListener('url', ({ url }) => handleReturn(url));
    void Linking.getInitialURL().then((url) => {
      if (url && /[?&]status=/.test(url)) handleReturn(url);
    });
    return () => sub.remove();
  }, [handleReturn]);

  const value = useMemo<Concept2Ctx>(
    () => ({
      ...s,
      /*
       * Ask the server to start an authorization, THEN open the browser — the
       * request carries the Supabase token, so the server has written down
       * which account this authorization belongs to before the consent screen
       * ever appears (see ./whoop.tsx for why the order is the whole fix).
       */
      connect: () => {
        void (async () => {
          setS((p) => ({ ...p, busy: true, error: '' }));
          try {
            if (!(await accessToken())) throw new Error(SIGN_IN_FIRST);
            const d = await call(FN.concept2Connect + '?client=native');
            const authorizeUrl = typeof d?.authorizeUrl === 'string' ? d.authorizeUrl : '';
            // Only ever hand the OS an https URL from our own server.
            if (!/^https:\/\//i.test(authorizeUrl)) throw new Error('Concept2 is unavailable right now.');
            await Linking.openURL(authorizeUrl);
          } catch (e) {
            setS((p) => ({ ...p, error: humanizeError(e, 'concept2') }));
          } finally {
            setS((p) => ({ ...p, busy: false }));
          }
        })();
      },
      sync,
      refresh,
      disconnect: async () => {
        setS((p) => ({ ...p, busy: true }));
        try {
          await call(FN.integrationsDisconnect + '?provider=concept2', { method: 'POST' });
        } catch {
          /* already gone, or offline — refresh below tells the truth either way */
        }
        fetchedRef.current = false;
        setS((p) => ({ ...p, busy: false, connected: false, results: [] }));
        await refresh();
      },
    }),
    [s, sync, refresh],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useConcept2(): Concept2Ctx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useConcept2 outside Concept2Provider');
  return c;
}
