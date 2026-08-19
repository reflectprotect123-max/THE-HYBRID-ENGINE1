import type { Exercise } from './exercise';
import type { PrescribedTarget } from './prescription';
import { roundLoadToEquipment } from './rounding';

export interface ResolveCtx {
  athleteId: string;
  scheduledDate: string;
  workingMaxAt(exerciseId: string, asOf: string): number | null;
  lastPerformedLoad(athleteId: string, exerciseId: string): number | null;
  bodyweightAt(athleteId: string, asOf: string): number | null;
}

export type ResolvedValue =
  | { kind: 'scalar'; value: number; exact: number }
  | { kind: 'range'; lo: number; hi: number }
  | { kind: 'unresolved'; reason: 'no_working_max' | 'no_history' | 'no_bodyweight' }
  | { kind: 'deferred_to_athlete' };

/**
 * A strategy's required input being absent is a malformed row, not a resolvable
 * state: `exprArg` fed into arithmetic as `undefined` yields NaN, and
 * `rangeHi: undefined` emits a half-open range — both of which would flow
 * silently into a published snapshot. Throw descriptively instead, same style
 * as the no-strategy error below.
 */
function requiredArg(t: PrescribedTarget): number {
  if (t.exprArg == null) {
    throw new Error(`prescribed_target ${t.exprKind} row missing exprArg: ${JSON.stringify(t)}`);
  }
  return t.exprArg;
}

export function resolveTarget(t: PrescribedTarget, ex: Exercise, ctx: ResolveCtx): ResolvedValue {
  if (t.literalValue != null) return { kind: 'scalar', value: t.literalValue, exact: t.literalValue };
  if (t.rangeLo != null) {
    if (t.rangeHi == null) {
      throw new Error(`prescribed_target range row missing rangeHi: ${JSON.stringify(t)}`);
    }
    return { kind: 'range', lo: t.rangeLo, hi: t.rangeHi };
  }
  switch (t.exprKind) {
    case 'pct_of_max': {
      const arg = requiredArg(t);
      const refId = t.exprRefExercise ?? ex.referenceMaxExerciseId ?? ex.id;
      const max = ctx.workingMaxAt(refId, ctx.scheduledDate);
      if (max == null) return { kind: 'unresolved', reason: 'no_working_max' };
      const exact = max * arg;
      return { kind: 'scalar', value: roundLoadToEquipment(exact, ex.equipment), exact };
    }
    case 'lwp_delta': {
      const arg = requiredArg(t);
      const last = ctx.lastPerformedLoad(ctx.athleteId, ex.id);
      if (last == null) return { kind: 'unresolved', reason: 'no_history' };
      const exact = last + arg;
      return { kind: 'scalar', value: roundLoadToEquipment(exact, ex.equipment), exact };
    }
    case 'pct_of_bodyweight': {
      const arg = requiredArg(t);
      const bw = ctx.bodyweightAt(ctx.athleteId, ctx.scheduledDate);
      if (bw == null) return { kind: 'unresolved', reason: 'no_bodyweight' };
      const exact = bw * arg;
      return { kind: 'scalar', value: roundLoadToEquipment(exact, ex.equipment), exact };
    }
    case 'rpe_autoreg':
      return { kind: 'deferred_to_athlete' };
    default:
      throw new Error(`prescribed_target row with no resolution strategy: ${JSON.stringify(t)}`);
  }
}
