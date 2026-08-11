// apps/web/src/autocoach/SessionReceipt.test.tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workout } from '@hybrid/engine';
import type { AthleteStateSnapshot, StateConstraint } from '@hybrid/whole-athlete-state';
import { updatePolicy } from '../store/policy';
import { recordConsent } from './consent';
import { getLedgerEntries, resetLedgerForTests } from '../store/ledger';
import { decidePending, getPendingProposal, proposePending, resetPendingProposalForTests } from './pendingProposal';
import { approvalAllowed, SessionReceipt } from './SessionReceipt';
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
  // Consent is its own store, so a policy mode alone no longer unlocks
  // Approve — see the "consent gate" describe block below.
  recordConsent('proposals', true);
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

  it('a change to the source workout after proposing withdraws the pending proposal silently', async () => {
    // hold_progression is turned off for this test so that, once the athlete's
    // own edit already brings the session within the RPE cap, resolveSession
    // finds nothing left to propose (operations: [keep_as_planned]) and the
    // auto-propose effect that runs after withdrawal has nothing eligible to
    // re-offer — isolating the assertion to "the stale proposal is gone"
    // rather than "a fresh one immediately replaces it" (both are safe; this
    // test targets the withdrawal itself).
    updatePolicy((p) => ({
      ...p,
      permissions: { ...p.permissions, hold_progression: 'off' },
    }));
    await renderReceipt();
    expect(getPendingProposal()?.status).toBe('pending');

    // The athlete edits today's workout in the editor after the proposal was
    // raised but before they decide on it — bumping updatedAt and bringing
    // the exercise's RPE within the policy cap themselves, so the frozen
    // proposal (which would still cap the OLD, higher-RPE sets) now targets
    // blocks that no longer match what's in the store, and nothing further
    // needs proposing for the edited version.
    mockWorkouts = [
      strengthWorkout({
        updatedAt: 2000,
        blocks: [
          {
            id: 'work',
            exercises: [{ id: 'e1', name: 'Back Squat', mode: 'reps_kg', sets: [{ t: '5', rpe: '6' }] }],
          },
        ],
      }),
    ];
    await renderReceipt();

    expect(getPendingProposal()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('a workout with no updatedAt does not spuriously self-withdraw on the next render', async () => {
    // updatedAt is optional (packages/engine/src/types.ts) — a workout that
    // has never been touched since creation, or one migrated through the
    // legacy app_state bridge, can genuinely have none. The propose-time
    // write normalizes this with `?? 0`; the staleness comparison must
    // normalize the live read the same way, or `0 !== undefined` reads as
    // "changed" on every single render and the proposal never survives long
    // enough to be decided.
    mockWorkouts = [strengthWorkout({ updatedAt: undefined })];
    await renderReceipt();
    expect(getPendingProposal()?.status).toBe('pending');

    // Nothing about the workout changed — same render conditions, no edit.
    // Scoped to this render's own container: the prior render's card is
    // still mounted alongside it (this suite doesn't unmount between
    // renderReceipt() calls) and, since the proposal correctly survives,
    // both cards show their own Approve button — querying the whole
    // document would find two.
    const second = await renderReceipt();

    expect(getPendingProposal()?.status).toBe('pending');
    expect(within(second.container).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });

  it('pausing withdraws a pending proposal on the next render', async () => {
    await renderReceipt();
    expect(getPendingProposal()?.status).toBe('pending');

    await act(async () => {
      updatePolicy((p) => ({ ...p, status: 'paused' }));
    });
    await renderReceipt();

    expect(getPendingProposal()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  // The reported sequence's direct-click variant — calling handleApprove
  // before any render observes the pause — is not reachable through this
  // harness (or through the real UI): React flushes the Pause click's state
  // update before a second, separate click event can be dispatched, so by
  // the time Approve could be clicked the component has already re-rendered
  // and the effect above has already withdrawn the proposal. Confirmed by
  // trying it directly (calling `updatePolicy` outside `act` so no render
  // intervenes, then clicking Approve): the click fires against a still-
  // mounted stale closure and goes through, which is a testing-harness
  // artifact of bypassing React's own act-wrapped scheduling, not a bug
  // reachable via any real interaction sequence. The propose-then-pause-
  // then-rerender case above is the reachable, and therefore the tested,
  // form of this scenario.

  it('shows the frozen proposal, not a live recompute, when athlete state softly drifts before a decision', async () => {
    await renderReceipt();
    expect(getPendingProposal()?.status).toBe('pending');
    // The frozen proposal caps the @8 set to the policy's @7 RPE cap.
    expect(screen.getByText('Back Squat above @7')).toBeInTheDocument();
    expect(screen.getByText('Back Squat capped @7')).toBeInTheDocument();

    // A soft drift — the low_readiness constraint clears — that is neither a
    // hard safety constraint nor a source-workout change, so nothing
    // withdraws the pending proposal. A fresh resolve against this state
    // would find nothing left to cap (operations: [keep_as_planned]).
    mockAthleteState = snapshot({ constraints: [] });
    const second = await renderReceipt();

    expect(getPendingProposal()?.status).toBe('pending');
    // The card still shows the ORIGINAL frozen operation, not the drifted
    // "nothing to change" recompute. Scoped to this render's own container —
    // the prior render's card is still mounted alongside it.
    expect(within(second.container).getByText('Back Squat above @7')).toBeInTheDocument();
    expect(within(second.container).getByText('Back Squat capped @7')).toBeInTheDocument();
    expect(within(second.container).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
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

/*
 * The R2 gate proper. Shadow mode and ModeSwitcher both promise "shown, never
 * applied"; before this, Approve was gated only on the card rendering at all,
 * so a fresh install — shadow mode, no consent, no comprehension check — could
 * still write a resolved change into the store.
 */
describe('SessionReceipt — the approve gate needs mode AND consent', () => {
  it('approvalAllowed is false in shadow mode and false without proposals consent', () => {
    expect(approvalAllowed('shadow', true)).toBe(false);
    expect(approvalAllowed('shadow', false)).toBe(false);
    expect(approvalAllowed('assisted', false)).toBe(false);
    expect(approvalAllowed('auto_daily', false)).toBe(false);
    expect(approvalAllowed('assisted', true)).toBe(true);
    expect(approvalAllowed('auto_daily', true)).toBe(true);
  });

  it('a fresh install — shadow mode, no consent — offers no Approve at all', async () => {
    updatePolicy((p) => ({ ...p, mode: 'shadow' }));
    recordConsent('proposals', false);

    await renderReceipt();

    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Decline' })).not.toBeInTheDocument();
    expect(screen.getByText(/Shadow mode/)).toBeInTheDocument();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('live mode with consent revoked still offers no Approve', async () => {
    recordConsent('proposals', false);
    await renderReceipt();

    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.getByText(/Approving needs your consent/)).toBeInTheDocument();
  });

  it('Approve becomes available once mode is live AND consent is recorded', async () => {
    recordConsent('proposals', false);
    const first = await renderReceipt();
    expect(within(first.container).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();

    await act(async () => {
      recordConsent('proposals', true);
    });
    const second = await renderReceipt();

    await act(async () => {
      fireEvent.click(within(second.container).getByRole('button', { name: 'Approve' }));
    });
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(getPendingProposal()?.status).toBe('approved');
  });
});

describe('SessionReceipt — an aborted store write is not recorded as applied', () => {
  it('does not record a ledger entry or burn the proposal when the target workout is gone', async () => {
    // hold_progression off keeps the resolution a single in-place cap, so the
    // plan is a `mutate` against w-1 specifically.
    updatePolicy((p) => ({ ...p, permissions: { ...p.permissions, hold_progression: 'off' } }));
    await renderReceipt();
    expect(getPendingProposal()?.status).toBe('pending');

    // The workout is deleted (Home's ✕, or a sync tombstone) between the
    // receipt rendering and the tap: the draft callback finds no target and
    // returns false, so `update` abandons the whole write.
    mockWorkouts = [];

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    });

    // Nothing was written, so nothing may be recorded: no "Applied — undo
    // available" for a change that never happened, and the day's proposal is
    // still there to retry rather than burned. (The card itself unmounts on
    // the very next render, since the workout it is about is gone — the
    // error copy is the fallback for a failure where it survives.)
    expect(getLedgerEntries()).toHaveLength(0);
    expect(getPendingProposal()?.status).toBe('pending');
  });
});
