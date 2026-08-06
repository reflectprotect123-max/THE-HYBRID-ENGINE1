import { useSyncExternalStore } from 'react';
import type { ProductId } from '@hybrid/product-scope';
import { storage } from './store/storage';

/**
 * Which world the athlete is in. A view preference, NOT training data — its
 * own storage key, never a field on EngineDB, invisible to sync (a merge must
 * never have to resolve "which tab was I on"). Fresh installs open in
 * Strength; after that the last-used world wins on this device.
 */

const KEY = 'hybrid-active-discipline-v1';

let active: ProductId = load();
const listeners = new Set<() => void>();

function load(): ProductId {
  try {
    const raw = storage.getItem(KEY);
    if (raw === 'strength' || raw === 'conditioning') return raw;
  } catch {
    /* unreadable storage — fall through to the default */
  }
  return 'strength';
}

export function useDiscipline(): ProductId {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => active,
    () => 'strength',
  );
}

export function setDiscipline(next: ProductId): void {
  if (next === active) return;
  active = next;
  try {
    storage.setItem(KEY, next);
  } catch {
    /* storage failed — the switch still holds for this run */
  }
  listeners.forEach((l) => l());
}

/** Non-reactive read, for code outside React. */
export function currentDiscipline(): ProductId {
  return active;
}

/** Which discipline a session belongs to. `kind` is the engine's own split. */
export function disciplineOf(kind: string | undefined): ProductId {
  return kind === 'conditioning' ? 'conditioning' : 'strength';
}

/**
 * Route the one live session to the world that should show it. The `foreign`
 * half is the safety half: a live session in the other world must stay
 * reachable, or switching mid-session silently abandons logged work to
 * expireStaleSessions.
 */
export function splitActiveSession<T extends { kind?: string }>(
  live: T | null | undefined,
  discipline: ProductId,
): { activeSession: T | null; foreignActiveSession: T | null } {
  if (!live) return { activeSession: null, foreignActiveSession: null };
  return disciplineOf(live.kind) === discipline
    ? { activeSession: live, foreignActiveSession: null }
    : { activeSession: null, foreignActiveSession: live };
}

/** Test seam: reset module state between cases. */
export function __resetDisciplineForTest(): void {
  try {
    storage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  active = load();
  listeners.clear();
}
