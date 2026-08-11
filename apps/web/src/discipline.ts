import { useSyncExternalStore } from 'react';

/**
 * Which world the athlete is in. A view preference, NOT training data — its
 * own storage key, invisible to sync.
 *
 * Mobile's WorldId has three values (strength, conditioning, nutrition)
 * because a single mobile install can carry an athlete through either
 * training product at runtime, so mobile also tracks `trainingScope` /
 * `lastTrainingWorld` to remember which training sub-world Nutrition should
 * return to.
 *
 * Web has no runtime equivalent of that split: `apps/web/src/product.ts`
 * fixes the strength/conditioning choice at BUILD time via
 * `VITE_HYBRID_PRODUCT` — each deployed web build is permanently one product
 * (or, on the unscoped dashboard build, neither), never something an athlete
 * switches between in a running session. So web's WorldId collapses to two
 * values, and there is no `lastTrainingWorld`/`trainingScope` to port: with
 * only one training identity per deployment, "which training world to return
 * to" has a single, static answer, not a stateful one. Porting the mobile
 * shape here would be tracking a distinction that cannot occur on this
 * platform.
 */
export type WorldId = 'training' | 'nutrition';

const STORAGE_KEY = 'hybrid-active-discipline-v1';

const isWorld = (v: unknown): v is WorldId => v === 'training' || v === 'nutrition';

function load(): WorldId {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (isWorld(raw)) return raw;
  } catch {
    /* unreadable storage — fall through to the default */
  }
  return 'training';
}

let active: WorldId = load();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): WorldId {
  return active;
}

export function useDiscipline(): WorldId {
  return useSyncExternalStore(subscribe, getSnapshot);
}

export function setDiscipline(next: WorldId): void {
  if (next === active) return;
  active = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* storage failed — the switch still holds for this run */
  }
  listeners.forEach((l) => l());
}

/** Non-reactive read, for code outside React. */
export function currentDiscipline(): WorldId {
  return active;
}

/** Test seam: reset module state between cases. */
export function __resetDisciplineForTest(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  active = load();
  listeners.clear();
}
