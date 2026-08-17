import type { Exercise } from './exercise';
import type { PrescribedSet } from './prescription';
import { resolveTarget, type ResolveCtx } from './resolve';
import { roundToIncrement } from './rounding';

export interface BlockItemInput {
  exercise: Exercise;
  sets: PrescribedSet[];
}

export interface UnresolvedTarget {
  exerciseName: string;
  metricKey: string;
  reason: string;
}

export type SessionSnapshot = Record<string, Array<{ setId: string; targets: Record<string, { value: number; exact: number } | { lo: number; hi: number }> }>>;

export type PublishResult =
  | { snapshot: SessionSnapshot }
  | { blocked: UnresolvedTarget[] };

export function resolveSessionForPublish(items: BlockItemInput[], ctx: ResolveCtx): PublishResult {
  const blocked: UnresolvedTarget[] = [];
  const snapshot: SessionSnapshot = {};

  for (const { exercise, sets } of items) {
    const setEntries: any[] = [];
    for (const set of sets) {
      const targetEntries: Record<string, any> = {};
      for (const target of set.targets) {
        const resolved = resolveTarget(target, exercise, ctx);
        if (resolved.kind === 'unresolved') {
          blocked.push({ exerciseName: exercise.name, metricKey: target.metricKey, reason: resolved.reason });
          continue;
        }
        if (resolved.kind === 'scalar') {
          const exact = target.exprKind ? resolveExact(target, exercise, ctx) : resolved.value;
          targetEntries[target.metricKey] = { value: resolved.value, exact };
        } else if (resolved.kind === 'range') {
          targetEntries[target.metricKey] = { lo: resolved.lo, hi: resolved.hi };
        }
        // 'deferred_to_athlete' targets are intentionally absent from the snapshot.
      }
      setEntries.push({ setId: set.id, targets: targetEntries });
    }
    snapshot[exercise.id] = setEntries;
  }

  if (blocked.length) return { blocked };
  return { snapshot };
}

/** The unrounded value behind a rounded scalar, for the long-press "exact value" UI. */
function resolveExact(target: any, exercise: Exercise, ctx: ResolveCtx): number {
  if (target.exprKind === 'pct_of_max') {
    const refId = target.exprRefExercise ?? exercise.referenceMaxExerciseId ?? exercise.id;
    return (ctx.workingMaxAt(refId, ctx.scheduledDate) ?? 0) * target.exprArg;
  }
  if (target.exprKind === 'lwp_delta') {
    return (ctx.lastPerformedLoad(ctx.athleteId, exercise.id) ?? 0) + target.exprArg;
  }
  if (target.exprKind === 'pct_of_bodyweight') {
    return (ctx.bodyweightAt(ctx.athleteId, ctx.scheduledDate) ?? 0) * target.exprArg;
  }
  return roundToIncrement(0, exercise.equipment);
}
