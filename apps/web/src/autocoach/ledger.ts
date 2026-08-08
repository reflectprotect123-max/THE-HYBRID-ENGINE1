import { useSyncExternalStore } from 'react';
import type { Block } from '@hybrid/engine';
import type { ResolutionOperation } from '@hybrid/auto-coach';

/**
 * Auto-Coached apply/undo history. Additive persistence: its own
 * localStorage key, never a field on EngineDB, invisible to sync — mirrors
 * policy.ts. This is bookkeeping for what the athlete did, not athlete data;
 * losing it loses undo capability, never a workout.
 */

export interface LedgerEntry {
  id: string;
  at: number;
  date: string;
  workoutId: string;
  action: 'applied' | 'undone';
  wasForked: boolean;
  forkedWorkoutId?: string;
  /** only set for the in-place mutation case — the fork case undoes by
   *  deleting the forked workout, not by restoring blocks */
  beforeBlocks?: Block[];
  operations: ResolutionOperation[];
  reasonCodes: string[];
}

const KEY = 'hybrid-auto-coach-ledger-v1';
const MAX_ENTRIES = 30;

interface LedgerState {
  schemaVersion: 1;
  entries: LedgerEntry[];
}

const empty = (): LedgerState => ({ schemaVersion: 1, entries: [] });

let state: LedgerState = load();
const listeners = new Set<() => void>();

function load(): LedgerState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as LedgerState;
    if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.entries)) return empty();
    return parsed;
  } catch {
    return empty();
  }
}

function uid(): string {
  return `ac-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function persist(next: LedgerState): void {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* private mode — ledger stays session-local */
  }
  listeners.forEach((l) => l());
}

export function useLedger(): LedgerEntry[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state.entries,
  );
}

/** The non-hook read, for code that runs outside a component render (the ARC
 *  sync cycle, which best-effort mirrors this ledger to a roster coach —
 *  see cloud/arc-athlete-sync.ts). */
export function getLedgerEntries(): LedgerEntry[] {
  return state.entries;
}

export type NewLedgerEntry = Omit<LedgerEntry, 'id' | 'at' | 'action'>;

export function recordApply(entry: NewLedgerEntry): LedgerEntry {
  const full: LedgerEntry = { ...entry, id: uid(), at: Date.now(), action: 'applied' };
  persist({ schemaVersion: 1, entries: [full, ...state.entries].slice(0, MAX_ENTRIES) });
  return full;
}

export function recordUndo(entry: LedgerEntry): LedgerEntry {
  const undone: LedgerEntry = { ...entry, id: uid(), at: Date.now(), action: 'undone' };
  persist({ schemaVersion: 1, entries: [undone, ...state.entries].slice(0, MAX_ENTRIES) });
  return undone;
}

/** An entry can still be undone only while it records enough to reverse
 *  itself — a forked workout id, or the pre-mutation blocks. */
export function canUndo(entry: LedgerEntry): boolean {
  if (entry.action !== 'applied') return false;
  return entry.wasForked ? !!entry.forkedWorkoutId : entry.beforeBlocks !== undefined;
}
