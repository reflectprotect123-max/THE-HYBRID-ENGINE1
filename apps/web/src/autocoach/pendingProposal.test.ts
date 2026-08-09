// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
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

beforeEach(() => {
  localStorage.clear();
  resetPendingProposalForTests();
});

describe('pendingProposal store', () => {
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

  it('persists to localStorage on every write', () => {
    proposePending(fixtureEntry());
    const raw = localStorage.getItem('hybrid-auto-coach-pending-v1');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw as string).proposal.status).toBe('pending');
  });
});
