import type { AutoCoachResolution } from '@hybrid/auto-coach';
import {
  decidePending,
  getPendingProposal,
  getPendingProposals,
  pendingKey,
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

const K1 = pendingKey('2026-08-09', 'w-1');

beforeEach(() => resetPendingProposalForTests());

describe('mobile pendingProposal store', () => {
  it('starts empty', () => {
    expect(getPendingProposal(K1)).toBeNull();
  });

  it('proposePending creates a record with status pending', () => {
    proposePending(fixtureEntry());
    const p = getPendingProposal(K1);
    expect(p?.status).toBe('pending');
    expect(p?.date).toBe('2026-08-09');
    expect(p?.sourceWorkoutId).toBe('w-1');
  });

  it('decidePending flips status to approved without touching other fields', () => {
    proposePending(fixtureEntry({ sourceWorkoutUpdatedAt: 42 }));
    decidePending(K1, 'approved');
    const p = getPendingProposal(K1);
    expect(p?.status).toBe('approved');
    expect(p?.sourceWorkoutUpdatedAt).toBe(42);
  });

  it('decidePending declined leaves status declined', () => {
    proposePending(fixtureEntry());
    decidePending(K1, 'declined');
    expect(getPendingProposal(K1)?.status).toBe('declined');
  });

  it('decidePending is a no-op when there is no proposal under that key', () => {
    decidePending(K1, 'approved');
    expect(getPendingProposal(K1)).toBeNull();
  });

  it('withdrawPending clears that record entirely', () => {
    proposePending(fixtureEntry());
    withdrawPending(K1);
    expect(getPendingProposal(K1)).toBeNull();
  });

  it('a fresh proposePending call replaces the record for the SAME date and workout', () => {
    proposePending(fixtureEntry());
    decidePending(K1, 'declined');
    proposePending(fixtureEntry({ sourceWorkoutUpdatedAt: 2000 }));
    const p = getPendingProposal(K1);
    expect(p?.status).toBe('pending');
    expect(p?.sourceWorkoutUpdatedAt).toBe(2000);
  });

  it('proposing for a new date drops every record from an older one', () => {
    proposePending(fixtureEntry({ date: '2026-08-08' }));
    proposePending(fixtureEntry({ date: '2026-08-09' }));
    expect(getPendingProposal(pendingKey('2026-08-08', 'w-1'))).toBeNull();
    expect(getPendingProposal(K1)?.status).toBe('pending');
  });

  /*
   * The merged app's two worlds. `useDb().workouts` is scoped per world, so
   * a Strength and a Conditioning session on the same date each raise their
   * own receipt. Under a single date-keyed record, deciding one consumed the
   * other's proposal.
   */
  describe('same-day, two worlds', () => {
    const STRENGTH = pendingKey('2026-08-09', 'w-strength');
    const CONDITIONING = pendingKey('2026-08-09', 'w-cond');

    beforeEach(() => {
      proposePending(fixtureEntry({ sourceWorkoutId: 'w-strength' }));
      proposePending(fixtureEntry({ sourceWorkoutId: 'w-cond' }));
    });

    it('holds a separate proposal per workout on the same date', () => {
      expect(Object.keys(getPendingProposals())).toHaveLength(2);
      expect(getPendingProposal(STRENGTH)?.status).toBe('pending');
      expect(getPendingProposal(CONDITIONING)?.status).toBe('pending');
    });

    it('approving the strength session leaves the conditioning one pending', () => {
      decidePending(STRENGTH, 'approved');
      expect(getPendingProposal(STRENGTH)?.status).toBe('approved');
      expect(getPendingProposal(CONDITIONING)?.status).toBe('pending');
    });

    it('declining the strength session does not decline the conditioning one', () => {
      decidePending(STRENGTH, 'declined');
      expect(getPendingProposal(CONDITIONING)?.status).toBe('pending');
    });

    it('withdrawing one world does not withdraw the other', () => {
      withdrawPending(STRENGTH);
      expect(getPendingProposal(STRENGTH)).toBeNull();
      expect(getPendingProposal(CONDITIONING)?.status).toBe('pending');
    });

    it('proposing for one world does not reset the other world already-made decision', () => {
      decidePending(CONDITIONING, 'declined');
      proposePending(fixtureEntry({ sourceWorkoutId: 'w-strength', sourceWorkoutUpdatedAt: 3000 }));
      expect(getPendingProposal(CONDITIONING)?.status).toBe('declined');
    });
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

  it('reads back valid persisted proposals on load()', () => {
    const { storage } = require('../store/storage');
    const seeded = {
      schemaVersion: 2,
      proposals: { [K1]: { ...fixtureEntry(), status: 'pending' } },
    };
    storage.setItem(KEY, JSON.stringify(seeded));
    const fresh = require('./pendingProposal');
    expect(fresh.getPendingProposal(K1)?.status).toBe('pending');
    expect(fresh.getPendingProposal(K1)?.sourceWorkoutId).toBe('w-1');
  });

  it('falls back to empty on a stale schemaVersion — including the v1 single-record shape', () => {
    const { storage } = require('../store/storage');
    storage.setItem(
      KEY,
      JSON.stringify({ schemaVersion: 1, proposal: { ...fixtureEntry(), status: 'pending' } }),
    );
    const fresh = require('./pendingProposal');
    expect(fresh.getPendingProposals()).toEqual({});
  });

  it('drops a malformed record (fails isValidProposal) and keeps the valid ones', () => {
    const { storage } = require('../store/storage');
    storage.setItem(
      KEY,
      JSON.stringify({
        schemaVersion: 2,
        proposals: { bad: { status: 'pending' }, [K1]: { ...fixtureEntry(), status: 'pending' } },
      }),
    );
    const fresh = require('./pendingProposal');
    expect(fresh.getPendingProposal('bad')).toBeNull();
    expect(fresh.getPendingProposal(K1)?.status).toBe('pending');
  });

  it('proposePending degrades to session-local when storage.setItem throws — no throw, state still updates', () => {
    const { storage } = require('../store/storage');
    const fresh = require('./pendingProposal');
    jest.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(() => fresh.proposePending(fixtureEntry())).not.toThrow();
    expect(fresh.getPendingProposal(K1)?.status).toBe('pending');
  });
});
