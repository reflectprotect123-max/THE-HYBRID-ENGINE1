import { useSyncExternalStore } from 'react';
import type { Block } from '@hybrid/engine';
import type { ResolutionOperation } from '@hybrid/auto-coach';
import { storage } from '../store/storage';

/**
 * Auto-Coached apply/undo history. Additive persistence: its own storage
 * key, never a field on EngineDB, invisible to sync — mirrors policy.ts.
 * This is bookkeeping for what the athlete did, not athlete data; losing it
 * loses undo capability, never a workout. Ported from apps/web's ledger.ts.
 */

export interface LedgerEntry {
  id: string;
  at: number;
  date: string;
  workoutId: string;
  action: 'applied' | 'undone';
  wasForked: boolean;
  forkedWorkoutId?: string;
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
    const raw = storage.getItem(KEY);
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
    storage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage write failed — ledger stays session-local */
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

export function canUndo(entry: LedgerEntry): boolean {
  if (entry.action !== 'applied') return false;
  return entry.wasForked ? !!entry.forkedWorkoutId : entry.beforeBlocks !== undefined;
}

export function resetLedgerForTests(): void {
  persist(empty());
}
