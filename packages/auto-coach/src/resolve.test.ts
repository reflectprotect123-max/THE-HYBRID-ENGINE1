import { describe, expect, it } from 'vitest';
import type { Workout } from '@hybrid/engine';
import type { AthleteStateSnapshot, StateConstraint } from '@hybrid/whole-athlete-state';
import { DEFAULT_POLICY, resolveSession, type AutonomyPolicy } from './index';

/* ---------- fixtures ---------- */

const sets = (n: number, t: string, rpe: string) => Array.from({ length: n }, () => ({ t, rpe }));

const strengthWorkout = (): Workout =>
  ({
    id: 'w-str',
    name: 'Heavy Lower',
    kind: 'strength',
    blocks: [
      { id: 'warm', warmup: true, exercises: [{ id: 'wu', name: 'Ramp', mode: 'reps_kg', sets: sets(2, 'W5', '') }] },
      {
        id: 'work',
        exercises: [
          { id: 'e1', name: 'Back Squat', mode: 'reps_kg', sets: sets(5, '5', '8') },
          { id: 'e2', name: 'RDL', mode: 'reps_kg', sets: sets(3, '8', '7') },
        ],
      },
    ],
  }) as Workout;

const mixedCondWorkout = (): Workout =>
  ({
    id: 'w-cond',
    name: 'Engine',
    kind: 'conditioning',
    blocks: [
      { id: 'c1', kind: 'conditioning', condFmt: 'intervals', modality: 'row', minutes: 40, effort: 'hard', targetZone: 'high' },
    ],
  }) as Workout;

const constraint = (over: Partial<StateConstraint>): StateConstraint => ({
  code: 'low_readiness',
  domain: 'both',
  hard: false,
  reason: 'Readiness is low',
  adjustment: 'Cap the session around RPE 7',
  ...over,
});

const snapshot = (over: Partial<AthleteStateSnapshot>): AthleteStateSnapshot =>
  ({
    schemaVersion: 1,
    asOf: '2026-08-06',
    readiness: { score: 60, band: 'moderate', confidence: 'good', signals: [], rationale: [] },
    recoveryDebt: { score: 10, band: 'low', daysObserved: 5, rationale: [] },
    capacity: { overall: 'moderate', strength: 'moderate', conditioning: 'moderate' },
    illness: { status: 'clear', source: 'none' },
    constraints: [],
    dataQuality: 'good',
    advisory: { hrvMs: null, note: '' },
    ...over,
  }) as AthleteStateSnapshot;

const policy = (over: Partial<AutonomyPolicy>): AutonomyPolicy => ({ ...DEFAULT_POLICY, ...over });

/* ---------- invariants ---------- */

