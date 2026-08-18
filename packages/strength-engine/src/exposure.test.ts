import { describe, it, expect } from 'vitest';
import { strengthExposuresFor } from './exposure';
import type { PerformedSetWithMeasurements } from './performed';

function set(overrides: Partial<PerformedSetWithMeasurements> & { measurements?: PerformedSetWithMeasurements['measurements'] }): PerformedSetWithMeasurements {
  return {
    id: 'p1', assignedSessionId: 'as1', exerciseId: 'sq', prescribedSetId: 's1',
    ordinal: 1, status: 'completed', performedAt: '2026-08-20T10:00:00Z', clientCreatedAt: '2026-08-20T10:00:00Z',
    measurements: [{ metricKey: 'load', value: 100 }, { metricKey: 'reps', value: 5 }],
    ...overrides,
  };
}

describe('strengthExposuresFor', () => {
  it('classifies a completed set with a load and no rating as successful_but_uncertain', () => {
    const exposures = strengthExposuresFor('sq', [set({})]);
    expect(exposures).toHaveLength(1);
    expect(exposures[0]).toMatchObject({ exerciseId: 'sq', reps: 5, loadKg: 100, exposureClass: 'successful_but_uncertain', rated: false });
  });

  it('classifies a rated completed set as successful', () => {
    const exposures = strengthExposuresFor('sq', [set({ measurements: [{ metricKey: 'load', value: 100 }, { metricKey: 'reps', value: 5 }, { metricKey: 'rpe', value: 8 }] })]);
    expect(exposures[0].exposureClass).toBe('successful');
    expect(exposures[0].rated).toBe(true);
  });

  it('classifies a skipped set as missed', () => {
    const exposures = strengthExposuresFor('sq', [set({ status: 'skipped' })]);
    expect(exposures[0].exposureClass).toBe('missed');
  });

  it('pain_blocked outranks missed — a skipped, pain-flagged set is never classified as missed', () => {
    const exposures = strengthExposuresFor('sq', [set({ status: 'skipped', measurements: [{ metricKey: 'load', value: 100 }, { metricKey: 'reps', value: 5 }, { metricKey: 'pain', value: 1 }] })]);
    expect(exposures[0].exposureClass).toBe('pain_blocked');
    expect(exposures[0].painFlagged).toBe(true);
  });

  it('ignores sets for a different exercise', () => {
    const exposures = strengthExposuresFor('bench-press', [set({})]);
    expect(exposures).toHaveLength(0);
  });

  it('ignores sets with no load measurement (bodyweight-only work is not a strength exposure for this engine)', () => {
    const exposures = strengthExposuresFor('sq', [set({ measurements: [{ metricKey: 'reps', value: 12 }] })]);
    expect(exposures).toHaveLength(0);
  });

  it('sorts exposures oldest-first by performedAt, regardless of input order', () => {
    const a = set({ id: 'p-later', performedAt: '2026-08-22T10:00:00Z' });
    const b = set({ id: 'p-earlier', performedAt: '2026-08-18T10:00:00Z' });
    const exposures = strengthExposuresFor('sq', [a, b]);
    expect(exposures.map(e => e.performedSetId)).toEqual(['p-earlier', 'p-later']);
  });
});
