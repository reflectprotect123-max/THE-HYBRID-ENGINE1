// apps/web/src/autocoach/SessionReceipt.test.tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workout } from '@hybrid/engine';
import type { AthleteStateSnapshot, StateConstraint } from '@hybrid/whole-athlete-state';
import { updatePolicy } from './policy';
import { resetLedgerForTests } from './ledger';
import { decidePending, getPendingProposal, proposePending, resetPendingProposalForTests } from './pendingProposal';
import { SessionReceipt } from './SessionReceipt';
import type { AutoCoachResolution } from '@hybrid/auto-coach';

/*
 * docs/RISK_REGISTER.md R2. SessionReceipt has no render-level test today —
 * only the pure logic it calls (applyResolution.ts, resolve.ts) does. This
 * covers the propose/approve/decline gate this change adds: proposing must
 * never mutate, approving must run the exact existing apply sequence, and a
 * newly-arrived pain/illness hard constraint must silently withdraw a
 * pending proposal rather than leave it clickable.
 */

const TODAY = new Date().toISOString().slice(0, 10);

function strengthWorkout(over: Partial<Workout> = {}): Workout {
  return {
    id: 'w-1',
    name: 'Heavy Lower',
    kind: 'strength',
    dates: [TODAY],
    updatedAt: 1000,
    blocks: [
      {
        id: 'work',
        exercises: [{ id: 'e1', name: 'Back Squat', mode: 'reps_kg', sets: [{ t: '5', rpe: '8' }] }],
      },
    ],
    ...over,
  } as Workout;
}

function constraint(over: Partial<StateConstraint> = {}): StateConstraint {
  return {
    code: 'low_readiness',
    domain: 'both',
    hard: false,
    reason: 'Readiness is low',
    adjustment: 'Cap the session around RPE 7',
    ...over,
  };
}

function snapshot(over: Partial<AthleteStateSnapshot> = {}): AthleteStateSnapshot {
  return {
    schemaVersion: 1,
    asOf: TODAY,
    readiness: { score: 30, band: 'low', confidence: 'good', signals: [], rationale: [] },
    recoveryDebt: { score: 10, band: 'low', daysObserved: 5, rationale: [] },
    capacity: { overall: 'moderate', strength: 'moderate', conditioning: 'moderate' },
    illness: { status: 'clear', source: 'none' },
    constraints: [constraint()],
    dataQuality: 'good',
    advisory: { hrvMs: null, note: '' },
    ...over,
  } as AthleteStateSnapshot;
}

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

let mockWorkouts: Workout[] = [];
let mockAthleteState: AthleteStateSnapshot = snapshot();
const mockUpdate = vi.fn((fn: (draft: { workouts: Workout[] }) => void | false) => {
  const draft = { workouts: mockWorkouts.map((w) => ({ ...w })) };
  const result = fn(draft);
  if (result === false) return;
  mockWorkouts = draft.workouts;
});

vi.mock('../store/db', () => ({
  useDb: () => ({ workouts: mockWorkouts, update: mockUpdate, athleteState: mockAthleteState }),
}));

async function renderReceipt() {
  const result = render(
    <MemoryRouter>
      <SessionReceipt />
    </MemoryRouter>,
  );
  await act(async () => {});
  return result;
}

beforeEach(() => {
  localStorage.clear();
  resetLedgerForTests();
  resetPendingProposalForTests();
  mockUpdate.mockClear();
  mockWorkouts = [strengthWorkout()];
  mockAthleteState = snapshot();
  updatePolicy(() => ({
    schemaVersion: 1,
    version: 1,
    owner: 'athlete',
    mode: 'auto_daily',
    status: 'active',
    permissions: { cap_intensity: 'auto', trim_conditioning_minutes: 'auto', hold_progression: 'auto' },
    rpeCap: 7,
    minConditioningFraction: 0.5,
  }));
});

describe('SessionReceipt — propose, approve, decline', () => {
  it('proposes automatically when eligible, without mutating the workout', async () => {
    await renderReceipt();

    expect(getPendingProposal()?.status).toBe('pending');
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeInTheDocument();
  });

  it('approving mutates the workout, records a ledger entry, and marks the proposal approved', async () => {
    await renderReceipt();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(getPendingProposal()?.status).toBe('approved');
    expect(screen.getByText(/Applied/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('declining marks the proposal declined without mutating, and the card does not return on a later render', async () => {
    await renderReceipt();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    });

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(getPendingProposal()?.status).toBe('declined');
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();

    // A second full render (e.g. the athlete leaves and comes back) must not
    // re-propose or re-show the card for an already-declined day.
    await renderReceipt();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(getPendingProposal()?.status).toBe('declined');
  });

  it('a new hard pain constraint withdraws a pending proposal silently, on the very next render', async () => {
    await renderReceipt();
    expect(getPendingProposal()?.status).toBe('pending');

    // A pain hold gets logged after the proposal was raised but before it's decided.
    mockAthleteState = snapshot({
      constraints: [
        constraint({ code: 'pain_hold_active', hard: true, reason: 'Pain hold is active', adjustment: 'Stop the affected work' }),
      ],
    });
    await renderReceipt();

    expect(getPendingProposal()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('a new day proposes fresh, ignoring a stale-dated declined proposal', async () => {
    proposePending({
      date: '2000-01-01',
      sourceWorkoutId: 'w-1',
      sourceWorkoutUpdatedAt: 1000,
      resolution: fixtureResolution(),
    });
    decidePending('declined');
    expect(getPendingProposal()?.date).toBe('2000-01-01');
    expect(getPendingProposal()?.status).toBe('declined');

    await renderReceipt();

    expect(getPendingProposal()?.date).toBe(TODAY);
    expect(getPendingProposal()?.status).toBe('pending');
  });
});
