import { useSyncExternalStore } from 'react';
import { DEFAULT_POLICY, type AutonomyPolicy } from '@hybrid/auto-coach';
import { storage } from '../store/storage';

/**
 * The athlete-owned autonomy policy, ported from apps/web's policy.ts.
 * Additive persistence: its own storage key, never a field on EngineDB,
 * invisible to sync. Ships shadow mode by default — nothing is applied
 * automatically until the athlete explicitly changes mode via the mode
 * switcher, and pausing is one tap from the receipt itself.
 */

const KEY = 'hybrid-auto-coach-policy-v1';

let policy: AutonomyPolicy = load();
const listeners = new Set<() => void>();

function load(): AutonomyPolicy {
  try {
    const raw = storage.getItem(KEY);
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

/** Non-hook read, for code outside a component render (mirrors ledger.ts's
 *  getLedgerEntries, needed by SessionReceipt's effect and its handlers,
 *  which are not always inside the render that owns usePolicy()). */
export function getPolicy(): AutonomyPolicy {
  return policy;
}

export function updatePolicy(fn: (p: AutonomyPolicy) => AutonomyPolicy): void {
  policy = { ...fn(policy), version: policy.version + 1 };
  try {
    storage.setItem(KEY, JSON.stringify(policy));
  } catch {
    /* storage write failed — policy stays session-local */
  }
  listeners.forEach((l) => l());
}

export function resetPolicyForTests(): void {
  try {
    storage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  policy = DEFAULT_POLICY;
  listeners.clear();
}
