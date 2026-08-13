import { LS_KEY, type Session } from '@hybrid/engine';
import type { LoggerHost } from './bridge';

/*
 * The same seam, for the parity harness only.
 *
 * Metro resolves `./bridge` here when bundling for web. It exists because the
 * native bridge reaches `store/rest.tsx`, which reaches
 * `native/capabilities.ts`, which imports react-native-ble-plx and
 * expo-location at the top level — a web export that touches any of that
 * cannot build. See `parity/README.md`.
 *
 * The session is read from `localStorage` under `@hybrid/engine`'s own
 * `LS_KEY`, which is exactly where `checks/parity/drive.mjs` seeds
 * `checks/fixtures/session.json` before it starts driving. Reading it directly
 * rather than through `store/storage.ts` is deliberate: that module falls back
 * to an in-memory shim when MMKV cannot load, and an in-memory shim cannot see
 * what the driver wrote from the outside.
 *
 * The three rest callbacks are no-ops. On a phone they arm the notification
 * the athlete gets while their screen is in their pocket; there is nothing for
 * that to mean here, and nothing in the parity vocabulary that could observe
 * it either way. The COUNTDOWN the gates do see is not this — it belongs to
 * the hook, and it runs identically on both platforms.
 */

function activeSessionFromStorage(): Session | null {
  try {
    const raw = globalThis.localStorage?.getItem(LS_KEY);
    if (!raw) return null;
    const db = JSON.parse(raw) as { sessions?: Session[] };
    return db.sessions?.find((s) => s.status === 'active') ?? null;
  } catch {
    return null;
  }
}

const noop = () => {};

/* Read once, then held. The driver seeds storage and then navigates, so the
 * page this runs in already has its session by the time anything mounts —
 * and a stable reference keeps the shell's `key={activeSession.id}` remount
 * rule meaning what it says. */
let cached: Session | null | undefined;

export function useLoggerHost(): LoggerHost {
  if (cached === undefined) cached = activeSessionFromStorage();
  return {
    activeSession: cached,
    updateSession: noop,
    startRest: noop,
    stopRest: noop,
    addRest: noop,
  };
}

/** No wake lock in the harness — nothing here is a training session. */
export function useWakeLock(): void {}
