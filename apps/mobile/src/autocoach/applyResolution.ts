import type { Block, Workout } from '@hybrid/engine';
import type { AutoCoachResolution } from '@hybrid/auto-coach';
import type { LedgerEntry } from './ledger';

/**
 * Fork-vs-mutate for Applying a resolution, and the reverse for Undo.
 * Ported unchanged from apps/web/src/autocoach/applyResolution.ts — pure
 * logic, no RN/DOM surface, no persistence.
 *
 * A workout only qualifies for an in-place mutation when it is dated today
 * AND carries no `days` at all. A workout that has both (dates includes
 * today, but also plays a recurring role on other weekdays) is the same
 * object other future occurrences render from — mutating it in place would
 * leak today's adaptation into those, exactly the corruption the
 * recurring-template fork exists to prevent.
 */

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;

export function isOneOffToday(workout: Workout, today: string): boolean {
  return (workout.dates?.includes(today) ?? false) && !(workout.days && workout.days.length > 0);
}

export interface MutatePlan {
  kind: 'mutate';
  workoutId: string;
  beforeBlocks: Block[];
  afterBlocks: Block[];
}

export interface ForkPlan {
  kind: 'fork';
  sourceWorkoutId: string;
  forkedWorkoutId: string;
  name: string | undefined;
  workoutKind: Workout['kind'];
  date: string;
  blocks: Block[];
}

export type ApplyPlan = MutatePlan | ForkPlan;

export function planApply(
  workout: Workout,
  resolution: AutoCoachResolution,
  today: string,
  mkId: () => string,
): ApplyPlan {
  if (isOneOffToday(workout, today)) {
    return {
      kind: 'mutate',
      workoutId: workout.id,
      beforeBlocks: clone(workout.blocks),
      afterBlocks: clone(resolution.resolvedWorkout.blocks),
    };
  }
  return {
    kind: 'fork',
    sourceWorkoutId: workout.id,
    forkedWorkoutId: mkId(),
    name: workout.name,
    workoutKind: workout.kind,
    date: today,
    blocks: clone(resolution.resolvedWorkout.blocks),
  };
}

export function ledgerEntryFromApply(
  plan: ApplyPlan,
  resolution: AutoCoachResolution,
  today: string,
): Omit<LedgerEntry, 'id' | 'at' | 'action'> {
  return {
    date: today,
    workoutId: plan.kind === 'mutate' ? plan.workoutId : plan.sourceWorkoutId,
    wasForked: plan.kind === 'fork',
    forkedWorkoutId: plan.kind === 'fork' ? plan.forkedWorkoutId : undefined,
    beforeBlocks: plan.kind === 'mutate' ? plan.beforeBlocks : undefined,
    operations: resolution.operations,
    reasonCodes: resolution.reasonCodes,
  };
}

export function canApply(resolution: AutoCoachResolution): boolean {
  if (resolution.state === 'safety_stop') return false;
  const hasChange = resolution.operations.some((o) => o.type !== 'keep_as_planned');
  if (!hasChange) return false;
  return resolution.autoApplyAllowed || resolution.requiresConfirmation;
}

export interface RestorePlan {
  kind: 'restore';
  workoutId: string;
  blocks: Block[];
}

export interface DeleteForkPlan {
  kind: 'delete-fork';
  workoutId: string;
}

export type UndoPlan = RestorePlan | DeleteForkPlan;

export function planUndo(entry: LedgerEntry): UndoPlan | null {
  if (entry.action !== 'applied') return null;
  if (entry.wasForked) {
    if (!entry.forkedWorkoutId) return null;
    return { kind: 'delete-fork', workoutId: entry.forkedWorkoutId };
  }
  if (entry.beforeBlocks === undefined) return null;
  return { kind: 'restore', workoutId: entry.workoutId, blocks: entry.beforeBlocks };
}
