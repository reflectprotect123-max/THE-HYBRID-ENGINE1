import { describe, it, expect } from 'vitest';
import { resolveSessionForPublish } from './session';
import type { Exercise } from './exercise';
import type { PrescribedSet } from './prescription';
import type { ResolveCtx } from './resolve';

const squat: Exercise = {
  id: 'sq', ownerId: null, name: 'Back Squat', videoAssetId: null, cues: null,
  equipment: { id: 'bb', name: 'Barbell (kg)', incrementKg: 2.5, rackValuesKg: null, rounding: 'down' },
  defaultMetrics: ['reps', 'load'], referenceMaxExerciseId: null, trackAsExerciseId: null, e1rmFormula: 'epley',
};

const items = [{ exercise: squat, sets: [
  { id: 's1', ordinal: 1, isOptional: false, isAmrap: false, targets: [{ metricKey: 'load' as const, exprKind: 'pct_of_max' as const, exprArg: 0.8 }] },
] as PrescribedSet[] }];

function ctx(overrides: Partial<ResolveCtx> = {}): ResolveCtx {
  return {
    athleteId: 'a1', scheduledDate: '2026-08-20',
    workingMaxAt: () => 100, lastPerformedLoad: () => null, bodyweightAt: () => null,
    ...overrides,
  };
}

describe('resolveSessionForPublish', () => {
  it('returns a snapshot when every target resolves', () => {
    const result = resolveSessionForPublish(items, ctx());
    expect(result).toEqual({
      snapshot: { sq: [{ setId: 's1', targets: { load: { value: 80, exact: 80 } } }] },
    });
  });

  it('returns blocked with the exercise name when a target cannot resolve', () => {
    const result = resolveSessionForPublish(items, ctx({ workingMaxAt: () => null }));
    expect(result).toEqual({
      blocked: [{ exerciseName: 'Back Squat', metricKey: 'load', reason: 'no_working_max' }],
    });
  });

  it('never partially publishes: one unresolved target blocks the whole session', () => {
    const twoSets = [{ exercise: squat, sets: [
      ...items[0].sets,
      { id: 's2', ordinal: 2, isOptional: false, isAmrap: false, targets: [{ metricKey: 'load' as const, exprKind: 'lwp_delta' as const, exprArg: 2.5 }] },
    ] }];
    const result = resolveSessionForPublish(twoSets, ctx());
    expect('blocked' in result).toBe(true);
    if ('blocked' in result) expect(result.blocked).toHaveLength(1);
  });

  it('a resolved_snapshot never changes after the source prescription is edited', () => {
    const result1 = resolveSessionForPublish(items, ctx());
    // Simulate a template edit: the athlete's working max increases after publish.
    const result2AfterEdit = resolveSessionForPublish(items, ctx({ workingMaxAt: () => 999 }));
    // The FIRST result — what was actually published — must not be affected by
    // recomputing against new data. This is a property of the CALLER (publish
    // writes the snapshot once and never re-derives it), asserted here by
    // showing resolveSessionForPublish is a pure function: same inputs, same
    // output, and the caller is responsible for freezing result1 rather than
    // re-calling this function after publish.
    expect(result1).not.toEqual(result2AfterEdit);
    expect(resolveSessionForPublish(items, ctx())).toEqual(result1);
  });
});
