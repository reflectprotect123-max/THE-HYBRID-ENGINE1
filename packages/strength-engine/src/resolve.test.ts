import { describe, it, expect } from 'vitest';
import { resolveTarget, type ResolveCtx } from './resolve';
import type { Exercise } from './exercise';
import type { PrescribedTarget } from './prescription';

const squat: Exercise = {
  id: 'sq', ownerId: null, name: 'Back Squat', videoAssetId: null, cues: null,
  equipment: { id: 'bb', name: 'Barbell (kg)', incrementKg: 2.5, rackValuesKg: null, rounding: 'down' },
  defaultMetrics: ['reps', 'load'], referenceMaxExerciseId: null, trackAsExerciseId: null, e1rmFormula: 'epley',
};

function ctx(overrides: Partial<ResolveCtx> = {}): ResolveCtx {
  return {
    athleteId: 'a1', scheduledDate: '2026-08-20',
    workingMaxAt: () => null, lastPerformedLoad: () => null, bodyweightAt: () => null,
    ...overrides,
  };
}

describe('resolveTarget', () => {
  it('returns a literal value unchanged', () => {
    const t: PrescribedTarget = { metricKey: 'load', literalValue: 100 };
    expect(resolveTarget(t, squat, ctx())).toEqual({ kind: 'scalar', value: 100, exact: 100 });
  });

  it('returns a range unchanged', () => {
    const t: PrescribedTarget = { metricKey: 'reps', rangeLo: 8, rangeHi: 10 };
    expect(resolveTarget(t, squat, ctx())).toEqual({ kind: 'range', lo: 8, hi: 10 });
  });

  it('resolves pct_of_max against the working max, rounded', () => {
    const t: PrescribedTarget = { metricKey: 'load', exprKind: 'pct_of_max', exprArg: 0.8 };
    const c = ctx({ workingMaxAt: () => 141 });
    expect(resolveTarget(t, squat, c)).toEqual({ kind: 'scalar', value: 112.5, exact: 112.80000000000001 });
  });

  it('returns unresolved when pct_of_max has no working max on record', () => {
    const t: PrescribedTarget = { metricKey: 'load', exprKind: 'pct_of_max', exprArg: 0.8 };
    expect(resolveTarget(t, squat, ctx())).toEqual({ kind: 'unresolved', reason: 'no_working_max' });
  });

  it('resolves lwp_delta against the last performed load, rounded', () => {
    const t: PrescribedTarget = { metricKey: 'load', exprKind: 'lwp_delta', exprArg: 2.5 };
    const c = ctx({ lastPerformedLoad: () => 100 });
    expect(resolveTarget(t, squat, c)).toEqual({ kind: 'scalar', value: 102.5, exact: 102.5 });
  });

  it('returns unresolved when lwp_delta has no history', () => {
    const t: PrescribedTarget = { metricKey: 'load', exprKind: 'lwp_delta', exprArg: 2.5 };
    expect(resolveTarget(t, squat, ctx())).toEqual({ kind: 'unresolved', reason: 'no_history' });
  });

  it('resolves pct_of_bodyweight, rounded', () => {
    // 89 * 0.5 = 44.5, which is not itself a multiple of the squat's 2.5kg
    // barbell increment; roundLoadToEquipment's 'down' rounding (Task 5, already
    // committed and tested) floors it to 42.5. The brief's own worked
    // example asserted 44.5 here, which contradicts roundLoadToEquipment's own
    // test suite (rounding.test.ts: roundLoadToEquipment(103, barbell) === 102.5
    // via the same floor-to-increment math) — corrected to the value the
    // real rounding function actually produces.
    const t: PrescribedTarget = { metricKey: 'load', exprKind: 'pct_of_bodyweight', exprArg: 0.5 };
    const c = ctx({ bodyweightAt: () => 89 });
    expect(resolveTarget(t, squat, c)).toEqual({ kind: 'scalar', value: 42.5, exact: 44.5 });
  });

  it('defers rpe_autoreg to the athlete, never touching ctx', () => {
    const t: PrescribedTarget = { metricKey: 'rpe', exprKind: 'rpe_autoreg' };
    const c = ctx({
      workingMaxAt: () => { throw new Error('must not be called'); },
      lastPerformedLoad: () => { throw new Error('must not be called'); },
      bodyweightAt: () => { throw new Error('must not be called'); },
    });
    expect(resolveTarget(t, squat, c)).toEqual({ kind: 'deferred_to_athlete' });
  });

  it('throws for a target with no resolution strategy', () => {
    const t = { metricKey: 'load' } as PrescribedTarget;
    expect(() => resolveTarget(t, squat, ctx())).toThrow(/no resolution strategy/);
  });

  it('pct_of_max uses exprRefExercise over the exercise\'s own reference_max_exercise_id', () => {
    const t: PrescribedTarget = { metricKey: 'load', exprKind: 'pct_of_max', exprArg: 0.5, exprRefExercise: 'front-squat' };
    const c = ctx({ workingMaxAt: (exId) => (exId === 'front-squat' ? 100 : 999) });
    expect(resolveTarget(t, squat, c)).toEqual({ kind: 'scalar', value: 50, exact: 50 });
  });
});
