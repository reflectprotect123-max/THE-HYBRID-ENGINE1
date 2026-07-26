import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Linking } from 'react-native';
import { FN, SITE_ORIGIN } from '@hybrid/config';
import { ymd, type WhoopSample } from '@hybrid/engine';
import { useDb } from '../store/db';

/*
 * WHOOP, native edition.
 *
 * The client never touches WHOOP directly — the OAuth tokens live server-side
 * in the existing Netlify functions, and this only talks to those. On the web
 * that means same-origin fetches with no key. A phone has no origin, so the two
 * things that change here are both consequences of that:
 *
 *  1. Every function URL must be ABSOLUTE.
 *  2. "Connect" cannot be a `window.location` assignment, because there is no
 *     address bar to redirect. It hands the URL to the OS instead.
 */

/* SITE_ORIGIN now lives in @hybrid/config alongside FN — a second copy of a
   deployment URL is exactly the mistake that package exists to prevent. */
const fnUrl = (path: string) => (/^https?:/i.test(path) ? path : SITE_ORIGIN + path);

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

/*
 * `credentials: 'include'` rather than 'same-origin': the functions identify a
 * connection purely by the signed `hybrid_sid` cookie they set, and from a
 * phone every one of these calls is cross-origin, where 'same-origin' would
 * strip it. React Native's fetch is backed by the platform HTTP stack, so that
 * cookie is stored and replayed by the OS without any work here.
 *
 * `cache: 'no-store'` is a no-op on RN's fetch, so freshness is asked for with
 * a header the function layer honours and a cache-busting param.
 */
const get = async (url: string, init?: RequestInit) => {
  const u = fnUrl(url);
  const bust = (u.includes('?') ? '&' : '?') + '_=' + Date.now();
  const r = await fetch(u + bust, {
    credentials: 'include',
    headers: { accept: 'application/json', 'cache-control': 'no-store' },
    ...init,
  });
  if (!r.ok) throw new Error('Request failed (' + r.status + ')');
  return r.json();
};

export function WhoopProvider({ children }: { children: ReactNode }) {
  const { update, setWhoop } = useDb();
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
        const d = await get(FN.whoopSync);
        if (d.connected === false) throw new Error('WHOOP is not connected.');
        if (d.normalized) apply(d.normalized as WhoopSample);
        setS((p) => ({ ...p, lastSyncAt: new Date().toISOString(), error: '' }));
      } catch (e) {
        // A silent background refresh must not put an error banner in front of
        // someone mid-session.
        if (!silent) setS((p) => ({ ...p, error: String((e as Error)?.message || e) }));
      } finally {
        busyRef.current = false;
        setS((p) => ({ ...p, busy: false }));
      }
    },
    [apply],
  );

  const refresh = useCallback(async () => {
    try {
      const d = await get(FN.integrationsStatus);
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
        error: String((e as Error)?.message || e),
      }));
    }
  }, [apply, sync]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /*
   * Coming back from the browser is the moment a connection becomes real, and
   * nothing in the app is told about it — so the returning foreground event is
   * the trigger for re-asking the server what it now knows.
   */
  useEffect(() => {
    const sub = Linking.addEventListener('url', () => {
      void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const value = useMemo<WhoopCtx>(
    () => ({
      ...s,
      /*
       * Hand the URL to the OS, not to a fetch.
       *
       * The web app assigns `window.location.href` because WHOOP's consent
       * screen has to be rendered where the user can see and trust the address
       * bar — an XHR would only get an opaque redirect. Native has no location
       * to assign, so the equivalent is Linking.openURL, which opens the URL in
       * the system browser; WHOOP redirects back to the function's callback,
       * which sets the session cookie and lands on the site.
       */
      connect: () => {
        void Linking.openURL(fnUrl(FN.whoopConnect)).catch((e) =>
          setS((p) => ({ ...p, error: String((e as Error)?.message || e) })),
        );
      },
      sync,
      refresh,
      disconnect: async () => {
        setS((p) => ({ ...p, busy: true }));
        try {
          await fetch(fnUrl(FN.integrationsDisconnect) + '?provider=whoop', {
            method: 'POST',
            credentials: 'include',
            headers: { 'cache-control': 'no-store' },
          });
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
