import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LS_KEY } from '@hybrid/engine';
import { storage } from './storage';
import { buzz, cancelRestAlarm, scheduleRestAlarm } from '../native/capabilities';

/*
 * The rest timer, native edition.
 *
 * Same rule as on the web: persist the END TIME, never the remaining seconds,
 * so backgrounding the app cannot restart the countdown. The addition here is a
 * scheduled NOTIFICATION — this is the whole reason the native app matters for
 * this feature. JS timers do not fire reliably with the screen off, so on the
 * old WebView build the buzz had to be scheduled natively too. A rest timer
 * that only works while you are staring at it is not a rest timer.
 */

const REST_KEY = LS_KEY + '-rest-ends';
const REST_TOT_KEY = LS_KEY + '-rest-total';
const REST_ALARM_KEY = LS_KEY + '-rest-alarm';

interface RestCtx {
  left: number;
  total: number;
  running: boolean;
  frac: number;
  start: (sec: number) => void;
  add: (sec: number) => void;
  stop: () => void;
}

const Ctx = createContext<RestCtx | null>(null);

const num = (k: string) => Number(storage.getItem(k)) || 0;

export function RestProvider({ children }: { children: ReactNode }) {
  const [ends, setEnds] = useState(() => num(REST_KEY));
  const [total, setTotal] = useState(() => num(REST_TOT_KEY));
  const [now, setNow] = useState(() => Date.now());
  const buzzed = useRef(false);

  const running = ends > now;
  const left = running ? Math.max(0, Math.ceil((ends - now) / 1000)) : 0;

  useEffect(() => {
    if (!ends) return;
    const iv = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(iv);
  }, [ends]);

  useEffect(() => {
    if (!ends || running || buzzed.current) return;
    buzzed.current = true;
    buzz();
  }, [ends, running]);

  const persist = (endsAt: number, tot: number) => {
    storage.setItem(REST_KEY, String(endsAt));
    storage.setItem(REST_TOT_KEY, String(tot));
  };

  const rearm = useCallback(async (sec: number) => {
    await cancelRestAlarm(storage.getItem(REST_ALARM_KEY));
    const id = await scheduleRestAlarm(sec);
    if (id) storage.setItem(REST_ALARM_KEY, id);
    else storage.removeItem(REST_ALARM_KEY);
  }, []);

  const start = useCallback(
    (sec: number) => {
      // A rest of Infinity — from a bad import or a broken coach snapshot —
      // would never expire and would survive every restart, leaving the stage
      // stuck with no Finish Set button.
      const s = Number.isFinite(Number(sec)) ? Math.max(0, Math.min(3600, Number(sec))) : 0;
      if (!s) return;
      buzzed.current = false;
      const endsAt = Date.now() + s * 1000;
      setTotal(s);
      setEnds(endsAt);
      setNow(Date.now());
      persist(endsAt, s);
      void rearm(s);
    },
    [rearm],
  );

  const add = useCallback(
    (sec: number) => {
      if (!ends) return;
      const endsAt = ends + sec * 1000;
      buzzed.current = false;
      setEnds(endsAt);
      setTotal(total + sec);
      persist(endsAt, total + sec);
      void rearm(Math.max(1, Math.ceil((endsAt - Date.now()) / 1000)));
    },
    [ends, total, rearm],
  );

  const stop = useCallback(() => {
    setEnds(0);
    setTotal(0);
    buzzed.current = false;
    storage.removeItem(REST_KEY);
    storage.removeItem(REST_TOT_KEY);
    void cancelRestAlarm(storage.getItem(REST_ALARM_KEY));
    storage.removeItem(REST_ALARM_KEY);
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
