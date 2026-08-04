import { LS_KEY } from './constants';
import { emptyDB, ensureSharedCore, sanitizeDB } from './db';
import type { EngineDB } from './types';

/**
 * The storage port.
 *
 * The engine never imports `localStorage`. Web fills this with localStorage,
 * React Native with MMKV — and tests with a plain object, which is the reason
 * the merge and sanitize paths are testable at all.
 *
 * Deliberately synchronous: the athlete app writes on every confirmed set, and
 * an async write here would mean a set could be lost between the tap and the
 * app being backgrounded.
 */
export interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}


export interface LoadResult {
  db: EngineDB;
  /** true when the stored blob was missing or unparseable and we fell back */
  recovered: boolean;
}

/**
 * Read the DB. A parse failure yields an EMPTY db rather than a throw — an
 * athlete opening the app to a crash screen has lost everything either way, but
 * an athlete opening it to an empty app can still restore from cloud.
 */
export function loadDB(storage: Storage, key = LS_KEY): LoadResult {
  try {
    const raw = storage.getItem(key);
    if (!raw) return { db: ensureSharedCore(emptyDB()), recovered: false };
    return { db: ensureSharedCore(sanitizeDB(JSON.parse(raw))), recovered: false };
  } catch {
    return { db: ensureSharedCore(emptyDB()), recovered: true };
  }
}

export function saveDB(storage: Storage, db: EngineDB, key = LS_KEY): boolean {
  try {
    storage.setItem(key, JSON.stringify(db));
    return true;
  } catch {
    // Quota, private mode, or a full disk. The caller surfaces this — silently
    // dropping a save is how a session's work disappears without a trace.
    return false;
  }
}

/** Stable per-device id, minted once and reused. Used by the device registry. */
export function deviceId(storage: Storage, key = LS_KEY + '-deviceId'): string {
  try {
    let d = storage.getItem(key);
    if (!d) {
      d = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
      storage.setItem(key, d);
    }
    return d;
  } catch {
    return 'local';
  }
}
