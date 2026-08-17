import { describe, it, expect } from 'vitest';
import { measurementValue, type PerformedSetWithMeasurements } from './performed';

const set: PerformedSetWithMeasurements = {
  id: 'p1', assignedSessionId: 'as1', exerciseId: 'sq', prescribedSetId: 's1',
  ordinal: 1, status: 'completed', performedAt: '2026-08-20T10:00:00Z', clientCreatedAt: '2026-08-20T10:00:00Z',
  measurements: [{ metricKey: 'load', value: 100 }, { metricKey: 'reps', value: 5 }],
};

describe('measurementValue', () => {
  it('returns the value for a present metric', () => {
    expect(measurementValue(set, 'load')).toBe(100);
  });

  it('returns null for a metric not on this set', () => {
    expect(measurementValue(set, 'rpe')).toBeNull();
  });
});
