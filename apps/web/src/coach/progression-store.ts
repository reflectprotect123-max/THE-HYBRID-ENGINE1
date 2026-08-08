import { useSyncExternalStore } from 'react';
import type { ProgressionDecision, ProgressionDecisionEvent, ProgressionProposal } from './progression';

const KEY = 'hybrid-coach-progression-v1';

interface ProgressionLedger {
  version: 1;
  proposals: ProgressionProposal[];
  decisions: ProgressionDecisionEvent[];
}

const empty = (): ProgressionLedger => ({ version: 1, proposals: [], decisions: [] });
const listeners = new Set<() => void>();
let state = load();

function load(): ProgressionLedger {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? 'null') as ProgressionLedger | null;
    return value?.version === 1 && Array.isArray(value.proposals) && Array.isArray(value.decisions) ? value : empty();
  } catch {
    return empty();
  }
}

function persist(next: ProgressionLedger): void {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Demo storage may degrade to this tab. The coach surface labels it local-only.
  }
  listeners.forEach((listener) => listener());
}

export function recordProgressionProposals(proposals: ProgressionProposal[]): void {
  if (!proposals.length) return;
  const known = new Set(state.proposals.map((proposal) => proposal.id));
  const fresh = proposals.filter((proposal) => !known.has(proposal.id));
  if (fresh.length) persist({ ...state, proposals: [...fresh, ...state.proposals] });
}

export function appendProgressionDecision(
  proposalId: string,
  decision: ProgressionDecision,
  rationale: string,
  applied: boolean,
  note?: string,
): ProgressionDecisionEvent {
  const event: ProgressionDecisionEvent = {
    id: `${proposalId}:${Date.now()}:${decision}`,
    proposalId,
    decision,
    rationale: rationale.trim(),
    decidedAt: Date.now(),
    actor: 'local-demo-coach',
    applied,
    note,
  };
  persist({ ...state, decisions: [event, ...state.decisions] });
  return event;
}

export function useProgressionLedger(): ProgressionLedger {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

export function resetProgressionLedgerForTests(): void {
  persist(empty());
}
