import { describe, it, expect } from 'vitest';
import { sessionLoad, intensity, sessionCompliance } from './load';
import type { PerformedSetWithMeasurements } from './performed';
import type { PrescribedSet } from './prescription';
import type { PerformedSet } from './performed';

function loadedSet(reps: number, load: number): PerformedSetWithMeasurements {
  return {
    id: `p-${reps}-${load}`, assignedSessionId: 'as1', exerciseId: 'sq', prescribedSetId: null,
    ordinal: 1, status: 'completed', performedAt: '2026-08-20T10:00:00Z', clientCreatedAt: '2026-08-20T10:00:00Z',
    measurements: [{ metricKey: 'reps', value: reps }, { metricKey: 'load', value: load }],
  };
}

describe('sessionLoad', () => {
  it('sums tonnage as reps times load, only for loaded sets', () => {
    const result = sessionLoad([loadedSet(5, 100), loadedSet(5, 105)]);
    expect(result.tonnageKg).toBe(5 * 100 + 5 * 105);
  });

  it('counts workReps for unloaded sets separately', () => {
    const unloaded: PerformedSetWithMeasurements = {
      id: 'p-u', assignedSessionId: 'as1', exerciseId: 'pu', prescribedSetId: null,
      ordinal: 1, status: 'completed', performedAt: '2026-08-20T10:00:00Z', clientCreatedAt: '2026-08-20T10:00:00Z',
      measurements: [{ metricKey: 'reps', value: 12 }],
    };
    const result = sessionLoad([unloaded]);
    expect(result.workReps).toBe(12);
    expect(result.tonnageKg).toBe(0);
  });
});

describe('intensity', () => {
  it('is a rep-weighted average of %max, not a naive mean of set percentages', () => {
    // set A: 8 reps @ 100kg (80% of 125), set B: 2 reps @ 120kg (96% of 125)
    // rep-weighted: (8*100 + 2*120) / 10 = 104kg avg -> 104/125 = 0.832
    const result = intensity([loadedSet(8, 100), loadedSet(2, 120)], 125);
    expect(result).toBeCloseTo(0.832, 3);
  });
});

describe('sessionCompliance', () => {
  it('excludes optional sets from both numerator and denominator', () => {
    const assigned: PrescribedSet[] = [
      { id: 's1', ordinal: 1, isOptional: false, isAmrap: false, targets: [] },
      { id: 's2', ordinal: 2, isOptional: true, isAmrap: false, targets: [] },
    ];
    const performed: PerformedSet[] = [
      { id: 'p1', assignedSessionId: 'as1', exerciseId: 'sq', prescribedSetId: 's1', ordinal: 1, status: 'completed', performedAt: 'x', clientCreatedAt: 'x' },
    ];
    expect(sessionCompliance(assigned, performed)).toBe(1);
  });

  it('returns 1 when there are no required sets', () => {
    expect(sessionCompliance([], [])).toBe(1);
  });
});
