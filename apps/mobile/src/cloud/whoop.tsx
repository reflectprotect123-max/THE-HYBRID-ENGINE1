import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Linking } from 'react-native';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { FN, SITE_ORIGIN, SUPABASE } from '@hybrid/config';
import { ymd, type WhoopSample } from '@hybrid/engine';
import { useDb } from '../store/db';
import { useSync } from './sync';
import { storage } from '../store/storage';
import { humanizeError } from '../errors';

/*
 * WHOOP, native edition.
 *
 * The client never touches WHOOP directly — the OAuth tokens live server-side
 * in the Netlify functions, and this only talks to those.
 *
 * WHAT USED TO BE WRONG, and why no amount of client-side work could fix it:
 * the functions identified a connection purely by the signed `hybrid_sid`
 * cookie they set. "Connect" handed the consent URL to the SYSTEM browser,
 * which has its own cookie jar — so the callback dutifully set the cookie on a
 * browser this app can never read from, and every request the app made arrived
 * with no cookie at all and was answered as a brand-new anonymous session. The
 * connection was real and permanently invisible.
 *
 * The fix is server-side and is an identity change, not a transport change: a
 * WHOOP connection is now filed under the SUPABASE USER, and this app proves
 * who it is with the Supabase access token it already holds for cloud sync.
 * The system browser is still where consent happens (it has to be — that is
 * where the athlete can see the address bar), but it no longer needs to carry
 * an identity, because the server wrote the identity down before the browser
 * was ever opened.
 *
 * Two consequences follow, and they are the only things that differ from web:
 *
 *  1. Every function URL must be ABSOLUTE — a phone has no origin.
 *  2. Every call carries `Authorization: Bearer <supabase access token>`.
 */

/* SITE_ORIGIN now lives in @hybrid/config alongside FN — a second copy of a
   deployment URL is exactly the mistake that package exists to prevent. */
const fnUrl = (path: string) => (/^https?:/i.test(path) ? path : SITE_ORIGIN + path);

