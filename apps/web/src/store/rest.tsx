import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LS_KEY } from '@hybrid/engine';

/*
 * The rest timer.
 *
 * It survives a reload because the END TIME is persisted, not the remaining
 * seconds — a countdown held only in memory restarts at full whenever the
 * browser reclaims the tab, which on a phone in a gym is most of the time.
 *
 * A rest of Infinity (a bad import, or a coach snapshot with a broken rest
 * value) would never expire and would leave the stage stuck with no Finish Set
 * button, so the duration is clamped where it enters.
 */

const REST_KEY = LS_KEY + '-rest-ends';
const REST_TOT_KEY = LS_KEY + '-rest-total';

interface RestCtx {
  /** seconds remaining, 0 when idle */
  left: number;
  total: number;
  running: boolean;
  /** 0..1 remaining, for arcs and bars */
  frac: number;
  start: (sec: number) => void;
  add: (sec: number) => void;
  stop: () => void;
}

const Ctx = createContext<RestCtx | null>(null);

const readNum = (k: string) => {
  try {
    return Number(localStorage.getItem(k)) || 0;
  } catch {
    return 0;
  }
};

export function RestProvider({ children }: { children: ReactNode }) {
  const [ends, setEnds] = useState<number>(() => readNum(REST_KEY));
  const [total, setTotal] = useState<number>(() => readNum(REST_TOT_KEY));
  const [now, setNow] = useState(() => Date.now());
  const buzzed = useRef(false);

  const running = ends > now;
  const left = running ? Math.max(0, Math.ceil((ends - now) / 1000)) : 0;

  useEffect(() => {
    if (!ends) return;
    const iv = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(iv);
  }, [ends]);

  // Fire once at zero, then clear. `buzzed` guards the interval firing twice
  // across the boundary.
  useEffect(() => {
    if (!ends || running || buzzed.current) return;
    buzzed.current = true;
    try {
      navigator.vibrate?.([200, 100, 200]);
    } catch {
      /* no vibration on this device */
    }
  }, [ends, running]);

  const persist = (endsAt: number, tot: number) => {
    try {
      localStorage.setItem(REST_KEY, String(endsAt));
      localStorage.setItem(REST_TOT_KEY, String(tot));
    } catch {
      /* private mode: the timer still works, it just won't survive a reload */
    }
  };

  const start = useCallback((sec: number) => {
    const s = Number.isFinite(Number(sec)) ? Math.max(0, Math.min(3600, Number(sec))) : 0;
    if (!s) return;
    buzzed.current = false;
    const endsAt = Date.now() + s * 1000;
    setTotal(s);
    setEnds(endsAt);
    setNow(Date.now());
    persist(endsAt, s);
  }, []);

  const add = useCallback(
    (sec: number) => {
      if (!ends) return;
      const endsAt = ends + sec * 1000;
      const tot = total + sec;
      buzzed.current = false;
      setEnds(endsAt);
      setTotal(tot);
      persist(endsAt, tot);
    },
    [ends, total],
  );

  const stop = useCallback(() => {
    setEnds(0);
    setTotal(0);
    buzzed.current = false;
    try {
      localStorage.removeItem(REST_KEY);
      localStorage.removeItem(REST_TOT_KEY);
    } catch {
      /* nothing to clear */
    }
  }, []);

  const value = useMemo<RestCtx>(
    () => ({ left, total, running, frac: total > 0 ? Math.max(0, Math.min(1, left / total)) : 0, start, add, stop }),
    [left, total, running, start, add, stop],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRest(): RestCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useRest outside RestProvider');
  return c;
}
