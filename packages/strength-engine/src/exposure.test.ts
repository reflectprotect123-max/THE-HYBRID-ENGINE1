import { describe, it, expect } from 'vitest';
import { strengthExposuresFor } from './exposure';
import type { ResolvedSetTarget } from './exposure';
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
    const a = set({ id: 'p-later', assignedSessionId: 'as-later', performedAt: '2026-08-22T10:00:00Z' });
    const b = set({ id: 'p-earlier', assignedSessionId: 'as-earlier', performedAt: '2026-08-18T10:00:00Z' });
    const exposures = strengthExposuresFor('sq', [a, b]);
    expect(exposures.map(e => e.performedSetId)).toEqual(['p-earlier', 'p-later']);
  });

  describe('per-session grouping (product decision: exposures are per SESSION, not per set)', () => {
    it('3 sets in ONE session produce only 1 exposure', () => {
      const sets = [
        set({ id: 'p1', ordinal: 1, performedAt: '2026-08-20T10:00:00Z' }),
        set({ id: 'p2', ordinal: 2, performedAt: '2026-08-20T10:05:00Z' }),
        set({ id: 'p3', ordinal: 3, performedAt: '2026-08-20T10:10:00Z' }),
      ];
      const exposures = strengthExposuresFor('sq', sets);
      expect(exposures).toHaveLength(1);
      // the chronologically LAST set in the session is the representative
      expect(exposures[0].performedSetId).toBe('p3');
    });

    it('2 sessions with 2 sets each produce 2 exposures — the last set of each session', () => {
      const sets = [
        set({ id: 'p1', assignedSessionId: 'as1', performedAt: '2026-08-18T10:00:00Z' }),
        set({ id: 'p2', assignedSessionId: 'as1', performedAt: '2026-08-18T10:05:00Z' }),
        set({ id: 'p3', assignedSessionId: 'as2', performedAt: '2026-08-20T10:00:00Z' }),
        set({ id: 'p4', assignedSessionId: 'as2', performedAt: '2026-08-20T10:05:00Z' }),
      ];
      const exposures = strengthExposuresFor('sq', sets);
      expect(exposures).toHaveLength(2);
      expect(exposures.map(e => e.performedSetId)).toEqual(['p2', 'p4']);
      expect(exposures.map(e => e.assignedSessionId)).toEqual(['as1', 'as2']);
    });

    it('a session where every set for this exercise was skipped still produces one missed exposure, not none', () => {
      const sets = [
        set({ id: 'p1', assignedSessionId: 'as1', status: 'skipped', performedAt: '2026-08-20T10:00:00Z' }),
        set({ id: 'p2', assignedSessionId: 'as1', status: 'skipped', performedAt: '2026-08-20T10:05:00Z' }),
      ];
      const exposures = strengthExposuresFor('sq', sets);
      expect(exposures).toHaveLength(1);
      expect(exposures[0].exposureClass).toBe('missed');
      expect(exposures[0].performedSetId).toBe('p2');
    });
  });

  describe('onTarget: did the athlete hit the prescribed stimulus', () => {
    it('is true when the representative set meets its resolved target', () => {
      const resolvedTargets: Record<string, ResolvedSetTarget> = { s1: { targetReps: 5, targetLoadKg: 100 } };
      const exposures = strengthExposuresFor('sq', [set({ measurements: [{ metricKey: 'load', value: 100 }, { metricKey: 'reps', value: 5 }] })], resolvedTargets);
      expect(exposures[0].onTarget).toBe(true);
    });

    it('is false when the set falls short on reps', () => {
      const resolvedTargets: Record<string, ResolvedSetTarget> = { s1: { targetReps: 5, targetLoadKg: 100 } };
      const exposures = strengthExposuresFor('sq', [set({ measurements: [{ metricKey: 'load', value: 100 }, { metricKey: 'reps', value: 3 }] })], resolvedTargets);
      expect(exposures[0].onTarget).toBe(false);
    });

    it('is false when the set falls short on load', () => {
      const resolvedTargets: Record<string, ResolvedSetTarget> = { s1: { targetReps: 5, targetLoadKg: 100 } };
      const exposures = strengthExposuresFor('sq', [set({ measurements: [{ metricKey: 'load', value: 90 }, { metricKey: 'reps', value: 5 }] })], resolvedTargets);
      expect(exposures[0].onTarget).toBe(false);
    });

    it('defaults to true (unchanged) when there is no resolvedTargets entry at all', () => {
      const exposures = strengthExposuresFor('sq', [set({})]);
      expect(exposures[0].onTarget).toBe(true);
    });
  });
});
