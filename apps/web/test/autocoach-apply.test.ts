import { describe, expect, it } from 'vitest';
import type { Workout } from '@hybrid/engine';
import type { AutoCoachResolution, ResolutionOperation } from '@hybrid/auto-coach';
import {
  canApply,
  isOneOffToday,
  ledgerEntryFromApply,
  planApply,
  planUndo,
} from '../src/autocoach/applyResolution';
import type { LedgerEntry } from '../src/autocoach/ledger';

const TODAY = '2026-08-06';

function w(over: Partial<Workout>): Workout {
  return { id: over.id ?? 'w1', blocks: [], ...over } as Workout;
}

function op(over: Partial<ResolutionOperation> = {}): ResolutionOperation {
  return {
    type: 'cap_intensity',
    targetPath: 'blocks[0]',
    before: 'effort hard',
    after: 'effort medium',
    reasonCode: 'low_readiness',
    materiality: 'low',
    reversible: true,
    ...over,
  };
}

function resolution(over: Partial<AutoCoachResolution> = {}): AutoCoachResolution {
  return {
    schemaVersion: 1,
    state: 'advisory',
    originalWorkoutId: 'w1',
    resolvedWorkout: w({ id: 'w1', blocks: [{ id: 'b1', exercises: [] } as never] }),
    operations: [op()],
    signals: [],
    inferences: [],
    reasonCodes: ['low_readiness'],
    confidence: 'high',
    requiresConfirmation: false,
    autoApplyAllowed: true,
    athleteMessage: 'x',
    ...over,
  };
}

describe('isOneOffToday', () => {
  it('is true for a workout dated today with no recurring days', () => {
    expect(isOneOffToday(w({ dates: [TODAY] }), TODAY)).toBe(true);
  });

  it('is false for a purely recurring workout', () => {
    expect(isOneOffToday(w({ days: [4] }), TODAY)).toBe(false);
  });

  it('is false when the workout also carries days, even if dated today', () => {
    // Same object still projects onto other weekdays — mutating it in place
    // would leak into those, so it must be forked like any recurring template.
    expect(isOneOffToday(w({ dates: [TODAY], days: [4] }), TODAY)).toBe(false);
  });

  it('is false for a one-off dated on a different day', () => {
    expect(isOneOffToday(w({ dates: ['2026-08-07'] }), TODAY)).toBe(false);
  });
});

describe('planApply', () => {
  it('mutates in place for a one-off workout dated today', () => {
    const workout = w({ id: 'w1', dates: [TODAY], blocks: [{ id: 'old' } as never] });
    const r = resolution();
    const plan = planApply(workout, r, TODAY, () => 'unused');
    expect(plan.kind).toBe('mutate');
    if (plan.kind === 'mutate') {
      expect(plan.workoutId).toBe('w1');
      expect(plan.beforeBlocks).toEqual([{ id: 'old' }]);
      expect(plan.afterBlocks).toEqual(r.resolvedWorkout.blocks);
    }
  });

  it('forks a recurring workout into a fresh one-off dated today', () => {
    const workout = w({ id: 'w1', name: 'Heavy Lower', kind: 'strength', days: [4] });
    const r = resolution();
    const plan = planApply(workout, r, TODAY, () => 'new-id');
    expect(plan.kind).toBe('fork');
    if (plan.kind === 'fork') {
      expect(plan.forkedWorkoutId).toBe('new-id');
      expect(plan.sourceWorkoutId).toBe('w1');
      expect(plan.name).toBe('Heavy Lower');
      expect(plan.workoutKind).toBe('strength');
      expect(plan.date).toBe(TODAY);
      expect(plan.blocks).toEqual(r.resolvedWorkout.blocks);
    }
  });

  it('never mutates the source workout object', () => {
    const workout = w({ id: 'w1', dates: [TODAY], blocks: [{ id: 'old' } as never] });
    const before = JSON.stringify(workout);
    planApply(workout, resolution(), TODAY, () => 'x');
    expect(JSON.stringify(workout)).toBe(before);
  });

  it('forks a workout with both dates and days rather than mutating it', () => {
    const workout = w({ id: 'w1', dates: [TODAY], days: [4], blocks: [{ id: 'old' } as never] });
    const plan = planApply(workout, resolution(), TODAY, () => 'forked-id');
    expect(plan.kind).toBe('fork');
  });
});

