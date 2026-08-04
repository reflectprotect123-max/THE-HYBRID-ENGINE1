import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FN } from '@hybrid/config';
import { ensureSharedCore, ymd, type WhoopSample } from '@hybrid/engine';
import { useDb } from '../store/db';
import { humanizeError } from '../errors';

/*
 * WHOOP.
 *
 * The browser never touches WHOOP directly — the OAuth tokens live server-side
 * in the existing Netlify functions, and this only talks to those. That is why
 * every request is same-origin with no key, and why "connect" is a full-page
 * redirect rather than a fetch.
 */

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

const get = async (url: string, init?: RequestInit) => {
  const r = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...init });
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
      const hrv = Number(sample.hrvMs);
      const rhr = Number(sample.restingHr);
      const sleep = Number(sample.sleepPerformance);
      update((draft) => {
        const hist = Array.isArray(draft.settings.whoopDaily)
          ? (draft.settings.whoopDaily as { date: string; recovery: number | null; strain: number | null; hrvMs?: number | null; restingHr?: number | null; sleepPerformance?: number | null }[])
          : [];
        const row = {
          date,
          recovery: Number.isFinite(rec) ? rec : null,
          strain: Number.isFinite(str) ? str : null,
          hrvMs: Number.isFinite(hrv) ? hrv : null,
          restingHr: Number.isFinite(rhr) ? rhr : null,
          sleepPerformance: Number.isFinite(sleep) ? sleep : null,
        };
        const i = hist.findIndex((h) => h.date === date);
        if (i >= 0) hist[i] = row;
        else hist.push(row);
        hist.sort((a, b) => a.date.localeCompare(b.date));
        draft.settings.whoopDaily = hist.slice(-365);

        const core = draft.core || ensureSharedCore(draft).core!;
        const coreRows = core.whoopDaily.slice();
        const coreRow = {
          date,
          recoveryScore: Number.isFinite(rec) ? rec : null,
          strain: Number.isFinite(str) ? str : null,
          hrvMs: Number.isFinite(hrv) ? hrv : null,
          restingHr: Number.isFinite(rhr) ? rhr : null,
          sleepPerformance: Number.isFinite(sleep) ? sleep : null,
          capturedAt: sample.capturedAt,
          source: sample.source || 'whoop',
        };
        const ci = coreRows.findIndex((x) => x.date === date);
        if (ci >= 0) coreRows[ci] = coreRow;
        else coreRows.push(coreRow);
        coreRows.sort((a, b) => a.date.localeCompare(b.date));
        draft.core = { ...core, whoopDaily: coreRows.slice(-365), updatedAt: Date.now() };
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
        error: humanizeError(e, 'whoop'),
      }));
    }
  }, [apply, sync]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<WhoopCtx>(
    () => ({
      ...s,
      // A full-page redirect, not a fetch: the OAuth handshake has to happen in
      // the browser's address bar or WHOOP will not accept it.
      connect: () => {
        window.location.href = FN.whoopConnect;
      },
      sync,
      refresh,
      disconnect: async () => {
        setS((p) => ({ ...p, busy: true }));
        try {
          await fetch(FN.integrationsDisconnect + '?provider=whoop', {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
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
