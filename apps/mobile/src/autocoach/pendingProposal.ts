import { useSyncExternalStore } from 'react';
import type { AutoCoachResolution } from '@hybrid/auto-coach';
import { storage } from '../store/storage';

/**
 * The self-coach "propose, then decide" gate (docs/RISK_REGISTER.md R2),
 * ported from apps/web's pendingProposal.ts. Additive persistence: its own
 * storage key, never a field on EngineDB, invisible to sync — mirrors
 * ledger.ts/policy.ts/consent.ts. Holds at most one record. Date-matching
 * against "today" is the caller's job (SessionReceipt.tsx) — this store
 * never filters by date itself.
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

function isValidProposal(p: unknown): p is PendingProposal {
  if (p === null) return true;
  if (typeof p !== 'object') return false;
  const c = p as Partial<PendingProposal>;
  return (
    typeof c.date === 'string' &&
    !!c.resolution &&
    (c.status === 'pending' || c.status === 'approved' || c.status === 'declined')
  );
}

function load(): PendingState {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as PendingState;
    if (parsed?.schemaVersion !== 1 || !isValidProposal(parsed.proposal)) return empty();
    return parsed;
  } catch {
    return empty();
  }
}

function persist(next: PendingState): void {
  state = next;
  try {
    storage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage write failed — pending proposal stays session-local */
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

export function getPendingProposal(): PendingProposal | null {
  return state.proposal;
}

export type NewPendingProposal = Omit<PendingProposal, 'status'>;

export function proposePending(entry: NewPendingProposal): PendingProposal {
  const full: PendingProposal = { ...entry, status: 'pending' };
  persist({ schemaVersion: 1, proposal: full });
  return full;
}

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
