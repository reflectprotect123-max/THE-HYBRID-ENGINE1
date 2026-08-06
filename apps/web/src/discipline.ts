import { useSyncExternalStore } from 'react';
import type { ProductId } from '@hybrid/product-scope';
import { PRODUCT_ID } from './product';

/**
 * Which discipline the athlete is currently in.
 *
 * The two disciplines are one installed app but two separate experiences: a
 * strength week and a conditioning week never appear on the same screen. This
 * is the runtime switch that decides which one you are looking at.
 *
 * Deliberately NOT a field on EngineDB. It is a view preference, not training
 * data — putting it in the synced database would make "which tab was I on"
 * something two devices can disagree about and something a sync merge has to
 * resolve. Its own key, invisible to sync, same as the auto-coach policy.
 *
 * The build-time `VITE_HYBRID_PRODUCT` still decides where a fresh install
 * starts, so a branded build opens on its own discipline. Once the athlete has
 * chosen, their choice wins on that device.
 */

const KEY = 'hybrid-active-discipline-v1';

let active: ProductId = load();
const listeners = new Set<() => void>();

function load(): ProductId {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === 'strength' || raw === 'conditioning') return raw;
  } catch {
    /* private mode — fall through to the build default */
  }
  return PRODUCT_ID;
}

export function useDiscipline(): ProductId {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => active,
    // The server/prerender snapshot: no localStorage, so the build default is
    // the only honest answer. Without this the hook throws during any
    // non-browser render.
    () => PRODUCT_ID,
  );
}

export function setDiscipline(next: ProductId): void {
  if (next === active) return;
  active = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* private mode — the switch still holds for this session */
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
 * Route the one live session to the discipline that should show it.
 *
 * Pure, and separated from the store so the rule can be tested without a
 * renderer. The `foreign` half is the safety half: a live session in the other
 * discipline must stay reachable, or switching tabs mid-session silently
 * abandons logged work to `expireStaleSessions`.
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
  active = load();
  listeners.clear();
}
