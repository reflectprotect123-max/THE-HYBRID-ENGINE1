import { useSyncExternalStore } from 'react';
import type { AutoCoachResolution } from '@hybrid/auto-coach';

/**
 * The self-coach "propose, then decide" gate (docs/RISK_REGISTER.md R2).
 * Additive persistence: its own localStorage key, never a field on
 * EngineDB, invisible to sync — mirrors ledger.ts/policy.ts/consent.ts.
 * Holds at most one record. Date-matching against "today" is the caller's
 * job (SessionReceipt.tsx), the same convention ledger.ts already uses for
 * its own date-matched entries — this store never filters by date itself.
 */

export interface PendingProposal {
  date: string;
  sourceWorkoutId: string;
  sourceWorkoutUpdatedAt: number;
  /** frozen at propose time; approving applies THIS, never a fresh re-resolve */
  resolution: AutoCoachResolution;
  status: 'pending' | 'approved' | 'declined';
}

const KEY = 'hybrid-auto-coach-pending-v1';

interface PendingState {
  schemaVersion: 1;
  proposal: PendingProposal | null;
}

const empty = (): PendingState => ({ schemaVersion: 1, proposal: null });

let state: PendingState = load();
const listeners = new Set<() => void>();

function load(): PendingState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as PendingState;
    if (parsed?.schemaVersion !== 1) return empty();
    return parsed;
  } catch {
    return empty();
  }
}

function persist(next: PendingState): void {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* private mode — pending proposal stays session-local */
  }
  listeners.forEach((l) => l());
}

export function usePendingProposal(): PendingProposal | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state.proposal,
  );
}

/** The non-hook read, for code that runs outside a component render, and
 *  for testing the store in isolation without a React render — mirrors
 *  ledger.ts's getLedgerEntries(). */
export function getPendingProposal(): PendingProposal | null {
  return state.proposal;
}

export type NewPendingProposal = Omit<PendingProposal, 'status'>;

export function proposePending(entry: NewPendingProposal): PendingProposal {
  const full: PendingProposal = { ...entry, status: 'pending' };
  persist({ schemaVersion: 1, proposal: full });
  return full;
}

/** No-op if nothing is pending — matches ledger.ts's own defensive style
 *  for operations that only make sense against an existing record. */
export function decidePending(status: 'approved' | 'declined'): void {
  if (!state.proposal) return;
  persist({ schemaVersion: 1, proposal: { ...state.proposal, status } });
}

export function withdrawPending(): void {
  persist(empty());
}

export function resetPendingProposalForTests(): void {
  persist(empty());
}