describe('canApply', () => {
  it('is false for a safety stop, regardless of confirmation/auto flags', () => {
    expect(
      canApply(
        resolution({
          state: 'safety_stop',
          autoApplyAllowed: false,
          requiresConfirmation: true,
          operations: [op({ type: 'rest_or_pause' })],
        }),
      ),
    ).toBe(false);
  });

  it('is false when nothing changed (keep_as_planned only)', () => {
    expect(
      canApply(
        resolution({
          state: 'normal',
          autoApplyAllowed: false,
          requiresConfirmation: false,
          operations: [op({ type: 'keep_as_planned' })],
        }),
      ),
    ).toBe(false);
  });

  it('is true when autoApplyAllowed and there is a real change', () => {
    expect(canApply(resolution({ autoApplyAllowed: true, requiresConfirmation: false }))).toBe(true);
  });

  it('is true when confirmation is required (shadow/assisted-style manual apply)', () => {
    expect(canApply(resolution({ autoApplyAllowed: false, requiresConfirmation: true }))).toBe(true);
  });
});

describe('ledgerEntryFromApply', () => {
  it('records the in-place case with beforeBlocks and no fork id', () => {
    const workout = w({ id: 'w1', dates: [TODAY], blocks: [{ id: 'old' } as never] });
    const r = resolution();
    const plan = planApply(workout, r, TODAY, () => 'unused');
    const entry = ledgerEntryFromApply(plan, r, TODAY);
    expect(entry.wasForked).toBe(false);
    expect(entry.workoutId).toBe('w1');
    expect(entry.beforeBlocks).toEqual([{ id: 'old' }]);
    expect(entry.forkedWorkoutId).toBeUndefined();
  });

  it('records the fork case with forkedWorkoutId and no beforeBlocks', () => {
    const workout = w({ id: 'w1', days: [4] });
    const r = resolution();
    const plan = planApply(workout, r, TODAY, () => 'new-id');
    const entry = ledgerEntryFromApply(plan, r, TODAY);
    expect(entry.wasForked).toBe(true);
    expect(entry.workoutId).toBe('w1');
    expect(entry.forkedWorkoutId).toBe('new-id');
    expect(entry.beforeBlocks).toBeUndefined();
  });
});

describe('planUndo', () => {
  const base: LedgerEntry = {
    id: 'e1',
    at: 1,
    date: TODAY,
    workoutId: 'w1',
    action: 'applied',
    wasForked: false,
    operations: [op()],
    reasonCodes: ['low_readiness'],
  };

  it('restores beforeBlocks for the in-place case', () => {
    const entry: LedgerEntry = { ...base, beforeBlocks: [{ id: 'old' } as never] };
    const plan = planUndo(entry);
    expect(plan).toEqual({ kind: 'restore', workoutId: 'w1', blocks: [{ id: 'old' }] });
  });

  it('deletes the forked workout for the fork case', () => {
    const entry: LedgerEntry = { ...base, wasForked: true, forkedWorkoutId: 'new-id' };
    const plan = planUndo(entry);
    expect(plan).toEqual({ kind: 'delete-fork', workoutId: 'new-id' });
  });

  it('returns null for an already-undone entry', () => {
    const entry: LedgerEntry = { ...base, action: 'undone', beforeBlocks: [] };
    expect(planUndo(entry)).toBeNull();
  });

  it('returns null when the in-place case is missing beforeBlocks', () => {
    expect(planUndo(base)).toBeNull();
  });

  it('returns null when the fork case is missing forkedWorkoutId', () => {
    const entry: LedgerEntry = { ...base, wasForked: true };
    expect(planUndo(entry)).toBeNull();
  });
});
