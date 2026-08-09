import type { AutoCoachResolution } from '@hybrid/auto-coach';
import {
  decidePending,
  getPendingProposal,
  proposePending,
  resetPendingProposalForTests,
  withdrawPending,
  type NewPendingProposal,
} from './pendingProposal';

function fixtureResolution(): AutoCoachResolution {
  return {
    schemaVersion: 1,
    state: 'advisory',
    originalWorkoutId: 'w-1',
    resolvedWorkout: { id: 'w-1', name: 'Test', kind: 'strength', blocks: [] } as AutoCoachResolution['resolvedWorkout'],
    operations: [],
    signals: [],
    inferences: [],
    reasonCodes: ['low_readiness'],
    confidence: 'high',
    requiresConfirmation: true,
    autoApplyAllowed: false,
    athleteMessage: 'Cap intensity today.',
  };
}

function fixtureEntry(over: Partial<NewPendingProposal> = {}): NewPendingProposal {
  return {
    date: '2026-08-09',
    sourceWorkoutId: 'w-1',
    sourceWorkoutUpdatedAt: 1000,
    resolution: fixtureResolution(),
    ...over,
  };
}

beforeEach(() => resetPendingProposalForTests());

describe('mobile pendingProposal store', () => {
  it('starts empty', () => {
    expect(getPendingProposal()).toBeNull();
  });

  it('proposePending creates a record with status pending', () => {
    proposePending(fixtureEntry());
    const p = getPendingProposal();
    expect(p?.status).toBe('pending');
    expect(p?.date).toBe('2026-08-09');
    expect(p?.sourceWorkoutId).toBe('w-1');
  });

  it('decidePending flips status to approved without touching other fields', () => {
    proposePending(fixtureEntry({ sourceWorkoutUpdatedAt: 42 }));
    decidePending('approved');
    const p = getPendingProposal();
    expect(p?.status).toBe('approved');
    expect(p?.sourceWorkoutUpdatedAt).toBe(42);
  });

  it('decidePending declined leaves status declined', () => {
    proposePending(fixtureEntry());
    decidePending('declined');
    expect(getPendingProposal()?.status).toBe('declined');
  });

  it('decidePending is a no-op when there is no proposal', () => {
    decidePending('approved');
    expect(getPendingProposal()).toBeNull();
  });

  it('withdrawPending clears the record entirely', () => {
    proposePending(fixtureEntry());
    withdrawPending();
    expect(getPendingProposal()).toBeNull();
  });

  it('a fresh proposePending call replaces any existing record, even a decided one', () => {
    proposePending(fixtureEntry({ date: '2026-08-08' }));
    decidePending('declined');
    proposePending(fixtureEntry({ date: '2026-08-09' }));
    const p = getPendingProposal();
    expect(p?.date).toBe('2026-08-09');
    expect(p?.status).toBe('pending');
  });
});

/*
 * `load()` itself — the localStorage→MMKV swap's actual mobile-specific risk.
 * `resetPendingProposalForTests()` persists an empty record through the
 * normal write path; it never calls `load()`. Only a fresh module instance,
 * forced via `jest.resetModules()`, re-runs it against whatever is already in
 * storage — the same path a cold app start takes.
 */
describe('mobile pendingProposal store — load() from persisted storage', () => {
  const KEY = 'hybrid-auto-coach-pending-v1';

  beforeEach(() => {
    jest.resetModules();
  });

  it('reads back a valid persisted proposal on load()', () => {
    const { storage } = require('../store/storage');
    const seeded = {
      schemaVersion: 1,
      proposal: { ...fixtureEntry(), status: 'pending' },
    };
    storage.setItem(KEY, JSON.stringify(seeded));
    const fresh = require('./pendingProposal');
    expect(fresh.getPendingProposal()?.status).toBe('pending');
    expect(fresh.getPendingProposal()?.sourceWorkoutId).toBe('w-1');
  });

  it('falls back to an empty proposal on a stale schemaVersion', () => {
    const { storage } = require('../store/storage');
    storage.setItem(
      KEY,
      JSON.stringify({ schemaVersion: 0, proposal: { ...fixtureEntry(), status: 'pending' } }),
    );
    const fresh = require('./pendingProposal');
    expect(fresh.getPendingProposal()).toBeNull();
  });

  it('falls back to an empty proposal on a malformed record (fails isValidProposal) or corrupt JSON', () => {
    const { storage } = require('../store/storage');
    storage.setItem(KEY, JSON.stringify({ schemaVersion: 1, proposal: { status: 'pending' } }));
    const fresh = require('./pendingProposal');
    expect(fresh.getPendingProposal()).toBeNull();
  });

  it('proposePending degrades to session-local when storage.setItem throws — no throw, state still updates', () => {
    const { storage } = require('../store/storage');
    const fresh = require('./pendingProposal');
    jest.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(() => fresh.proposePending(fixtureEntry())).not.toThrow();
    expect(fresh.getPendingProposal()?.status).toBe('pending');
  });
});
