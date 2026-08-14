import { useSyncExternalStore } from 'react';

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

/*
 * `SlimEntry`, `SlimDrop` and `SlimPlan` were here until 14 August 2026 — the
 * bench's copy of the Coordinator's resolved week, kept so `diffPlans` could
 * show a coach what had changed since they last looked. The Coordinator is
 * deleted, nothing writes a plan for the bench to diff, and `diff.ts` went
 * with them.
 *
 * `ledger` and `acks` STAY. A ledger entry's `who` still admits
 * `'coordinator'` because entries WRITTEN by it are still in coaches'
 * localStorage and must keep rendering; nothing writes a new one.
 */

export interface BenchState {
  version: 1;
  ledger: LedgerEntry[];
  /** decision acknowledgments, keyed `${weekStart}:${proposalId}:${reasonCode}` */
  acks: Record<string, { at: number }>;
  /** onboarding steps the coach chose to skip, keyed by step id */
  skips: Record<string, number>;
}

const KEY = 'hybrid-coach-bench-v1';
const empty = (): BenchState => ({ version: 1, ledger: [], acks: {}, skips: {} });

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

export function toggleSkip(stepId: string): void {
  mutate((d) => {
    if (d.skips[stepId]) delete d.skips[stepId];
    else d.skips[stepId] = Date.now();
  });
}

