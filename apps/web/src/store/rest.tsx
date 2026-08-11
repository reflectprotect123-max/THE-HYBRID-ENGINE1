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

const forget = () => {
  try {
    localStorage.removeItem(REST_KEY);
    localStorage.removeItem(REST_TOT_KEY);
  } catch {
    /* nothing to clear */
  }
};

/**
 * What is left of a persisted rest. A rest that lapsed while the app was closed
 * is finished, not due: read back as a live end time it re-arms the zero-buzz —
 * so opening the app the morning after a session vibrates the phone — and
 * leaves the 250ms tick running for the life of the tab.
 */
const resume = (): { ends: number; total: number } => {
  const ends = readNum(REST_KEY);
  if (ends > Date.now()) return { ends, total: readNum(REST_TOT_KEY) };
  if (ends) forget();
  return { ends: 0, total: 0 };
};

export function RestProvider({ children }: { children: ReactNode }) {
  const [resumed] = useState(resume);
  const [ends, setEnds] = useState<number>(resumed.ends);
  const [total, setTotal] = useState<number>(resumed.total);
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
  // across the boundary. Dropping the end time is part of finishing: left in
  // place it keeps the tick alive and waits to buzz again on the next reload.
  useEffect(() => {
    if (!ends || running) return;
    if (!buzzed.current) {
      buzzed.current = true;
      try {
        navigator.vibrate?.([200, 100, 200]);
      } catch {
        /* no vibration on this device */
      }
      try {
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification('Rest complete', { body: 'Time for your next set.' });
        }
      } catch {
        /* notification unsupported or blocked on this device */
      }
    }
    setEnds(0);
    setTotal(0);
    forget();
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
    buzzed.current = true; // skipped, not elapsed — no buzz owed
    forget();
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
