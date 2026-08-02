import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LS_KEY } from '@hybrid/engine';
import { storage } from './storage';
import { buzz } from '../native/capabilities';

/*
 * The set timer, native edition — a live countdown for `seconds`-mode holds
 * (stretches, planks). Mirrors rest.tsx's end-timestamp approach for the same
 * reason: a countdown held only in memory restarts at full whenever the app
 * is backgrounded and resumed.
 *
 * Deliberately does NOT schedule a native alarm the way the rest timer does
 * (no rearm/scheduleRestAlarm/cancelRestAlarm here). An athlete holding a
 * stretch is actively watching the screen — unlike resting between heavy
 * sets, there is no need for this countdown to survive the app being
 * backgrounded.
 *
 * Kept as its own provider rather than folded into useRest because the two
 * can be live at once and complete differently — rest expiring just buzzes,
 * this one hands back the seconds held so the Logger can write them into the
 * set.
 */

const TIMER_KEY = LS_KEY + '-set-timer-ends';
const TIMER_TOT_KEY = LS_KEY + '-set-timer-total';

interface SetTimerCtx {
  left: number;
  total: number;
  running: boolean;
  frac: number;
  /** true for the render where the timer reaches zero naturally; the
   *  consumer must read `total`, act on it, then call ack(). */
  finished: boolean;
  start: (sec: number) => void;
  /** stop early; returns the seconds actually held */
  stop: () => number;
  /** clears `finished`/`total` once the caller has captured the completed duration */
  ack: () => void;
}

const Ctx = createContext<SetTimerCtx | null>(null);

const num = (k: string) => Number(storage.getItem(k)) || 0;

export function SetTimerProvider({ children }: { children: ReactNode }) {
  const [ends, setEnds] = useState(() => num(TIMER_KEY));
  const [total, setTotal] = useState(() => num(TIMER_TOT_KEY));
  const [now, setNow] = useState(() => Date.now());
  const [finished, setFinished] = useState(false);
  /* Seeded from what was on disk. A hold that had already elapsed while the
     app was closed must NOT buzz on the next cold start — the athlete gets a
     vibration for a stretch they finished yesterday. */
  const buzzed = useRef(num(TIMER_KEY) <= Date.now());

  const running = ends > now;
  const left = running ? Math.max(0, Math.ceil((ends - now) / 1000)) : 0;

  useEffect(() => {
    // `running`, not `ends`: `ends` stays set after the timer expires, so
    // keying off it left a 250ms setState looping — and re-rendering every
    // consumer of this context — for the rest of the app's life.
    if (!running) return;
    const iv = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(iv);
  }, [running]);

  useEffect(() => {
    if (!ends || running) return;
    if (!buzzed.current) {
      buzzed.current = true;
      buzz();
      setFinished(true);
    }
    setEnds(0);
    storage.removeItem(TIMER_KEY);
    storage.removeItem(TIMER_TOT_KEY);
  }, [ends, running]);

  const persist = (endsAt: number, tot: number) => {
    storage.setItem(TIMER_KEY, String(endsAt));
    storage.setItem(TIMER_TOT_KEY, String(tot));
  };

  const start = useCallback((sec: number) => {
    // A hold of Infinity — from a bad import or a broken coach snapshot —
    // would never expire and would survive every restart, leaving the stage
    // stuck with no Finish Set button.
    const s = Number.isFinite(Number(sec)) ? Math.max(0, Math.min(3600, Number(sec))) : 0;
    if (!s) return;
    buzzed.current = false;
    setFinished(false);
    const endsAt = Date.now() + s * 1000;
    setTotal(s);
    setEnds(endsAt);
    setNow(Date.now());
    persist(endsAt, s);
  }, []);

  const stop = useCallback((): number => {
    const heldSec = total > 0 ? Math.max(0, total - Math.max(0, Math.ceil((ends - Date.now()) / 1000))) : 0;
    setEnds(0);
    setTotal(0);
    setFinished(false);
    buzzed.current = true; // skipped, not elapsed — no buzz owed
    storage.removeItem(TIMER_KEY);
    storage.removeItem(TIMER_TOT_KEY);
    return heldSec;
  }, [ends, total]);

  const ack = useCallback(() => {
    setFinished(false);
    setTotal(0);
  }, []);

  const value = useMemo<SetTimerCtx>(
    () => ({
      left,
      total,
      running,
      frac: total > 0 ? Math.max(0, Math.min(1, left / total)) : 0,
      finished,
      start,
      stop,
      ack,
    }),
    [left, total, running, finished, start, stop, ack],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSetTimer(): SetTimerCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSetTimer outside SetTimerProvider');
  return c;
}
