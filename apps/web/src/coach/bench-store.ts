import { useSyncExternalStore } from 'react';
import type { WeeklyPlan } from '@hybrid/coordinator-adapter';

/**
 * Coach-bench persistence, additive by construction: its own localStorage
 * key, never a field on EngineDB. The engine's shapes stay untouched, the
 * sync layer never sees this data, and deleting the key loses nothing an
 * athlete owns — only the coach's review bookkeeping.
 *
 * Local-first like the rest of the app, and local-ONLY for now: review
 * state does not follow the coach across devices. Cross-device bench state
 * is part of the phase-4 persistence design, not something to fake here.
 */

export interface LedgerEntry {
  who: 'coach' | 'coordinator';
  what: string;
  at: number;
}

export interface SlimEntry {
  proposalId: string;
  date: string;
  title: string;
  domain: 'strength' | 'conditioning';
  locked: boolean;
}

export interface SlimDrop {
  proposalId: string;
  reasonCode: string;
  explanation: string;
}

export interface SlimPlan {
  weekStart: string;
  entries: SlimEntry[];
  drops: SlimDrop[];
}

export interface BenchState {
  version: 1;
  ledger: LedgerEntry[];
  /** decision acknowledgments, keyed `${weekStart}:${proposalId}:${reasonCode}` */
  acks: Record<string, { at: number }>;
  /** the plan as of the coach's last review — the diff baseline */
  lastPlan: SlimPlan | null;
  /** onboarding steps the coach chose to skip, keyed by step id */
  skips: Record<string, number>;
}

const KEY = 'hybrid-coach-bench-v1';
const empty = (): BenchState => ({ version: 1, ledger: [], acks: {}, lastPlan: null, skips: {} });

let state: BenchState = load();
const listeners = new Set<() => void>();

function load(): BenchState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as BenchState;
    if (parsed?.version !== 1) return empty();
    return { ...empty(), ...parsed };
  } catch {
    return empty();
  }
}

function mutate(fn: (draft: BenchState) => void): void {
  const draft: BenchState = JSON.parse(JSON.stringify(state));
  fn(draft);
  state = draft;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* private mode — bench state degrades to session-only */
  }
  listeners.forEach((l) => l());
}

export function useBench(): BenchState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

export function recordLedger(who: LedgerEntry['who'], what: string): void {
  mutate((d) => {
    d.ledger.unshift({ who, what, at: Date.now() });
    d.ledger = d.ledger.slice(0, 50);
  });
}

export const ackKey = (weekStart: string, proposalId: string, reasonCode: string): string =>
  `${weekStart}:${proposalId}:${reasonCode}`;

export function acknowledge(weekStart: string, proposalId: string, reasonCode: string): void {
  mutate((d) => {
    d.acks[ackKey(weekStart, proposalId, reasonCode)] = { at: Date.now() };
  });
}

export function setReviewBaseline(plan: SlimPlan): void {
  mutate((d) => {
    d.lastPlan = plan;
  });
}

export function toggleSkip(stepId: string): void {
  mutate((d) => {
    if (d.skips[stepId]) delete d.skips[stepId];
    else d.skips[stepId] = Date.now();
  });
}

/** Project the Coordinator's plan onto the slim shape the bench stores. */
export function slimPlan(plan: WeeklyPlan): SlimPlan {
  return {
    weekStart: plan.weekStart,
    entries: plan.entries.map((e) => ({
      proposalId: e.proposalId ?? e.id,
      date: e.date,
      title: e.title,
      domain: e.domain,
      locked: e.locked,
    })),
    drops: plan.decisions
      .filter((d) => d.action === 'dropped')
      .map((d) => ({ proposalId: d.proposalId, reasonCode: d.reasonCode, explanation: d.explanation })),
  };
}