describe('determinism and purity', () => {
  it('same versioned inputs produce identical output', () => {
    const input = {
      workout: strengthWorkout(),
      policy: DEFAULT_POLICY,
      state: snapshot({ constraints: [constraint({})] }),
    };
    const a = resolveSession(input);
    const b = resolveSession(input);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it('never mutates the coach-authored workout', () => {
    const w = strengthWorkout();
    const before = JSON.stringify(w);
    resolveSession({
      workout: w,
      policy: DEFAULT_POLICY,
      state: snapshot({
        readiness: { score: 30, band: 'low', confidence: 'good', signals: [], rationale: [] },
        constraints: [constraint({})],
      }),
    });
    expect(JSON.stringify(w)).toEqual(before);
  });
});

describe('safety precedence', () => {
  it('a hard pain constraint produces safety_stop regardless of a high readiness score', () => {
    const r = resolveSession({
      workout: strengthWorkout(),
      policy: policy({ mode: 'auto_daily', permissions: { cap_intensity: 'auto', trim_conditioning_minutes: 'auto', hold_progression: 'auto' } }),
      state: snapshot({
        readiness: { score: 95, band: 'high', confidence: 'good', signals: [], rationale: [] },
        constraints: [
          constraint({ code: 'pain_hold_active', hard: true, reason: 'Pain hold is active', adjustment: 'Stop the affected work' }),
        ],
      }),
    });
    expect(r.state).toBe('safety_stop');
    expect(r.autoApplyAllowed).toBe(false);
    expect(r.requiresConfirmation).toBe(true);
    expect(r.reasonCodes).toContain('pain_hold_active');
  });

  it('an illness flag stops adaptation for both domains', () => {
    const r = resolveSession({
      workout: mixedCondWorkout(),
      policy: DEFAULT_POLICY,
      state: snapshot({
        illness: { status: 'active', source: 'manual' },
        constraints: [
          constraint({ code: 'illness_flag_active', hard: true, reason: 'Illness flag', adjustment: 'Recover first' }),
        ],
      }),
    });
    expect(r.state).toBe('safety_stop');
    expect(r.operations.every((o) => o.type === 'rest_or_pause')).toBe(true);
  });

  it('adding a hard constraint to an advisory situation only makes it more conservative', () => {
    const softState = snapshot({ constraints: [constraint({})] });
    const advisory = resolveSession({ workout: strengthWorkout(), policy: DEFAULT_POLICY, state: softState });
    const withPain = resolveSession({
      workout: strengthWorkout(),
      policy: DEFAULT_POLICY,
      state: snapshot({
        constraints: [constraint({}), constraint({ code: 'pain_hold_active', hard: true, reason: 'Pain', adjustment: 'Stop' })],
      }),
    });
    expect(advisory.state).toBe('advisory');
    expect(withPain.state).toBe('safety_stop');
  });
});

describe('constraint application within policy', () => {
  it('low_readiness caps strength RPE above the policy cap, skipping warm-ups', () => {
    const r = resolveSession({
      workout: strengthWorkout(),
      policy: DEFAULT_POLICY,
      state: snapshot({ constraints: [constraint({})] }),
    });
    expect(r.state).toBe('advisory');
    const work = r.resolvedWorkout.blocks[1]!;
    expect(work.exercises![0]!.sets.every((s: { rpe: string }) => s.rpe === '7')).toBe(true);
    expect(work.exercises![1]!.sets.every((s: { rpe: string }) => s.rpe === '7')).toBe(true); // already ≤ cap, untouched
    const warm = r.resolvedWorkout.blocks[0]!;
    expect(warm.exercises![0]!.sets[0]!.rpe).toBe(''); // warm-up untouched
    expect(r.operations.filter((o) => o.type === 'cap_intensity')).toHaveLength(1);
  });

  it('low_readiness steps hard conditioning down one effort level', () => {
    const r = resolveSession({
      workout: mixedCondWorkout(),
      policy: DEFAULT_POLICY,
      state: snapshot({ constraints: [constraint({})] }),
    });
    const cb = r.resolvedWorkout.blocks[0]!;
    expect(cb.kind === 'conditioning' && cb.effort).toBe('medium');
  });

  it('time_limited trims conditioning minutes but never below the policy floor', () => {
    const r = resolveSession({
      workout: mixedCondWorkout(),
      policy: DEFAULT_POLICY,
      state: snapshot({
        constraints: [constraint({ code: 'time_limited', reason: 'Under 30 minutes today', adjustment: 'Minimum viable session' })],
      }),
    });
    const cb = r.resolvedWorkout.blocks[0]!;
    expect(cb.kind === 'conditioning' && cb.minutes).toBe(20); // 40 × 0.5 floor
  });

  it('an off permission removes the action entirely — no path recreates it', () => {
    const r = resolveSession({
      workout: strengthWorkout(),
      policy: policy({ permissions: { cap_intensity: 'off', trim_conditioning_minutes: 'off', hold_progression: 'off' } }),
      state: snapshot({ constraints: [constraint({})] }),
    });
    expect(r.state).toBe('normal');
    expect(r.operations.map((o) => o.type)).toEqual(['keep_as_planned']);
  });

  it('constraints scoped to the other domain do not fire', () => {
    const r = resolveSession({
      workout: strengthWorkout(),
      policy: DEFAULT_POLICY,
      state: snapshot({ constraints: [constraint({ domain: 'conditioning' })] }),
    });
    expect(r.state).toBe('normal');
  });
});

describe('missing data and autonomy', () => {
  it('missing data yields normal state, insufficient confidence, and an abstention reason', () => {
    const r = resolveSession({
      workout: strengthWorkout(),
      policy: policy({ mode: 'auto_daily' }),
      state: snapshot({
        readiness: { score: null, band: 'unknown', confidence: 'missing', signals: [], rationale: [] },
        dataQuality: 'missing',
      }),
    });
    expect(r.state).toBe('normal');
    expect(r.confidence).toBe('insufficient');
    expect(r.abstentionReason).toBe('no_signals');
    expect(r.autoApplyAllowed).toBe(false);
  });

  it('limited data forces confirmation even in auto_daily with auto permissions', () => {
    const r = resolveSession({
      workout: strengthWorkout(),
      policy: policy({
        mode: 'auto_daily',
        permissions: { cap_intensity: 'auto', trim_conditioning_minutes: 'auto', hold_progression: 'auto' },
      }),
      state: snapshot({ dataQuality: 'limited', constraints: [constraint({})] }),
    });
    expect(r.requiresConfirmation).toBe(true);
    expect(r.autoApplyAllowed).toBe(false);
  });

  it('auto-apply is possible only in auto_daily with auto permission and good data', () => {
    const r = resolveSession({
      workout: strengthWorkout(),
      policy: policy({
        mode: 'auto_daily',
        permissions: { cap_intensity: 'auto', trim_conditioning_minutes: 'auto', hold_progression: 'auto' },
      }),
      state: snapshot({ constraints: [constraint({})] }),
    });
    expect(r.autoApplyAllowed).toBe(true);
    const shadow = resolveSession({
      workout: strengthWorkout(),
      policy: DEFAULT_POLICY, // shadow mode
      state: snapshot({ constraints: [constraint({})] }),
    });
    expect(shadow.autoApplyAllowed).toBe(false);
    expect(shadow.requiresConfirmation).toBe(true);
  });
});

describe('policy lifecycle', () => {
  it('a paused policy evaluates nothing', () => {
    const r = resolveSession({
      workout: strengthWorkout(),
      policy: policy({ status: 'paused' }),
      state: snapshot({ constraints: [constraint({})] }),
    });
    expect(r.operations).toEqual([]);
    expect(r.abstentionReason).toBe('policy_not_active');
  });
});

describe('receipt quality', () => {
  it('every operation carries a reason code traceable to a constraint', () => {
    const r = resolveSession({
      workout: mixedCondWorkout(),
      policy: DEFAULT_POLICY,
      state: snapshot({
        constraints: [
          constraint({}),
          constraint({ code: 'time_limited', reason: 'Under 30 minutes', adjustment: 'Minimum viable session' }),
        ],
      }),
    });
    for (const op of r.operations) expect(op.reasonCode.length).toBeGreaterThan(0);
    expect(r.inferences.length).toBeGreaterThan(0);
    expect(r.athleteMessage).toMatch(/today only|future sessions are unchanged/i);
  });
});
