import { useSyncExternalStore } from 'react';
import type { AutoCoachResolution } from '@hybrid/auto-coach';
import { storage } from '../store/storage';

/**
 * The self-coach "propose, then decide" gate (docs/RISK_REGISTER.md R2),
 * ported from apps/web's pendingProposal.ts. Additive persistence: its own
 * storage key, never a field on EngineDB, invisible to sync — mirrors
 * ledger.ts/policy.ts/consent.ts.
 *
 * Unlike web's single-record store, this one is keyed by DATE **and** SOURCE
 * WORKOUT. Mobile is the merged app: `useDb().workouts` is scoped per world
 * (trainingScope — see store/db.tsx), so an athlete with a Strength session
 * and a Conditioning session on the same day gets two receipts on the same
 * date. A single date-keyed record made those two share one proposal —
 * approving Strength burned Conditioning's decision for the day, and
 * declining one silently blocked the other. The key is the pair, so each
 * world's session owns its own decision.
 *
 * Date-matching against "today" is still the caller's job
 * (SessionReceipt.tsx) — this store never filters by date itself; it only
 * prunes records for other dates when a fresh proposal is made.
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

/** Bumped from 1 when the store went from one record to a per-workout map. A
 *  persisted v1 blob is simply discarded — it holds at most one day's
 *  undecided proposal, which is re-proposed on the next render. */
const SCHEMA_VERSION = 2 as const;

interface PendingState {
  schemaVersion: typeof SCHEMA_VERSION;
  proposals: Record<string, PendingProposal>;
}

const empty = (): PendingState => ({ schemaVersion: SCHEMA_VERSION, proposals: {} });

let state: PendingState = load();
const listeners = new Set<() => void>();

/** The identity of one decision: a date AND the session it is about. */
export function pendingKey(date: string, sourceWorkoutId: string): string {
  return `${date}::${sourceWorkoutId}`;
}

/** A structural check on a persisted proposal, mirroring ledger.ts's own
 *  `Array.isArray(parsed.entries)` guard — a malformed record (e.g. missing
 *  `resolution`) must not pass load() and later crash `planApply` inside a
 *  press handler. */
function isValidProposal(p: unknown): p is PendingProposal {
  if (typeof p !== 'object' || p === null) return false;
  const c = p as Partial<PendingProposal>;
  return (
    typeof c.date === 'string' &&
    typeof c.sourceWorkoutId === 'string' &&
    !!c.resolution &&
    (c.status === 'pending' || c.status === 'approved' || c.status === 'declined')
  );
}

function load(): PendingState {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as PendingState;
    if (parsed?.schemaVersion !== SCHEMA_VERSION) return empty();
    const src = parsed.proposals;
    if (typeof src !== 'object' || src === null) return empty();
    const proposals: Record<string, PendingProposal> = {};
    for (const [k, v] of Object.entries(src)) {
      if (isValidProposal(v)) proposals[k] = v;
    }
    return { schemaVersion: SCHEMA_VERSION, proposals };
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

/** The whole map. Callers index it with `pendingKey(today, workout.id)` —
 *  returning the map rather than a derived record keeps the snapshot
 *  referentially stable for useSyncExternalStore. */
export function usePendingProposals(): Record<string, PendingProposal> {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state.proposals,
  );
}

/** The non-hook read, for code that runs outside a component render, and for
 *  testing the store in isolation without a React render. */
export function getPendingProposal(key: string): PendingProposal | null {
  return state.proposals[key] ?? null;
}

export function getPendingProposals(): Record<string, PendingProposal> {
  return state.proposals;
}

export type NewPendingProposal = Omit<PendingProposal, 'status'>;

/** Replaces any record for the same date+workout, and drops every record for
 *  a different date — yesterday's decision has no bearing on today and the
 *  map must not grow without bound. */
export function proposePending(entry: NewPendingProposal): PendingProposal {
  const full: PendingProposal = { ...entry, status: 'pending' };
  const proposals: Record<string, PendingProposal> = {};
  for (const [k, v] of Object.entries(state.proposals)) {
    if (v.date === entry.date) proposals[k] = v;
  }
  proposals[pendingKey(entry.date, entry.sourceWorkoutId)] = full;
  persist({ schemaVersion: SCHEMA_VERSION, proposals });
  return full;
}

/** No-op if nothing is pending under that key — matches ledger.ts's own
 *  defensive style for operations that only make sense against an existing
 *  record. */
export function decidePending(key: string, status: 'approved' | 'declined'): void {
  const cur = state.proposals[key];
  if (!cur) return;
  persist({
    schemaVersion: SCHEMA_VERSION,
    proposals: { ...state.proposals, [key]: { ...cur, status } },
  });
}

export function withdrawPending(key: string): void {
  if (!(key in state.proposals)) return;
  const proposals = { ...state.proposals };
  delete proposals[key];
  persist({ schemaVersion: SCHEMA_VERSION, proposals });
}

export function resetPendingProposalForTests(): void {
  persist(empty());
}
