import { describe, expect, it } from 'vitest';
import { applyServerProgression, structurallyEqual, trendSnapshotInputs } from './arc-athlete-sync';

/*
 * These test the boundary this file exists to cross: a value the athlete's
 * OWN device computed, sent to Supabase, and read back. Postgres jsonb does
 * not preserve key insertion order — it normalises it — so any comparison
 * that cares about serialised text rather than fields would call a
 * perfectly fresh value "stale" purely because `{kg,at}` came back as
 * `{at,kg}`. That is the one bug worth pinning here; everything else in this
 * file is thin RPC plumbing already exercised by checks/migrations-apply.mjs.
 */

describe('structurallyEqual', () => {
  it('is true for identical key order', () => {
    expect(structurallyEqual({ kg: 100, at: 1000 }, { kg: 100, at: 1000 })).toBe(true);
  });

  it('is true across a jsonb-normalised key order — the bug this exists to prevent', () => {
    expect(structurallyEqual({ kg: 100, at: 1000, reps: 5 }, { at: 1000, kg: 100, reps: 5 })).toBe(true);
  });

  it('is false when a value actually differs', () => {
    expect(structurallyEqual({ kg: 100, at: 1000 }, { kg: 102, at: 1000 })).toBe(false);
  });

  it('is false when one side has an extra key', () => {
    expect(structurallyEqual({ kg: 100, at: 1000 }, { kg: 100, at: 1000, reps: 5 })).toBe(false);
  });

  it('treats null as equal only to null', () => {
    expect(structurallyEqual(null, null)).toBe(true);
    expect(structurallyEqual(null, { kg: 100, at: 1000 })).toBe(false);
    expect(structurallyEqual({ kg: 100, at: 1000 }, null)).toBe(false);
  });
});

describe('applyServerProgression', () => {
  it('applies a strength proposal when before matches the current baseline', () => {
    const settings = { liftProgress: { squat: { kg: 100, at: 1000 } } };
    const out = applyServerProgression('strength', 'squat', { kg: 100, at: 1000 }, { kg: 102, at: 2000 }, settings);
    expect(out?.liftProgress?.squat).toEqual({ kg: 102, at: 2000 });
  });

  it('applies even when the pushed `before` has a different key order than the local value — the jsonb round-trip case', () => {
    const settings = { liftProgress: { squat: { kg: 100, at: 1000, reps: 5 } } };
    const out = applyServerProgression('strength', 'squat', { at: 1000, reps: 5, kg: 100 }, { kg: 102, at: 2000, reps: 5 }, settings);
    expect(out?.liftProgress?.squat).toEqual({ kg: 102, at: 2000, reps: 5 });
  });

  it('refuses (returns null) when the athlete has trained again since the proposal was pushed', () => {
    const settings = { liftProgress: { squat: { kg: 103, at: 1500 } } };
    const out = applyServerProgression('strength', 'squat', { kg: 100, at: 1000 }, { kg: 102, at: 2000 }, settings);
    expect(out).toBeNull();
  });

  it('a first-ever proposal has `before: null`, and applies against an athlete with no recorded baseline', () => {
    const out = applyServerProgression('strength', 'squat', null, { kg: 80, at: 1000 }, {});
    expect(out?.liftProgress?.squat).toEqual({ kg: 80, at: 1000 });
  });

  it('refuses a null-before proposal once the athlete DOES have a baseline — that is itself staleness', () => {
    const settings = { liftProgress: { squat: { kg: 80, at: 900 } } };
    const out = applyServerProgression('strength', 'squat', null, { kg: 82, at: 1000 }, settings);
    expect(out).toBeNull();
  });

  it('applies a conditioning proposal the same way, using the {level:0,miss:0} default baseline', () => {
    const out = applyServerProgression('conditioning', 'row:steady', { level: 0, miss: 0 }, { level: 1, miss: 0 }, {});
    expect(out?.conProgress?.['row:steady']).toEqual({ level: 1, miss: 0 });
  });

  it('does not touch the other domain\'s progress map', () => {
    const settings = { liftProgress: { squat: { kg: 100, at: 1000 } }, conProgress: { 'row:steady': { level: 2, miss: 1 } } };
    const out = applyServerProgression('strength', 'squat', { kg: 100, at: 1000 }, { kg: 102, at: 2000 }, settings);
    expect(out?.conProgress?.['row:steady']).toEqual({ level: 2, miss: 1 });
  });
});

describe('trendSnapshotInputs', () => {
  const hard = { count: 2, budget: 3 };

  it('always includes hard_budget, even with nothing else to report', () => {
    const inputs = trendSnapshotInputs([], null, hard);
    expect(inputs.map((i) => i.kind)).toEqual(['hard_budget']);
  });

  it('includes lift_trend only when there are lifts, erg_trend only when there is one', () => {
    const lifts = [{ label: 'Back Squat', sub: '', points: [100], latest: 100, delta: null }];
    const erg = { label: '2000m row', sub: '', points: [120], latest: 120, delta: null };
    const inputs = trendSnapshotInputs(lifts, erg, hard);
    expect(inputs.map((i) => i.kind)).toEqual(['lift_trend', 'erg_trend', 'hard_budget']);
  });
});