/*
 * A SECOND, read-only Supabase client.
 *
 * The signed-in session lives in MMKV under gotrue's own key, and cloud sync
 * (./sync) owns the client that refreshes it. This instance exists only to READ
 * that session, so `autoRefreshToken` is off: two refresh loops rotating the
 * same refresh token is precisely how an athlete gets silently signed out. It
 * shares the storage key, so gotrue's own lock serialises the two instances,
 * and it sees whatever the sync client has already refreshed.
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

export interface WhoopState {
  loaded: boolean;
  connected: boolean;
  sample: WhoopSample | null;
  lastSyncAt: string | null;
  busy: boolean;
  error: string;
}

interface WhoopCtx extends WhoopState {
  connect: () => void;
  sync: (silent?: boolean) => Promise<void>;
  disconnect: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<WhoopCtx | null>(null);

const SIGN_IN_FIRST = 'Sign in to cloud sync first — WHOOP is linked to your account, not to this phone.';

/*
 * `cache: 'no-store'` is a no-op on RN's fetch, so freshness is asked for with
 * a header the function layer honours and a cache-busting param.
 *
 * Cookies are deliberately NOT sent. They were the bug: a cookie the app can
 * set is not the cookie the system browser held, and asking for one back only
 * ever produced a fresh anonymous session. Identity is the bearer token now.
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

export function WhoopProvider({ children }: { children: ReactNode }) {
  const { update, setWhoop } = useDb();
  // WhoopProvider is mounted INSIDE SyncProvider (see App.tsx). Reading the
  // signed-in user here is what makes the WHOOP card correct itself the moment
  // someone signs in, instead of waiting for the next cold start.
  const { user } = useSync();
  const [s, setS] = useState<WhoopState>({
    loaded: false,
    connected: false,
    sample: null,
    lastSyncAt: null,
    busy: false,
    error: '',
  });
  const busyRef = useRef(false);

  /**
   * Keep a rolling record of each day's recovery and strain.
   *
   * Stored under `whoopDaily`, which `cloudFp` deliberately EXCLUDES from the
   * sync fingerprint: it is device-local and re-derived, so including it would
   * churn a push on every WHOOP poll.
   */
  const recordDaily = useCallback(
    (sample: WhoopSample) => {
      const date = String((sample as { date?: string }).date || '').slice(0, 10);
      if (!date) return;
      const rec = Number(sample.recoveryScore);
      const str = Number(sample.strain);
      update((draft) => {
        const hist = Array.isArray(draft.settings.whoopDaily)
          ? (draft.settings.whoopDaily as { date: string; recovery: number | null; strain: number | null }[])
          : [];
        const row = {
          date,
          recovery: Number.isFinite(rec) ? rec : null,
          strain: Number.isFinite(str) ? str : null,
        };
        const i = hist.findIndex((h) => h.date === date);
        if (i >= 0) hist[i] = row;
        else hist.push(row);
        hist.sort((a, b) => a.date.localeCompare(b.date));
        draft.settings.whoopDaily = hist.slice(-120);
      });
    },
    [update],
  );

  const apply = useCallback(
    (sample: WhoopSample | null) => {
      setWhoop(sample);
      if (sample) recordDaily(sample);
    },
    [setWhoop, recordDaily],
  );

  const sync = useCallback(
    async (silent = false) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setS((p) => ({ ...p, busy: true }));
      try {
        const d = await call(FN.whoopSync);
        if (d.connected === false) throw new Error('WHOOP is not connected.');
        if (d.normalized) apply(d.normalized as WhoopSample);
        setS((p) => ({ ...p, lastSyncAt: new Date().toISOString(), error: '' }));
      } catch (e) {
        // A silent background refresh must not put an error banner in front of
        // someone mid-session.
        if (!silent) setS((p) => ({ ...p, error: humanizeError(e, 'whoop') }));
      } finally {
        busyRef.current = false;
        setS((p) => ({ ...p, busy: false }));
      }
    },
    [apply],
  );

  const refresh = useCallback(async () => {
    try {
      const d = await call(FN.integrationsStatus);
      const connected = !!d.whoop?.connected;
      const sample = (d.whoop?.normalized ?? null) as WhoopSample | null;
      apply(sample);
      setS((p) => ({ ...p, loaded: true, connected, sample, lastSyncAt: d.whoop?.lastSyncAt ?? null, error: '' }));

      // Keep today's card fresh without the user having to ask.
      if (connected && !busyRef.current) {
        const stale = !sample || String((sample as { date?: string }).date || '').slice(0, 10) !== ymd(new Date());
        if (stale) void sync(true);
      }
    } catch (e) {
      apply(null);
      setS((p) => ({
        ...p,
        loaded: true,
        connected: false,
        sample: null,
        error: humanizeError(e, 'whoop'),
      }));
    }
  }, [apply, sync]);

  // Re-ask on mount and whenever the signed-in identity changes: the connection
  // belongs to the account, so a different account is a different answer.
  useEffect(() => {
    void refresh();
  }, [refresh, user?.id]);

  /*
   * Coming back from the browser is the moment a connection becomes real.
   *
   * The callback redirects to this app's own URL scheme, which is the only way
   * the system browser can hand control back. `status` is the server's fixed
   * outcome word — read it for the message, then ask the server what it now
   * knows rather than believing the URL.
   *
   * getInitialURL covers the cold-start case: on a low-memory device the OS may
   * have killed the app while the athlete was on WHOOP's consent screen, and
   * the deep link then arrives as the launch URL with no event to listen for.
   */
  const handleReturn = useCallback(
    (url: string | null) => {
      if (!url) return;
      // The return scheme is shared by every integration; only Concept2 (and
      // any later provider) stamps its URL with `integration=`. WHOOP's own
      // callback sends none, so a URL WITHOUT the param is still WHOOP's.
      if (/[?&]integration=(?!whoop\b)[a-z_]+/i.test(url)) return;
      const status = /[?&]status=([a-z_]+)/i.exec(url)?.[1] || '';
      if (status === 'denied') setS((p) => ({ ...p, error: 'WHOOP authorization was cancelled.' }));
      else if (status === 'error') setS((p) => ({ ...p, error: 'WHOOP could not be connected. Please try again.' }));
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

  const value = useMemo<WhoopCtx>(
    () => ({
      ...s,
      /*
       * Ask the server to start an authorization, THEN open the browser.
       *
       * The order matters and is the whole fix. The request carries the
       * Supabase token, so by the time WHOOP's consent screen appears the
       * server has already written down which account this authorization
       * belongs to, keyed by a single-use `state`. The browser only has to come
       * back — it does not have to be recognised.
       */
      connect: () => {
        void (async () => {
          setS((p) => ({ ...p, busy: true, error: '' }));
          try {
            if (!(await accessToken())) throw new Error(SIGN_IN_FIRST);
            const d = await call(FN.whoopConnect + '?client=native');
            const authorizeUrl = typeof d?.authorizeUrl === 'string' ? d.authorizeUrl : '';
            // Only ever hand the OS an https URL from our own server.
            if (!/^https:\/\//i.test(authorizeUrl)) throw new Error('WHOOP is unavailable right now.');
            await Linking.openURL(authorizeUrl);
          } catch (e) {
            setS((p) => ({ ...p, error: humanizeError(e, 'whoop') }));
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
          await call(FN.integrationsDisconnect + '?provider=whoop', { method: 'POST' });
        } catch {
          /* already gone, or offline — refresh below tells the truth either way */
        }
        apply(null);
        setS((p) => ({ ...p, busy: false, connected: false, sample: null }));
        await refresh();
      },
    }),
    [s, sync, refresh, apply],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWhoop(): WhoopCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useWhoop outside WhoopProvider');
  return c;
}
