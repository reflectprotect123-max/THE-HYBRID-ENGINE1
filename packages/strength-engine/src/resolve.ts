import type { Exercise } from './exercise';
import type { PrescribedTarget } from './prescription';
import { roundToIncrement } from './rounding';

export interface ResolveCtx {
  athleteId: string;
  scheduledDate: string;
  workingMaxAt(exerciseId: string, asOf: string): number | null;
  lastPerformedLoad(athleteId: string, exerciseId: string): number | null;
  bodyweightAt(athleteId: string, asOf: string): number | null;
}

export type ResolvedValue =
  | { kind: 'scalar'; value: number }
  | { kind: 'range'; lo: number; hi: number }
  | { kind: 'unresolved'; reason: 'no_working_max' | 'no_history' | 'no_bodyweight' }
  | { kind: 'deferred_to_athlete' };

export function resolveTarget(t: PrescribedTarget, ex: Exercise, ctx: ResolveCtx): ResolvedValue {
  if (t.literalValue != null) return { kind: 'scalar', value: t.literalValue };
  if (t.rangeLo != null) return { kind: 'range', lo: t.rangeLo, hi: t.rangeHi! };
  switch (t.exprKind) {
    case 'pct_of_max': {
      const refId = t.exprRefExercise ?? ex.referenceMaxExerciseId ?? ex.id;
      const max = ctx.workingMaxAt(refId, ctx.scheduledDate);
      if (max == null) return { kind: 'unresolved', reason: 'no_working_max' };
      return { kind: 'scalar', value: roundToIncrement(max * t.exprArg!, ex.equipment) };
    }
    case 'lwp_delta': {
      const last = ctx.lastPerformedLoad(ctx.athleteId, ex.id);
      if (last == null) return { kind: 'unresolved', reason: 'no_history' };
      return { kind: 'scalar', value: roundToIncrement(last + t.exprArg!, ex.equipment) };
    }
    case 'pct_of_bodyweight': {
      const bw = ctx.bodyweightAt(ctx.athleteId, ctx.scheduledDate);
      if (bw == null) return { kind: 'unresolved', reason: 'no_bodyweight' };
      return { kind: 'scalar', value: roundToIncrement(bw * t.exprArg!, ex.equipment) };
    }
    case 'rpe_autoreg':
      return { kind: 'deferred_to_athlete' };
    default:
      throw new Error(`prescribed_target row with no resolution strategy: ${JSON.stringify(t)}`);
  }
}
