import { useEffect } from 'react';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import type { Session } from '@hybrid/engine';
import { useDb } from '../../store/db';
import { useRest } from '../../store/rest';

/*
 * Everything the logger needs from the APP, behind one seam.
 *
 * The seam exists because of the parity harness. `store/rest.tsx` reaches
 * `native/capabilities.ts` for the rest alarm, and that module imports
 * react-native-ble-plx and expo-location at the top level — neither has a web
 * implementation, so a web export that touches this file cannot build. Metro
 * resolves `./bridge` to `bridge.web.ts` on web, and that file wires the same
 * shape to the fixture and to no-ops.
 *
 * What that costs, stated plainly: the gates judge the SCREENS, not this
 * bridge. Persistence, the rest notification and the wake lock are app
 * plumbing, they have no counterpart in the prototype, and there is nothing in
 * the parity vocabulary that could observe them. They are covered by this
 * file's own colocated test instead.
 *
 * Nothing here decides anything about a session. It hands the shell five
 * callables and gets out of the way.
 */

export interface LoggerHost {
  /** The session to run, or null when none is live. */
  activeSession: Session | null;
  updateSession: (id: string, fn: (s: Session) => void | false) => void;
  /** Arm the store that owns the rest-complete notification and the chip. */
  startRest: (seconds: number) => void;
  stopRest: () => void;
  addRest: (seconds: number) => void;
}

export function useLoggerHost(): LoggerHost {
  const { activeSession, updateSession } = useDb();
  const { start: startRest, stop: stopRest, add: addRest } = useRest();
  return { activeSession, updateSession, startRest, stopRest, addRest };
}

/**
 * Keep the screen awake for the life of the caller.
 *
 * `expo-keep-awake` rather than the web's `navigator.wakeLock`, and the same
 * ownership rule `Logger.tsx` used: whether a session is running is decided by
 * whether the logger is mounted at all, one level up, so this hook takes no
 * argument.
 *
 * `activateKeepAwakeAsync` is awaited into a cancellation flag rather than
 * fired and forgotten: an unmount that lands before the promise settles would
 * otherwise leave the phone awake with nothing on screen holding it.
 */
export function useWakeLock(): void {
  useEffect(() => {
    let cancelled = false;
    activateKeepAwakeAsync(TAG)
      .then(() => {
        if (cancelled) deactivateKeepAwake(TAG);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      try {
        deactivateKeepAwake(TAG);
      } catch {
        // Deactivating a tag that never activated is not an error worth
        // surfacing to an athlete mid-session.
      }
    };
  }, []);
}

/** Namespaced so this screen's lock cannot be released by another one's. */
const TAG = 'hybrid-session-logger';
