# Self-Coach Approval Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the self-coached athlete's one-click "Apply" for an autonomous session adjustment with a propose-then-decide gate (Approve/Decline), so nothing autonomous applies without an explicit decision, mirroring the coach-supervised `RosterProgressionView` pattern structurally.

**Architecture:** One new pure store (`pendingProposal.ts`, mirrors `ledger.ts`/`policy.ts`/`consent.ts`'s `useSyncExternalStore` + localStorage idiom) holds at most one frozen `AutoCoachResolution` snapshot per day. `SessionReceipt.tsx` proposes automatically via a `useEffect` once eligible, re-validates the hard-safety gate on every render by reusing the resolution it already recomputes, and withdraws silently if that gate now says `safety_stop`. Approve applies the frozen snapshot through the existing unchanged `planApply → update → recordApply` sequence; Decline just marks the record and stops.

**Tech Stack:** React 18 (hooks, `useSyncExternalStore`), TypeScript, Vitest + `@testing-library/react` + jsdom (already added to `apps/web` this session), existing `@hybrid/auto-coach` and `@hybrid/engine` packages (untouched).

## Global Constraints

- `packages/auto-coach` is not modified — it stays pure (no storage, no network, no persisted proposal concept). Verified: `resolveSession()`'s signature and hard-safety gate (`resolve.ts:78-105`) are read-only in this plan.
- `LedgerEntry.action` stays `'applied' | 'undone'` — no third value. A proposal only touches the ledger after approval.
- Every new/modified test file is colocated (`src/x.ts` next to `src/x.test.ts`), per `CLAUDE.md`.
- Every non-trivial behavior gets a test demonstrated able to fail (mutation-tested), per this repo's established discipline.
- `pnpm run typecheck` and the full `apps/web` Vitest suite must stay green after every task.

---

### Task 1: `pendingProposal.ts` — the new pending-proposal store

**Files:**
- Create: `apps/web/src/autocoach/pendingProposal.ts`
- Test: `apps/web/src/autocoach/pendingProposal.test.ts`

**Interfaces:**
- Produces: `PendingProposal` (type), `NewPendingProposal` (type, `Omit<PendingProposal, 'status'>`), `usePendingProposal(): PendingProposal | null` (hook), `getPendingProposal(): PendingProposal | null` (non-hook read), `proposePending(entry: NewPendingProposal): PendingProposal`, `decidePending(status: 'approved' | 'declined'): void`, `withdrawPending(): void`, `resetPendingProposalForTests(): void`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/src/autocoach/pendingProposal.test.ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @hybrid/web exec vitest run src/autocoach/pendingProposal.test.ts`
Expected: FAIL — `Cannot find module './pendingProposal'` (the file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/src/autocoach/pendingProposal.ts
import { useSyncExternalStore } from 'react';
import type { AutoCoachResolution } from '@hybrid/auto-coach';

/**
 * The self-coach "propose, then decide" gate (docs/RISK_REGISTER.md R2).
 * Additive persistence: its own localStorage key, never a field on
 * EngineDB, invisible to sync — mirrors ledger.ts/policy.ts/consent.ts.
 * Holds at most one record. Date-matching against "today" is the caller's
 * job (SessionReceipt.tsx), the same convention ledger.ts already uses for
 * its own date-matched entries — this store never filters by date itself.
 */

export interface PendingProposal {
  date: string;
  sourceWorkoutId: string;
  sourceWorkoutUpdatedAt: number;
  /** frozen at propose time; approving applies THIS, never a fresh re-resolve */
  resolution: AutoCoachResolution;
  status: 'pending' | 'approved' | 'declined';
}

const KEY = 'hybrid-auto-coach-pending-v1';

interface PendingState {
  schemaVersion: 1;
  proposal: PendingProposal | null;
}

const empty = (): PendingState => ({ schemaVersion: 1, proposal: null });

let state: PendingState = load();
const listeners = new Set<() => void>();

function load(): PendingState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as PendingState;
    if (parsed?.schemaVersion !== 1) return empty();
    return parsed;
  } catch {
    return empty();
  }
}

function persist(next: PendingState): void {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* private mode — pending proposal stays session-local */
  }
  listeners.forEach((l) => l());
}

export function usePendingProposal(): PendingProposal | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state.proposal,
  );
}

/** The non-hook read, for code that runs outside a component render, and
 *  for testing the store in isolation without a React render — mirrors
 *  ledger.ts's getLedgerEntries(). */
export function getPendingProposal(): PendingProposal | null {
  return state.proposal;
}

export type NewPendingProposal = Omit<PendingProposal, 'status'>;

export function proposePending(entry: NewPendingProposal): PendingProposal {
  const full: PendingProposal = { ...entry, status: 'pending' };
  persist({ schemaVersion: 1, proposal: full });
  return full;
}

/** No-op if nothing is pending — matches ledger.ts's own defensive style
 *  for operations that only make sense against an existing record. */
export function decidePending(status: 'approved' | 'declined'): void {
  if (!state.proposal) return;
  persist({ schemaVersion: 1, proposal: { ...state.proposal, status } });
}

export function withdrawPending(): void {
  persist(empty());
}

export function resetPendingProposalForTests(): void {
  persist(empty());
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @hybrid/web exec vitest run src/autocoach/pendingProposal.test.ts`
Expected: PASS — all 8 tests green.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @hybrid/web exec tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/autocoach/pendingProposal.ts apps/web/src/autocoach/pendingProposal.test.ts
git commit -m "Add the self-coach pending-proposal store (R2)"
```

---

### Task 2: `resetLedgerForTests()` — small addition `ledger.ts` needs for Task 3's tests

**Files:**
- Modify: `apps/web/src/autocoach/ledger.ts` (append one export at the end of the file)

**Interfaces:**
- Consumes: the module's existing private `persist`/`empty` functions (already defined in this file — see `apps/web/src/autocoach/ledger.ts:35,56-64`).
- Produces: `resetLedgerForTests(): void`.

`ledger.ts`'s in-memory `state` is a module-level singleton loaded once at import time (`apps/web/src/autocoach/ledger.ts:37`) — `localStorage.clear()` in a test's `beforeEach` does not reset it, only a real write through this module does. `progression-store.ts` already has this exact precedent (`resetProgressionLedgerForTests`); `ledger.ts` doesn't yet, and Task 3's tests need it.

- [ ] **Step 1: Add the export**

Append to the end of `apps/web/src/autocoach/ledger.ts`:

```ts
export function resetLedgerForTests(): void {
  persist(empty());
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @hybrid/web exec tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/autocoach/ledger.ts
git commit -m "Add resetLedgerForTests, mirroring resetProgressionLedgerForTests"
```

---

### Task 3: `SessionReceipt.tsx` — propose/approve/decline flow, plus its first render tests

**Files:**
- Modify: `apps/web/src/autocoach/SessionReceipt.tsx` (full rewrite of the component body — see below; `todaysWorkout`, `STATE_PILL`, `StatePill` are unchanged)
- Test: `apps/web/src/autocoach/SessionReceipt.test.tsx` (new — no render-level test exists for this component today)

**Interfaces:**
- Consumes: `usePendingProposal`, `getPendingProposal`, `proposePending`, `decidePending`, `withdrawPending` (Task 1); `resetLedgerForTests` (Task 2); `canApply`, `planApply`, `ledgerEntryFromApply`, `planUndo` (existing, `applyResolution.ts` — unchanged); `resolveSession` (existing, `@hybrid/auto-coach` — unchanged).
- Produces: no new exports — `SessionReceipt` component's external signature (`{ compact?: boolean }`) is unchanged.

- [ ] **Step 1: Write the failing tests**

```tsx
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @hybrid/web exec vitest run src/autocoach/SessionReceipt.test.tsx`
Expected: FAIL — no `Approve`/`Decline` buttons exist yet (the component still only renders `Apply`), so `getByRole('button', { name: 'Approve' })` throws.

- [ ] **Step 3: Rewrite `SessionReceipt.tsx`**

Replace the entire file with:

```tsx
// apps/web/src/autocoach/SessionReceipt.tsx
import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { resolveSession } from '@hybrid/auto-coach';
import { tombstone, uid, type Workout } from '@hybrid/engine';
import { useDb } from '../store/db';
import { Card, Kicker, cx } from '../ui';
import { canApply, ledgerEntryFromApply, planApply, planUndo } from './applyResolution';
import { canUndo, recordApply, recordUndo, useLedger } from './ledger';
import { decidePending, proposePending, usePendingProposal, withdrawPending } from './pendingProposal';
import { updatePolicy, usePolicy } from './policy';

/**
 * The Auto-Coached receipt for today's session — signal, inference, action,
 * with the original always visible. The resolver's output is a resolved
 * COPY; the coach-authored workout is never mutated. An eligible resolution
 * is PROPOSED automatically (docs/RISK_REGISTER.md R2) — nothing applies
 * until the athlete taps Approve; Decline is always safe, since today's
 * as-authored session is what trains either way, decided or not. Applying
 * writes the FROZEN proposed copy into the real store — in place for a
 * one-off placement, or as a fresh forked one-off when today's workout is a
 * recurring template, so the adaptation never leaks into future
 * occurrences. See applyResolution.ts and pendingProposal.ts.
 */

function todaysWorkout(workouts: Workout[], today: string): Workout | null {
  const wd = new Date(`${today}T00:00:00Z`).getUTCDay();
  return (
    workouts.find((w) => w.dates?.includes(today)) ??
    workouts.find((w) => w.days?.includes(wd)) ??
    null
  );
}

/* State pill — the same rounded-full/outline recipe CheckInCard's pain
   choice already uses one card above this, so the two read as one grammar
   rather than two components that happen to share a screen. */
const STATE_PILL: Record<string, string> = {
  normal: 'text-muted outline-line2',
  advisory: 'text-gold2 outline-gold-line',
  uncertain: 'text-warn outline-warn/40',
  safety_stop: 'text-bad outline-bad/40',
};

function StatePill({ state, confidence }: { state: string; confidence: string }) {
  return (
    <span
      className={cx(
        'ml-auto shrink-0 rounded-full px-1 py-0.5 text-2 uppercase tracking-wide outline outline-1',
        STATE_PILL[state],
      )}
    >
      {state.replace('_', ' ')} · {confidence}
    </span>
  );
}

export function SessionReceipt({ compact }: { compact?: boolean }) {
  const { workouts, update, athleteState } = useDb();
  const policy = usePolicy();
  const ledger = useLedger();
  const pendingRaw = usePendingProposal();
  const nav = useNavigate();
  const today = new Date().toISOString().slice(0, 10);
  const workout = useMemo(() => todaysWorkout(workouts, today), [workouts, today]);

  const r = useMemo(
    () => (workout ? resolveSession({ workout, policy, state: athleteState }) : null),
    [workout, policy, athleteState],
  );

  const pending = pendingRaw?.date === today ? pendingRaw : null;

  // The most recent apply/undo recorded for today, regardless of which
  // workout id it targeted — a fork changes today's resolved workout's id,
  // so matching on today's date (one Auto-Coached decision per day) is what
  // stays valid across that change.
  const latestToday = ledger.find((e) => e.date === today) ?? null;
  const appliedEntry = latestToday?.action === 'applied' ? latestToday : null;

  // Propose automatically once eligible; withdraw silently the moment a
  // fresh resolve (this same render's `r`) turns hard-unsafe. A decided
  // (approved/declined) proposal is left alone — a decision, once made,
  // stays made for the day.
  useEffect(() => {
    if (!workout || !r || appliedEntry) return;
    if (pending) {
      if (pending.status === 'pending' && r.state === 'safety_stop') withdrawPending();
      return;
    }
    if (canApply(r)) {
      proposePending({
        date: today,
        sourceWorkoutId: workout.id,
        sourceWorkoutUpdatedAt: workout.updatedAt,
        resolution: r,
      });
    }
  }, [workout, r, pending, appliedEntry, today]);

  if (!workout || policy.status === 'revoked' || !r) return null;

  const changed = r.operations.some((o) => o.type !== 'keep_as_planned');
  if (compact && !changed) return null;

  const showDecide = pending?.status === 'pending';
  const showUndo = appliedEntry !== null && canUndo(appliedEntry);

  const handleApprove = () => {
    if (!pending || pending.status !== 'pending') return;
    // Defence-in-depth backstop: the effect above should already have
    // withdrawn a now-unsafe proposal before this button could be clicked,
    // but a hard constraint could in principle land between that render and
    // this click, so the safety check is repeated here too.
    if (r.state === 'safety_stop') {
      withdrawPending();
      return;
    }
    const plan = planApply(workout, pending.resolution, today, uid);
    update((draft) => {
      if (plan.kind === 'mutate') {
        const target = draft.workouts.find((x) => x.id === plan.workoutId);
        if (!target) return false;
        target.blocks = plan.afterBlocks;
        target.updatedAt = Date.now();
      } else {
        draft.workouts.push({
          id: plan.forkedWorkoutId,
          name: plan.name,
          kind: plan.workoutKind,
          blocks: plan.blocks,
          dates: [plan.date],
          updatedAt: Date.now(),
        });
      }
    });
    recordApply(ledgerEntryFromApply(plan, pending.resolution, today));
    decidePending('approved');
  };

  const handleDecline = () => {
    if (!pending || pending.status !== 'pending') return;
    decidePending('declined');
  };

  const handleUndo = () => {
    if (!appliedEntry) return;
    const plan = planUndo(appliedEntry);
    if (!plan) return;
    update((draft) => {
      if (plan.kind === 'restore') {
        const target = draft.workouts.find((x) => x.id === plan.workoutId);
        if (!target) return false;
        target.blocks = plan.blocks;
        target.updatedAt = Date.now();
      } else {
        const i = draft.workouts.findIndex((x) => x.id === plan.workoutId);
        if (i >= 0) draft.workouts.splice(i, 1);
        // Undo removes a workout the apply may already have pushed, so the
        // removal needs a tombstone or the other device hands it back.
        tombstone(draft, plan.workoutId);
      }
    });
    recordUndo(appliedEntry);
  };

  // Nothing to review recedes; anything worth a look — a proposed change or a
  // safety stop — carries the screen's default weight so it isn't mistaken
  // for reference material the way a quiet card would read.
  const quiet = r.state === 'normal' && !changed;

  return (
    <Card
      tone={quiet ? 'quiet' : undefined}
      className={cx('flex flex-col gap-1', r.state === 'safety_stop' && 'border-bad/40')}
    >
      <div className="flex items-baseline gap-1">
        <Kicker>Auto-Coached · {policy.status === 'paused' ? 'paused' : policy.mode}</Kicker>
        <StatePill state={r.state} confidence={r.confidence} />
      </div>

      <p className="text-3 text-text">{r.athleteMessage}</p>

      {changed && (
        <ul className="flex flex-col gap-0.5">
          {r.operations
            .filter((o) => o.type !== 'keep_as_planned')
            .map((o, i) => (
              <li key={i} className="rounded bg-well px-1 py-0.5 text-3 tabular-nums">
                <span className="text-dim line-through">{o.before}</span>
                <span className="text-muted"> → </span>
                <span className="text-gold2">{o.after}</span>
              </li>
            ))}
        </ul>
      )}

      {appliedEntry && (
        <p className="text-3 text-ok">
          Applied{appliedEntry.wasForked ? ' — today only, future sessions are unchanged' : ''} — undo
          available.
        </p>
      )}

      {!compact && (
        <details className="text-3 text-muted">
          <summary className="cursor-pointer text-dim">Why — signals and inference</summary>
          <ul className="mt-0.5 space-y-[1px]">
            {r.signals.map((s, i) => (
              <li key={i} className={cx(s.quality !== 'known' && 'text-dim')}>
                · {s.text}
              </li>
            ))}
            {r.inferences.map((s, i) => (
              <li key={`i${i}`} className="text-muted">
                → {s}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex items-center gap-1">
        <span className="text-2 text-dim">
          {policy.mode === 'shadow'
            ? 'Shadow mode — shown, never applied. The plan itself is unchanged.'
            : 'Nothing applies without your confirmation.'}
        </span>
        <button
          className="ml-auto shrink-0 rounded px-1 py-0.5 text-3 text-muted outline outline-1 outline-line hover:text-text focus-visible:outline-2 focus-visible:outline-gold2 focus-visible:outline-offset-2"
          aria-pressed={policy.status === 'paused'}
          onClick={() =>
            updatePolicy((p) => ({ ...p, status: p.status === 'paused' ? 'active' : 'paused' }))
          }
        >
          {policy.status === 'paused' ? 'Resume' : 'Pause'}
        </button>
        {showDecide && (
          <>
            <button
              className="shrink-0 rounded px-1 py-0.5 text-3 text-muted outline outline-1 outline-line hover:text-text focus-visible:outline-2 focus-visible:outline-gold2 focus-visible:outline-offset-2"
              onClick={handleDecline}
            >
              Decline
            </button>
            <button
              className="shrink-0 rounded bg-gold-wash px-1 py-0.5 text-3 text-gold2 outline outline-1 outline-gold-line hover:brightness-110 focus-visible:outline-2 focus-visible:outline-gold2 focus-visible:outline-offset-2"
              onClick={handleApprove}
            >
              Approve
            </button>
          </>
        )}
        {showUndo && (
          <button
            className="shrink-0 rounded px-1 py-0.5 text-3 text-muted outline outline-1 outline-line hover:text-text focus-visible:outline-2 focus-visible:outline-gold2 focus-visible:outline-offset-2"
            onClick={handleUndo}
          >
            Undo
          </button>
        )}
        {(r.state === 'safety_stop' || r.state === 'uncertain') && (
          <button
            className="shrink-0 rounded bg-gold-wash px-1 py-0.5 text-3 text-gold2 outline outline-1 outline-gold-line focus-visible:outline-2 focus-visible:outline-gold2 focus-visible:outline-offset-2"
            onClick={() => nav('/settings')}
          >
            Review check-in
          </button>
        )}
      </div>
    </Card>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @hybrid/web exec vitest run src/autocoach/SessionReceipt.test.tsx`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Mutation-test the stale-withdrawal behavior**

Temporarily change the effect's withdrawal condition in `SessionReceipt.tsx` from:
```ts
if (pending.status === 'pending' && r.state === 'safety_stop') withdrawPending();
```
to a no-op (comment it out or replace the body with nothing), then run:

Run: `pnpm --filter @hybrid/web exec vitest run src/autocoach/SessionReceipt.test.tsx -t "withdraws"`
Expected: FAIL — `getPendingProposal()` is still `'pending'`, proving the test actually exercises the withdrawal logic and isn't vacuously passing.

Restore the line exactly as written in Step 3, then re-run:

Run: `pnpm --filter @hybrid/web exec vitest run src/autocoach/SessionReceipt.test.tsx -t "withdraws"`
Expected: PASS.

- [ ] **Step 6: Run the full `apps/web` regression suite**

Run: `pnpm --filter @hybrid/web exec vitest run`
Expected: every existing test still passes, including `autocoach-apply.test.ts` and `autocoach-consent.test.ts` (untouched pure logic) and every coach-bench render test (unrelated files).

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @hybrid/web exec tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/autocoach/SessionReceipt.tsx apps/web/src/autocoach/SessionReceipt.test.tsx
git commit -m "Gate self-coach autonomous adjustments behind Approve/Decline (R2)"
```

---

### Task 4: Consent and mode-switcher copy — stop promising immediate, unasked application

**Files:**
- Modify: `apps/web/src/autocoach/ModeSwitcher.tsx:32` and `:191`
- Modify: `apps/web/src/autocoach/consent.ts:21` (`CONSENT_TEXT_VERSION`)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — copy-only change plus one version bump.

`COMPREHENSION_STATEMENTS` (`consent.ts:107-113`) needs no wording change — "It can make small changes to today's session" and "Material changes are shown before you train" both stay true, and arguably become more true, under the new gate. Only the two strings below claim the OLD immediate/unasked behavior.

- [ ] **Step 1: Update the mode description**

In `apps/web/src/autocoach/ModeSwitcher.tsx`, change:
```ts
  auto_daily: 'Applies permitted changes to today automatically. Review stays available; pause is one tap.',
```
to:
```ts
  auto_daily: 'Suggests permitted changes to today automatically — nothing applies until you approve it. Review stays available; pause is one tap.',
```

- [ ] **Step 2: Update the auto-apply consent paragraph**

In `apps/web/src/autocoach/ModeSwitcher.tsx`, in the `stage === 'autoApplyConsent'` block, change:
```tsx
          <p className="text-3 text-text">
            Permitted changes will apply to today’s session without asking first — review is always available, and pausing is one tap.
          </p>
```
to:
```tsx
          <p className="text-3 text-text">
            Permitted changes will be suggested for today’s session and applied only once you approve them — review is always available, and pausing is one tap.
          </p>
```

- [ ] **Step 3: Bump the consent text version**

In `apps/web/src/autocoach/consent.ts`, change:
```ts
export const CONSENT_TEXT_VERSION = 1;
```
to:
```ts
export const CONSENT_TEXT_VERSION = 2;
```

This is the field the module's own comment says exists so "a stale acceptance can be told apart from one made against the current text" (`consent.ts:19-20`) — the auto-apply consent paragraph just changed materially, so an athlete who accepted under the old wording should be distinguishable from one who accepted under this one.

- [ ] **Step 4: Run the existing consent tests**

Run: `pnpm --filter @hybrid/web exec vitest run src/autocoach/autocoach-consent.test.ts`
Expected: PASS — these tests exercise `allComprehensionCorrect`/`highestAllowedMode`, neither of which reads the changed strings or `CONSENT_TEXT_VERSION`'s value directly, so no test changes are needed here.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @hybrid/web exec tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/autocoach/ModeSwitcher.tsx apps/web/src/autocoach/consent.ts
git commit -m "Update Auto-Coached copy to match the new approve/decline gate"
```

---

### Task 5: Full verification and risk register update

**Files:**
- Modify: `docs/RISK_REGISTER.md` (mark R2 resolved)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — documentation only.

- [ ] **Step 1: Full typecheck**

Run: `pnpm run typecheck`
Expected: 17/17 projects pass.

- [ ] **Step 2: Full `apps/web` test suite**

Run: `pnpm --filter @hybrid/web exec vitest run`
Expected: every test passes, count increased by the ~13 new tests from Tasks 1 and 3.

- [ ] **Step 3: Repo-wide checks**

Run: `node checks/docs.mjs && node checks/coach-contract.mjs && node checks/ecosystem-contract.mjs`
Expected: all green — none of these touch `apps/web/src/autocoach/**`, so this is a regression guard, not an expected-change area.

- [ ] **Step 4: Update the risk register**

In `docs/RISK_REGISTER.md`, find R2 (self-coach progression auto-banking without approval) and mark it RESOLVED, in the same style as the existing R3/R7/R8 resolved entries: what changed (propose-then-decide gate, `pendingProposal.ts`, `SessionReceipt.tsx`), the design doc it came from (`docs/superpowers/specs/2026-08-09-self-coach-approval-gate-design.md`), and the mutation-test note from Task 3 Step 5.

- [ ] **Step 5: Commit**

```bash
git add docs/RISK_REGISTER.md
git commit -m "Mark R2 (self-coach approval gate) resolved"
```

---

## Self-Review

**Spec coverage:** every section of `docs/superpowers/specs/2026-08-09-self-coach-approval-gate-design.md` maps to a task — data model → Task 1; flow (propose/staleness re-check/approve/decline/day-boundary) → Task 3; UI → Task 3; copy → Task 4; testing → Tasks 1, 3, 5; out-of-scope boundary (`autocoach_receipts`) → untouched by design, no task references it.

**Placeholder scan:** no TBD/TODO; every step carries real, complete code or an exact command; no "similar to Task N" shortcuts — Task 3's Step 3 repeats every unchanged line of `SessionReceipt.tsx` in full rather than describing a diff, since a plan reader may work task-by-task without the original file open.

**Type consistency:** `PendingProposal`/`NewPendingProposal`/`proposePending`/`decidePending`/`withdrawPending`/`usePendingProposal`/`getPendingProposal`/`resetPendingProposalForTests` (Task 1) are used with identical names and signatures in Task 3's import line and test file. `resetLedgerForTests` (Task 2) matches its Task 3 test-file import exactly.
