import { describe, it, expect } from 'vitest';
import { resolveSessionForPublish, type BlockItemInput } from './session';
import { detectPr } from './pr';
import { sessionLoad } from './load';
import { measurementValue, type PerformedSetWithMeasurements } from './performed';
import type { Exercise } from './exercise';
import type { ResolveCtx } from './resolve';

// Synthetic 5x5@75% session end to end: prescribe -> resolve -> publish ->
// snapshot -> simulate the athlete performing it with one deliberate
// deviation (an extra set) -> detect PR -> compute session load.
describe('golden: 5x5 @ 75% end to end', () => {
  const squat: Exercise = {
    id: 'sq', ownerId: null, name: 'Back Squat', videoAssetId: null, cues: null,
    equipment: { id: 'bb', name: 'Barbell (kg)', incrementKg: 2.5, rackValuesKg: null, rounding: 'down' },
    defaultMetrics: ['reps', 'load'], referenceMaxExerciseId: null, trackAsExerciseId: null, e1rmFormula: 'epley',
  };

  const items: BlockItemInput[] = [{
    exercise: squat,
    sets: Array.from({ length: 5 }, (_, i) => ({
      id: `s${i + 1}`, ordinal: i + 1, isOptional: false, isAmrap: false,
      targets: [
        { metricKey: 'load' as const, exprKind: 'pct_of_max' as const, exprArg: 0.75 },
        { metricKey: 'reps' as const, literalValue: 5 },
      ],
    })),
  }];

  const ctx: ResolveCtx = {
    athleteId: 'a1', scheduledDate: '2026-08-20',
    workingMaxAt: () => 140, lastPerformedLoad: () => null, bodyweightAt: () => null,
  };

  it('publishes a full snapshot at 105kg (140 * 0.75, rounded down to 2.5kg)', () => {
    const result = resolveSessionForPublish(items, ctx);
    expect('snapshot' in result).toBe(true);
    if ('snapshot' in result) {
      expect(result.snapshot.sq).toHaveLength(5);
      expect(result.snapshot.sq[0].targets.load).toEqual({ value: 105, exact: 105 });
    }
  });

  it('detects a PR when the athlete adds a 6th deviation set at a higher load', () => {
    const performed: PerformedSetWithMeasurements[] = [
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `p${i + 1}`, assignedSessionId: 'as1', exerciseId: 'sq', prescribedSetId: `s${i + 1}`,
        ordinal: i + 1, status: 'completed' as const, performedAt: '2026-08-20T10:00:00Z', clientCreatedAt: '2026-08-20T10:00:00Z',
        measurements: [{ metricKey: 'load' as const, value: 105 }, { metricKey: 'reps' as const, value: 5 }],
      })),
      {
        id: 'p6', assignedSessionId: 'as1', exerciseId: 'sq', prescribedSetId: null,
        ordinal: 6, status: 'completed' as const, performedAt: '2026-08-20T10:20:00Z', clientCreatedAt: '2026-08-20T10:20:00Z',
        measurements: [{ metricKey: 'load' as const, value: 110 }, { metricKey: 'reps' as const, value: 3 }],
      },
    ];
    const isPr = detectPr({ exerciseId: 'sq', reps: 3, loadKg: 110 }, []);
    expect(isPr).toBe(true);

    const load = sessionLoad(performed);
    expect(load.tonnageKg).toBe(5 * 5 * 105 + 3 * 110);
  });
});
