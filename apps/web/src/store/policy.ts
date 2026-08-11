import { useSyncExternalStore } from 'react';
import { DEFAULT_POLICY, type AutonomyPolicy } from '@hybrid/auto-coach';

/**
 * The athlete-owned autonomy policy. Additive persistence: its own
 * localStorage key, never a field on EngineDB, invisible to sync. V1 ships
 * shadow mode by default — the resolver shows what it WOULD do; nothing is
 * applied automatically until the athlete explicitly changes mode, and
 * pausing is one tap from the receipt itself.
 */

const KEY = 'hybrid-auto-coach-policy-v1';

let policy: AutonomyPolicy = load();
const listeners = new Set<() => void>();

function load(): AutonomyPolicy {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_POLICY;
    const parsed = JSON.parse(raw) as AutonomyPolicy;
    if (parsed?.schemaVersion !== 1) return DEFAULT_POLICY;
    return { ...DEFAULT_POLICY, ...parsed };
  } catch {
    return DEFAULT_POLICY;
  }
}

export function usePolicy(): AutonomyPolicy {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => policy,
  );
}

/** Non-hook read, for code outside a component render — a click handler that
 *  must re-check the live policy rather than the one its closure captured. */
export function getPolicy(): AutonomyPolicy {
  return policy;
}

export function updatePolicy(fn: (p: AutonomyPolicy) => AutonomyPolicy): void {
  policy = { ...fn(policy), version: policy.version + 1 };
  try {
    localStorage.setItem(KEY, JSON.stringify(policy));
  } catch {
    /* private mode — policy stays session-local */
  }
  listeners.forEach((l) => l());
}
