import { describe, expect, it } from 'vitest';
import type { ResolutionOperation } from '@hybrid/auto-coach';
import {
  applyServerProgression,
  sanitizeAssignedWorkoutBody,
  sanitizeReceiptOperations,
  structurallyEqual,
  trendSnapshotInputs,
} from './arc-athlete-sync';

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

describe('sanitizeReceiptOperations', () => {
  const op = (over: Partial<ResolutionOperation> = {}): ResolutionOperation => ({
    type: 'cap_intensity' as const,
    targetPath: 'blocks[0].exercises[1]',
    before: 'Bulgarian Split Squat above @7',
    after: 'Bulgarian Split Squat capped @7',
    reasonCode: 'low_readiness',
    materiality: 'material' as const,
    reversible: true as const,
    ...over,
  });

  it('drops before/after — the exercise-name leak this function exists to close', () => {
    const [out] = sanitizeReceiptOperations([op()]);
    expect(out).not.toHaveProperty('before');
    expect(out).not.toHaveProperty('after');
  });

  it('keeps type, targetPath, reasonCode and materiality — what a coach is actually entitled to', () => {
    const [out] = sanitizeReceiptOperations([op()]);
    expect(out).toEqual({
      type: 'cap_intensity',
      targetPath: 'blocks[0].exercises[1]',
      reasonCode: 'low_readiness',
      materiality: 'material',
    });
  });

  it('maps every operation in the array, preserving order', () => {
    const out = sanitizeReceiptOperations([op({ type: 'rest_or_pause' }), op({ type: 'hold_progression' })]);
    expect(out.map((o) => o.type)).toEqual(['rest_or_pause', 'hold_progression']);
  });

  it('returns an empty array for an empty input', () => {
    expect(sanitizeReceiptOperations([])).toEqual([]);
  });
});

describe('sanitizeAssignedWorkoutBody', () => {
  it('carries kind, name and blocks through from a well-shaped body', () => {
    const out = sanitizeAssignedWorkoutBody({ kind: 'strength', name: 'Upper A', blocks: [{ id: 'b1' }] }, [1, 3]);
    expect(out).toEqual({ kind: 'strength', name: 'Upper A', blocks: [{ id: 'b1' }], days: [1, 3] });
  });

  it('sorts days regardless of input order — the backend union relies on it staying sorted', () => {
    const out = sanitizeAssignedWorkoutBody({ kind: 'strength', name: 'Upper A', blocks: [] }, [5, 0, 3]);
    expect(out?.days).toEqual([0, 3, 5]);
  });

  it('defaults a missing/garbage name rather than shipping an unnamed workout', () => {
    const out = sanitizeAssignedWorkoutBody({ kind: 'strength', blocks: [] }, []);
    expect(out?.name).toBe('Assigned workout');
  });

  it('defaults blocks to [] rather than trusting a non-array', () => {
    const out = sanitizeAssignedWorkoutBody({ kind: 'strength', name: 'X', blocks: 'not-an-array' }, []);
    expect(out?.blocks).toEqual([]);
  });

  it('drops an unrecognised kind rather than passing through an arbitrary string', () => {
    const out = sanitizeAssignedWorkoutBody({ kind: 'sabotage', name: 'X', blocks: [] }, []);
    expect(out?.kind).toBeUndefined();
  });

  it('refuses entirely when the body is not an object — a null/scalar jsonb write', () => {
    expect(sanitizeAssignedWorkoutBody(null, [1])).toBeNull();
    expect(sanitizeAssignedWorkoutBody('sabotage', [1])).toBeNull();
    expect(sanitizeAssignedWorkoutBody(42, [1])).toBeNull();
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
