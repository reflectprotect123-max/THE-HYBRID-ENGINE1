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

const num = (k: string) => Number(storage.getItem(k)) || 0;
const str = (k: string) => storage.getItem(k) || '';

const forget = () => {
  storage.removeItem(TIMER_KEY);
  storage.removeItem(TIMER_TOT_KEY);
  storage.removeItem(TIMER_OWNER_KEY);
};

/*
 * What survives a cold start — the same contract as web's `resume()`.
 *
 * An END TIME already in the past is not a timer, it is litter: seeding `total`
 * from it left the provider claiming a 30s hold that expired while the app was
 * closed, with `frac` computed off it. An expired record is discarded and its
 * keys cleared here, in one place, rather than half-cleared later by the
 * zero-effect (which must NOT touch `total` — see below).
 */
const resume = (): { ends: number; total: number; owner: string } => {
  const ends = num(TIMER_KEY);
  if (ends > Date.now()) return { ends, total: num(TIMER_TOT_KEY), owner: str(TIMER_OWNER_KEY) };
  if (ends) forget();
  return { ends: 0, total: 0, owner: '' };
};

export function SetTimerProvider({ children }: { children: ReactNode }) {
  const [resumed] = useState(resume);
  const [ends, setEnds] = useState(resumed.ends);
  const [total, setTotal] = useState(resumed.total);
  const [owner, setOwner] = useState(resumed.owner);
  const [now, setNow] = useState(() => Date.now());
  const [finished, setFinished] = useState(false);
  /* A hold that had already elapsed while the app was closed must NOT buzz on
     the next cold start — the athlete gets a vibration for a stretch they
     finished yesterday. `resume()` above guarantees `ends` is either 0 (the
     zero-effect never runs) or genuinely in the future, so this starts false
     exactly as it does on web. */
  const buzzed = useRef(false);

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

  // Fires once at zero. Deliberately does NOT clear `total` or `owner` here —
  // the consumer needs both after `finished` flips true, and clears them
  // itself via ack(). A cold start on an already-expired record is handled by
  // `resume()` instead, which never lets this effect see it.
  useEffect(() => {
    if (!ends || running) return;
    if (!buzzed.current) {
      buzzed.current = true;
      buzz();
      setFinished(true);
    }
    setEnds(0);
    forget();
  }, [ends, running]);

  const persist = (endsAt: number, tot: number, own: string) => {
    storage.setItem(TIMER_KEY, String(endsAt));
    storage.setItem(TIMER_TOT_KEY, String(tot));
    storage.setItem(TIMER_OWNER_KEY, own);
  };

  const start = useCallback((sec: number, own = '') => {
    // A hold of Infinity — from a bad import or a broken coach snapshot —
    // would never expire and would survive every restart, leaving the stage
    // stuck with no Finish Set button.
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
