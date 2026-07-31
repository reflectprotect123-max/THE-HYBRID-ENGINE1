import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FN } from '@hybrid/config';
import { type Concept2Result } from '@hybrid/engine';
import { humanizeError } from '../errors';

/*
 * Concept2 Logbook.
 *
 * The browser never touches Concept2 directly — the OAuth tokens live
 * server-side in the Netlify functions, and this only talks to those. That is
 * why every request is same-origin with no key, and why "connect" is a
 * full-page redirect rather than a fetch.
 *
 * Unlike WHOOP's single daily sample, a sync returns a LIST of logged results
 * (rower, SkiErg, BikeErg). The status poll deliberately does NOT carry that
 * list — it can be hundreds of records — so `refresh` only learns
 * connected/lastSyncAt and the first `sync` fetches the results themselves.
 * Nothing here writes to the training database: matching results to sessions
 * belongs to a later layer, so this provider is state + fetch and no more.
 */

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

const get = async (url: string, init?: RequestInit) => {
  const r = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...init });
  if (!r.ok) throw new Error('Request failed (' + r.status + ')');
  return r.json();
};

export function Concept2Provider({ children }: { children: ReactNode }) {
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
      const d = await get(FN.concept2Sync);
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
      const d = await get(FN.integrationsStatus);
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

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<Concept2Ctx>(
    () => ({
      ...s,
      // A full-page redirect, not a fetch: the OAuth handshake has to happen in
      // the browser's address bar or Concept2 will not accept it.
      connect: () => {
        window.location.href = FN.concept2Connect;
      },
      sync,
      refresh,
      disconnect: async () => {
        setS((p) => ({ ...p, busy: true }));
        try {
          await fetch(FN.integrationsDisconnect + '?provider=concept2', {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
          });
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
