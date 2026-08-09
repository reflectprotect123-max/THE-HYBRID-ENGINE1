import type { AutoCoachResolution } from '@hybrid/auto-coach';
import type { Workout } from '@hybrid/engine';
import {
  canApply,
  isOneOffToday,
  ledgerEntryFromApply,
  planApply,
  planUndo,
} from './applyResolution';
import type { LedgerEntry } from './ledger';

function fixtureWorkout(over: Partial<Workout> = {}): Workout {
  return {
    id: 'w-1',
    kind: 'strength',
    name: 'Push Day',
    blocks: [],
    dates: ['2026-08-09'],
    updatedAt: 1000,
    ...over,
  };
}

function fixtureResolution(over: Partial<AutoCoachResolution> = {}): AutoCoachResolution {
  return {
    schemaVersion: 1,
    state: 'advisory',
    originalWorkoutId: 'w-1',
    resolvedWorkout: { id: 'w-1', name: 'Push Day', kind: 'strength', blocks: [] } as AutoCoachResolution['resolvedWorkout'],
    operations: [{ type: 'cap_intensity', before: '5x5 @ 225', after: '5x5 @ 205' } as never],
    signals: [],
    inferences: [],
    reasonCodes: ['low_readiness'],
    confidence: 'high',
    requiresConfirmation: true,
    autoApplyAllowed: false,
    athleteMessage: 'Cap intensity today.',
    ...over,
  };
}

describe('isOneOffToday', () => {
  it('true for a one-off dated today with no recurring days', () => {
    expect(isOneOffToday(fixtureWorkout({ dates: ['2026-08-09'], days: undefined }), '2026-08-09')).toBe(true);
  });

  it('false when the workout also carries recurring days', () => {
    expect(isOneOffToday(fixtureWorkout({ dates: ['2026-08-09'], days: [0] }), '2026-08-09')).toBe(false);
  });

  it('false when today is not in dates', () => {
    expect(isOneOffToday(fixtureWorkout({ dates: ['2026-08-01'] }), '2026-08-09')).toBe(false);
  });
});

describe('planApply', () => {
  const mkId = () => 'forked-1';

  it('plans a mutate for a one-off-today workout', () => {
    const plan = planApply(fixtureWorkout(), fixtureResolution(), '2026-08-09', mkId);
    expect(plan.kind).toBe('mutate');
    if (plan.kind === 'mutate') expect(plan.workoutId).toBe('w-1');
  });

  it('plans a fork for a recurring-template workout, using mkId for the new id', () => {
    const plan = planApply(fixtureWorkout({ days: [0], dates: [] }), fixtureResolution(), '2026-08-09', mkId);
    expect(plan.kind).toBe('fork');
    if (plan.kind === 'fork') {
      expect(plan.forkedWorkoutId).toBe('forked-1');
      expect(plan.sourceWorkoutId).toBe('w-1');
      expect(plan.date).toBe('2026-08-09');
    }
  });
});

describe('ledgerEntryFromApply', () => {
  it('records beforeBlocks for a mutate plan, no forkedWorkoutId', () => {
    const plan = planApply(fixtureWorkout(), fixtureResolution(), '2026-08-09', () => 'x');
    const entry = ledgerEntryFromApply(plan, fixtureResolution(), '2026-08-09');
    expect(entry.wasForked).toBe(false);
    expect(entry.forkedWorkoutId).toBeUndefined();
    expect(entry.beforeBlocks).toBeDefined();
  });

  it('records forkedWorkoutId for a fork plan, no beforeBlocks', () => {
    const plan = planApply(fixtureWorkout({ days: [0], dates: [] }), fixtureResolution(), '2026-08-09', () => 'forked-2');
    const entry = ledgerEntryFromApply(plan, fixtureResolution(), '2026-08-09');
    expect(entry.wasForked).toBe(true);
    expect(entry.forkedWorkoutId).toBe('forked-2');
    expect(entry.beforeBlocks).toBeUndefined();
  });
});

describe('canApply', () => {
  it('false for safety_stop', () => {
    expect(canApply(fixtureResolution({ state: 'safety_stop' }))).toBe(false);
  });

  it('false when nothing changed (only keep_as_planned operations)', () => {
    expect(canApply(fixtureResolution({ operations: [{ type: 'keep_as_planned' } as never] }))).toBe(false);
  });

  it('true when there is a real change and it requires confirmation', () => {
    expect(canApply(fixtureResolution({ requiresConfirmation: true, autoApplyAllowed: false }))).toBe(true);
  });

  it('true when auto-apply is allowed even without requiresConfirmation', () => {
    expect(canApply(fixtureResolution({ requiresConfirmation: false, autoApplyAllowed: true }))).toBe(true);
  });
});

describe('planUndo', () => {
  const baseEntry: LedgerEntry = {
    id: 'e1',
    at: 1,
    date: '2026-08-09',
    workoutId: 'w-1',
    action: 'applied',
    wasForked: false,
    beforeBlocks: [],
    operations: [],
    reasonCodes: [],
  };

  it('null for an already-undone entry', () => {
    expect(planUndo({ ...baseEntry, action: 'undone' })).toBeNull();
  });

  it('restore plan for a mutate entry with beforeBlocks', () => {
    const plan = planUndo(baseEntry);
    expect(plan?.kind).toBe('restore');
  });

  it('null for a mutate entry missing beforeBlocks', () => {
    expect(planUndo({ ...baseEntry, beforeBlocks: undefined })).toBeNull();
  });

  it('delete-fork plan for a forked entry with a forkedWorkoutId', () => {
    const plan = planUndo({ ...baseEntry, wasForked: true, forkedWorkoutId: 'w-fork', beforeBlocks: undefined });
    expect(plan?.kind).toBe('delete-fork');
  });

  it('null for a forked entry missing forkedWorkoutId', () => {
    expect(planUndo({ ...baseEntry, wasForked: true, forkedWorkoutId: undefined, beforeBlocks: undefined })).toBeNull();
  });
});
