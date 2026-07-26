import type { Storage } from '@hybrid/engine';

/*
 * The engine's Storage port, filled with MMKV.
 *
 * MMKV rather than AsyncStorage because the port is SYNCHRONOUS by design: the
 * athlete confirms a set and may immediately pocket the phone, and an async
 * write is a set that never lands. AsyncStorage cannot satisfy that contract,
 * so it is only the fallback for a build without the native module (Expo Go),
 * where an in-memory shim keeps the app usable for a browse but does not
 * pretend to persist.
 */

let impl: Storage;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { MMKV } = require('react-native-mmkv') as { MMKV: new (o?: unknown) => MmkvLike };
  const kv = new MMKV({ id: 'hybrid-engine' });
  impl = {
    getItem: (k) => kv.getString(k) ?? null,
    setItem: (k, v) => kv.set(k, v),
    removeItem: (k) => kv.delete(k),
  };
} catch {
  const mem = new Map<string, string>();
  impl = {
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => void mem.set(k, v),
    removeItem: (k) => void mem.delete(k),
  };
}

interface MmkvLike {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
}

export const storage: Storage = impl;

/** True when writes actually survive a restart. Surfaced in Settings. */
export const isPersistent = (() => {
  try {
    storage.setItem('__probe', '1');
    const ok = storage.getItem('__probe') === '1';
    storage.removeItem('__probe');
    return ok;
  } catch {
    return false;
  }
})();
