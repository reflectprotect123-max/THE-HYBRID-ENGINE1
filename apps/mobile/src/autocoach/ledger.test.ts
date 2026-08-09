import {
  canUndo,
  getLedgerEntries,
  recordApply,
  recordUndo,
  resetLedgerForTests,
  type NewLedgerEntry,
} from './ledger';

function fixtureEntry(over: Partial<NewLedgerEntry> = {}): NewLedgerEntry {
  return {
    date: '2026-08-09',
    workoutId: 'w-1',
    wasForked: false,
    beforeBlocks: [],
    operations: [],
    reasonCodes: ['low_readiness'],
    ...over,
  };
}

beforeEach(() => resetLedgerForTests());

describe('mobile ledger store', () => {
  it('starts empty', () => {
    expect(getLedgerEntries()).toEqual([]);
  });

  it('recordApply adds an entry with action "applied"', () => {
    const e = recordApply(fixtureEntry());
    expect(e.action).toBe('applied');
    expect(getLedgerEntries()).toHaveLength(1);
    expect(getLedgerEntries()[0].id).toBe(e.id);
  });

  it('recordUndo adds a NEW entry with action "undone", keeping the original', () => {
    const applied = recordApply(fixtureEntry());
    const undone = recordUndo(applied);
    expect(undone.action).toBe('undone');
    expect(undone.id).not.toBe(applied.id);
    expect(getLedgerEntries()).toHaveLength(2);
  });

  it('newest entry is first', () => {
    recordApply(fixtureEntry({ workoutId: 'w-1' }));
    recordApply(fixtureEntry({ workoutId: 'w-2' }));
    expect(getLedgerEntries()[0].workoutId).toBe('w-2');
  });

  it('caps at 30 entries, dropping the oldest', () => {
    for (let i = 0; i < 35; i++) recordApply(fixtureEntry({ workoutId: `w-${i}` }));
    const entries = getLedgerEntries();
    expect(entries).toHaveLength(30);
    expect(entries[0].workoutId).toBe('w-34');
    expect(entries[29].workoutId).toBe('w-5');
  });

  it('canUndo is true for an applied entry with beforeBlocks', () => {
    const e = recordApply(fixtureEntry({ beforeBlocks: [] }));
    expect(canUndo(e)).toBe(true);
  });

  it('canUndo is false for an undone entry', () => {
    const applied = recordApply(fixtureEntry());
    const undone = recordUndo(applied);
    expect(canUndo(undone)).toBe(false);
  });

  it('canUndo is true for a forked entry with a forkedWorkoutId, false without one', () => {
    const withFork = recordApply(fixtureEntry({ wasForked: true, forkedWorkoutId: 'w-fork', beforeBlocks: undefined }));
    expect(canUndo(withFork)).toBe(true);
    const withoutFork = recordApply(fixtureEntry({ wasForked: true, forkedWorkoutId: undefined, beforeBlocks: undefined }));
    expect(canUndo(withoutFork)).toBe(false);
  });

  it('persists across a reload of the module state via getLedgerEntries', () => {
    recordApply(fixtureEntry());
    resetLedgerForTests();
    expect(getLedgerEntries()).toEqual([]);
  });
});

/*
 * These exercise the module's `load()` — the actual mobile-specific risk
 * surface (the localStorage→MMKV swap). `resetLedgerForTests()` alone never
 * re-runs `load()`: it just resets the in-memory `state` and re-persists,
 * so a fresh `jest.resetModules()` + `require()` is needed to force the
 * module to re-read whatever is sitting in storage at import time, the same
 * way a cold app start would.
 */
describe('mobile ledger store — load() from persisted storage', () => {
  const KEY = 'hybrid-auto-coach-ledger-v1';

  beforeEach(() => {
    jest.resetModules();
  });

  it('reads back a valid persisted payload on load()', () => {
    const { storage } = require('../store/storage');
    const seeded = {
      schemaVersion: 1,
      entries: [
        {
          id: 'e1',
          at: 1000,
          date: '2026-08-09',
          workoutId: 'w-1',
          action: 'applied',
          wasForked: false,
          beforeBlocks: [],
          operations: [],
          reasonCodes: ['low_readiness'],
        },
      ],
    };
    storage.setItem(KEY, JSON.stringify(seeded));
    const fresh = require('./ledger');
    expect(fresh.getLedgerEntries()).toEqual(seeded.entries);
  });

  it('falls back to empty state on a stale schemaVersion', () => {
    const { storage } = require('../store/storage');
    storage.setItem(KEY, JSON.stringify({ schemaVersion: 99, entries: [{ id: 'x' }] }));
    const fresh = require('./ledger');
    expect(fresh.getLedgerEntries()).toEqual([]);
  });

  it('falls back to empty state on corrupt JSON', () => {
    const { storage } = require('../store/storage');
    storage.setItem(KEY, '{not valid json');
    const fresh = require('./ledger');
    expect(fresh.getLedgerEntries()).toEqual([]);
  });

  it('recordApply degrades to session-local when storage.setItem throws — no throw, state still updates', () => {
    const { storage } = require('../store/storage');
    const fresh = require('./ledger');
    jest.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(() => fresh.recordApply(fixtureEntry())).not.toThrow();
    expect(fresh.getLedgerEntries()).toHaveLength(1);
  });
});
