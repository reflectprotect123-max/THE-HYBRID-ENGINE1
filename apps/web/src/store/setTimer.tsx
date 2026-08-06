import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LS_KEY } from '@hybrid/engine';

/*
 * The set timer — a live countdown for `seconds`-mode holds (stretches, planks).
 *
 * Mirrors the rest timer's end-timestamp approach for the same reason: a
 * countdown held only in memory restarts at full whenever the browser
 * reclaims the tab. Kept as its own provider rather than folded into
 * useRest because the two can be live at once and complete differently —
 * rest expiring just buzzes, this one hands back the seconds held so the
 * Logger can write them into the set.
 */

const TIMER_KEY = LS_KEY + '-set-timer-ends';
const TIMER_TOT_KEY = LS_KEY + '-set-timer-total';
const TIMER_OWNER_KEY = LS_KEY + '-set-timer-owner';

interface SetTimerCtx {
  left: number;
  total: number;
  running: boolean;
  frac: number;
  /** true for the render where the timer reaches zero naturally; the
   *  consumer must read `total`, act on it, then call ack(). */
  finished: boolean;
  /**
   * Who armed the running (or just-finished) hold — whatever identity `start`
   * was called with, '' if none.
   *
   * A completed hold sits here with `finished`/`total` set until SOMEONE acks
   * it, and the athlete may well have moved on by then. Without a name on it,
   * the next field to mount claims a duration it never counted. The owner is
   * how a consumer asks "is this MINE?" before writing it anywhere.
   */
  owner: string;
  start: (sec: number, owner?: string) => void;
  /** stop early; returns the seconds actually held */
  stop: () => number;
  /** clears `finished`/`total`/`owner` once the caller has captured the completed duration */
  ack: () => void;
}

const Ctx = createContext<SetTimerCtx | null>(null);

const readNum = (k: string) => {
  try {
    return Number(localStorage.getItem(k)) || 0;
  } catch {
    return 0;
  }
};

const readStr = (k: string) => {
  try {
    return localStorage.getItem(k) || '';
  } catch {
    return '';
  }
};

const forget = () => {
  try {
    localStorage.removeItem(TIMER_KEY);
    localStorage.removeItem(TIMER_TOT_KEY);
    localStorage.removeItem(TIMER_OWNER_KEY);
  } catch {
    /* nothing to clear */
  }
};

const resume = (): { ends: number; total: number; owner: string } => {
  const ends = readNum(TIMER_KEY);
  if (ends > Date.now()) return { ends, total: readNum(TIMER_TOT_KEY), owner: readStr(TIMER_OWNER_KEY) };
  if (ends) forget();
  return { ends: 0, total: 0, owner: '' };
};

export function SetTimerProvider({ children }: { children: ReactNode }) {
  const [resumed] = useState(resume);
  const [ends, setEnds] = useState<number>(resumed.ends);
  const [total, setTotal] = useState<number>(resumed.total);
  const [owner, setOwner] = useState<string>(resumed.owner);
  const [now, setNow] = useState(() => Date.now());
  const [finished, setFinished] = useState(false);
  const buzzed = useRef(false);

  const running = ends > now;
  const left = running ? Math.max(0, Math.ceil((ends - now) / 1000)) : 0;

  useEffect(() => {
    if (!ends) return;
    const iv = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(iv);
  }, [ends]);

  // Fires once at zero. Deliberately does NOT clear `total` or `owner` here
  // (unlike rest.tsx's equivalent effect) — the consumer needs both after
  // `finished` flips true, and clears them itself via ack().
  useEffect(() => {
    if (!ends || running) return;
    if (!buzzed.current) {
      buzzed.current = true;
      try {
        navigator.vibrate?.([200, 100, 200]);
      } catch {
        /* no vibration on this device */
      }
      setFinished(true);
    }
    setEnds(0);
    forget();
  }, [ends, running]);

  const persist = (endsAt: number, tot: number, own: string) => {
    try {
      localStorage.setItem(TIMER_KEY, String(endsAt));
      localStorage.setItem(TIMER_TOT_KEY, String(tot));
      localStorage.setItem(TIMER_OWNER_KEY, own);
    } catch {
      /* private mode: the timer still works, it just won't survive a reload */
    }
  };

  const start = useCallback((sec: number, own = '') => {
    const s = Number.isFinite(Number(sec)) ? Math.max(0, Math.min(3600, Number(sec))) : 0;
    if (!s) return;
    buzzed.current = false;
    setFinished(false);
    const endsAt = Date.now() + s * 1000;
    setTotal(s);
    setOwner(own);
    setEnds(endsAt);
    setNow(Date.now());
    persist(endsAt, s, own);
  }, []);

  const stop = useCallback((): number => {
    const heldSec = total > 0 ? Math.max(0, total - Math.max(0, Math.ceil((ends - Date.now()) / 1000))) : 0;
    setEnds(0);
    setTotal(0);
    setOwner('');
    setFinished(false);
    buzzed.current = true; // skipped, not elapsed — no buzz owed
    forget();
    return heldSec;
  }, [ends, total]);

  const ack = useCallback(() => {
    setFinished(false);
    setTotal(0);
    setOwner('');
  }, []);

  const value = useMemo<SetTimerCtx>(
    () => ({
      left,
      total,
      running,
      frac: total > 0 ? Math.max(0, Math.min(1, left / total)) : 0,
      finished,
      owner,
      start,
      stop,
      ack,
    }),
    [left, total, running, finished, owner, start, stop, ack],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSetTimer(): SetTimerCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSetTimer outside SetTimerProvider');
  return c;
}
