import { useSyncExternalStore } from 'react';
import { WORLDS, type WorldId } from '@hybrid/design';
import type { ProductId } from '@hybrid/product-scope';
import { storage } from './store/storage';

/**
 * Which world the athlete is in. A view preference, NOT training data — its
 * own storage key, never a field on EngineDB, invisible to sync (a merge must
 * never have to resolve "which tab was I on"). Fresh installs open in
 * Strength; after that the last-used world wins on this device.
 *
 * Three worlds now: Strength, Conditioning and Nutrition. `WorldId` is
 * deliberately NOT `ProductId` — see its declaration in @hybrid/design.
 */

const KEY = 'hybrid-active-discipline-v1';
/* Separate from KEY because the two answer different questions, and one of
   them has no answer while the athlete is in Nutrition — see `trainingScope`. */
const TRAINING_KEY = 'hybrid-last-training-world-v1';

const isWorld = (v: unknown): v is WorldId => WORLDS.includes(v as WorldId);
const isTraining = (v: unknown): v is ProductId => v === 'strength' || v === 'conditioning';

let active: WorldId = load();
let lastTraining: ProductId = loadTraining();
const listeners = new Set<() => void>();

function load(): WorldId {
  try {
    const raw = storage.getItem(KEY);
    if (isWorld(raw)) return raw;
  } catch {
    /* unreadable storage — fall through to the default */
  }
  return 'strength';
}

function loadTraining(): ProductId {
  try {
    const raw = storage.getItem(TRAINING_KEY);
    if (isTraining(raw)) return raw;
    // A device that last stored a TRAINING world under KEY predates this key;
    // reading it back is what stops the upgrade dropping a conditioning
    // athlete into strength-scoped reads the first time they open Nutrition.
    const world = storage.getItem(KEY);
    if (isTraining(world)) return world;
  } catch {
    /* unreadable storage — fall through to the default */
  }
  return 'strength';
}

export function useDiscipline(): WorldId {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => active,
    () => 'strength',
  );
}

export function setDiscipline(next: WorldId): void {
  if (next === active) return;
  active = next;
  if (isTraining(next)) lastTraining = next;
  try {
    storage.setItem(KEY, next);
    if (isTraining(next)) storage.setItem(TRAINING_KEY, next);
  } catch {
    /* storage failed — the switch still holds for this run */
  }
  listeners.forEach((l) => l());
}

/** Non-reactive read, for code outside React. */
export function currentDiscipline(): WorldId {
  return active;
}

/**
 * Which TRAINING product a world's training reads are scoped to.
 *
 * Nutrition is not a training identity, so `restrictToProduct` and the
 * live-session split have no answer for it — but they still run, because the
 * store that computes them sits above every world. Scoping to the training
 * world the athlete will return to keeps that computation meaningful instead
 * of pinning it to an arbitrary default: a conditioning athlete who steps into
 * Nutrition and back has not become a strength athlete in between.
 */
export function trainingScope(world: WorldId): ProductId {
  return isTraining(world) ? world : lastTraining;
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
 *
 * A live session is foreign to Nutrition too — no training screen exists
 * there to show it, and calling it `activeSession` would hide it from the
 * notice that offers the way back to it.
 */
export function splitActiveSession<T extends { kind?: string }>(
  live: T | null | undefined,
  world: WorldId,
): { activeSession: T | null; foreignActiveSession: T | null } {
  if (!live) return { activeSession: null, foreignActiveSession: null };
  return disciplineOf(live.kind) === world
    ? { activeSession: live, foreignActiveSession: null }
    : { activeSession: null, foreignActiveSession: live };
}

/** Test seam: reset module state between cases. */
export function __resetDisciplineForTest(): void {
  try {
    storage.removeItem(KEY);
    storage.removeItem(TRAINING_KEY);
  } catch {
    /* ignore */
  }
  active = load();
  lastTraining = loadTraining();
  listeners.clear();
}
