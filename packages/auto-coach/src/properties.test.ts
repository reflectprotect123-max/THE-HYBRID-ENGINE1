import { describe, expect, it } from 'vitest';
import type { CondBlock, Exercise, StrengthBlock, Workout } from '@hybrid/engine';
import type { DataQuality, IllnessStatus } from '@hybrid/shared-core';
import type {
  AthleteStateSnapshot,
  CapacityBand,
  ConstraintCode,
  ConstraintDomain,
  ReadinessBand,
  StateConstraint,
} from '@hybrid/whole-athlete-state';
import { resolveSession, type ActionPermission, type AutonomyPolicy } from './index';

/*
 * Deterministic PRNG (mulberry32) so every run of this suite generates the
 * exact same corpus. No Math.random() anywhere below this line.
 */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function rng(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 0xc0ffee;
const CASES_PER_PROPERTY = 50;

type Rng = () => number;

function randInt(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function pick<T>(rng: Rng, options: readonly T[]): T {
  return options[randInt(rng, 0, options.length - 1)]!;
}

function randBool(rng: Rng, pTrue = 0.5): boolean {
  return rng() < pTrue;
}

/* ---------- workout generators ---------- */

function genPlannedSet(rng: Rng): { t: string; rpe: string } {
  const rpe = pick(rng, ['5', '6', '6.5', '7', '7.5', '8', '8.5', '9', '9.5', '10']);
  return { t: String(randInt(rng, 1, 12)), rpe };
}

function genExercise(rng: Rng, idx: number): Exercise {
  const setCount = randInt(rng, 1, 4);
  return {
    id: `ex-${idx}`,
    name: `Exercise ${idx}`,
    mode: 'reps_kg',
    sets: Array.from({ length: setCount }, () => genPlannedSet(rng)),
  };
}

function genStrengthBlock(rng: Rng, idx: number, warmup: boolean): StrengthBlock {
  const exerciseCount = randInt(rng, 1, 3);
  return {
    id: `sb-${idx}`,
    warmup,
    exercises: Array.from({ length: exerciseCount }, (_, i) => genExercise(rng, i)),
  };
}

const EFFORT_ZONE: Record<'easy' | 'medium' | 'hard', 'low' | 'mod' | 'high'> = {
  easy: 'low',
  medium: 'mod',
  hard: 'high',
};

function genCondBlock(rng: Rng, idx: number): CondBlock {
  const effort = pick(rng, ['easy', 'medium', 'hard'] as const);
  return {
    id: `cb-${idx}`,
    kind: 'conditioning',
    condFmt: pick(rng, ['steady', 'intervals', 'tempo', 'custom', 'free'] as const),
    modality: pick(rng, ['row', 'run', 'ski', 'bike', 'air_bike'] as const),
    minutes: randInt(rng, 10, 90),
    effort,
    targetZone: EFFORT_ZONE[effort],
  };
}

function genWorkout(rng: Rng, id: string): Workout {
  const kind = pick(rng, ['strength', 'conditioning'] as const);
  const blockCount = randInt(rng, 1, 3);

  if (kind === 'strength') {
    const blocks: StrengthBlock[] = [];
    if (randBool(rng, 0.5)) blocks.push(genStrengthBlock(rng, blocks.length, true));
    for (let i = 0; i < blockCount; i++) blocks.push(genStrengthBlock(rng, blocks.length, false));
    return { id, name: `Workout ${id}`, kind, blocks };
  }

  const blocks: CondBlock[] = Array.from({ length: blockCount }, (_, i) => genCondBlock(rng, i));
  return { id, name: `Workout ${id}`, kind, blocks };
}

/* ---------- policy generator ---------- */

function genPermission(rng: Rng): ActionPermission {
  return pick(rng, ['off', 'ask_first', 'auto'] as const);
}

function genPolicy(rng: Rng, overrides: Partial<AutonomyPolicy> = {}): AutonomyPolicy {
  return {
    schemaVersion: 1,
    version: randInt(rng, 1, 5),
    owner: 'athlete',
    mode: pick(rng, ['shadow', 'assisted', 'auto_daily'] as const),
    status: pick(rng, ['active', 'paused', 'revoked'] as const),
    permissions: {
      cap_intensity: genPermission(rng),
      trim_conditioning_minutes: genPermission(rng),
      hold_progression: genPermission(rng),
    },
    rpeCap: randInt(rng, 5, 9),
    minConditioningFraction: pick(rng, [0.2, 0.3, 0.5, 0.6, 0.7]),
    ...overrides,
  };
}

/* ---------- athlete-state generator ---------- */

const CONSTRAINT_CODES: readonly ConstraintCode[] = [
  'pain_hold_active',
  'illness_flag_active',
  'low_readiness',
  'recovery_debt_high',
  'physical_load_high',
  'time_limited',
];
const HARD_CODES = new Set<ConstraintCode>(['pain_hold_active', 'illness_flag_active']);
const DOMAINS: readonly ConstraintDomain[] = ['strength', 'conditioning', 'both'];
const DATA_QUALITIES: readonly DataQuality[] = ['good', 'partial', 'limited', 'missing'];
const READINESS_BANDS: readonly ReadinessBand[] = ['high', 'moderate', 'low', 'unknown'];
const CAPACITY_BANDS: readonly CapacityBand[] = ['high', 'moderate', 'low', 'unknown'];
const ILLNESS_STATUSES: readonly IllnessStatus[] = ['clear', 'suspected', 'active', 'returning'];

function genConstraint(rng: Rng): StateConstraint {
  const code = pick(rng, CONSTRAINT_CODES);
  return {
    code,
    domain: pick(rng, DOMAINS),
    hard: HARD_CODES.has(code) ? randBool(rng, 0.8) : randBool(rng, 0.1),
    reason: `generated reason for ${code}`,
    adjustment: `generated adjustment for ${code}`,
  };
}

function genSnapshot(rng: Rng): AthleteStateSnapshot {
  const dataQuality = pick(rng, DATA_QUALITIES);
  const constraintCount = randInt(rng, 0, 3);
  return {
    schemaVersion: 1,
    asOf: '2026-08-06',
    readiness: {
      score: randBool(rng, 0.85) ? randInt(rng, 0, 100) : null,
      band: pick(rng, READINESS_BANDS),
      confidence: pick(rng, DATA_QUALITIES),
      signals: [],
      rationale: [],
    },
    recoveryDebt: {
      score: randInt(rng, 0, 100),
      band: pick(rng, ['low', 'moderate', 'high'] as const),
      daysObserved: randInt(rng, 0, 14),
      rationale: [],
    },
    capacity: {
      overall: pick(rng, CAPACITY_BANDS),
      strength: pick(rng, CAPACITY_BANDS),
      conditioning: pick(rng, CAPACITY_BANDS),
    },
    illness: {
      status: pick(rng, ILLNESS_STATUSES),
      source: pick(rng, ['manual', 'observation', 'none'] as const),
    },
    constraints: Array.from({ length: constraintCount }, () => genConstraint(rng)),
    dataQuality,
    advisory: { hrvMs: randBool(rng, 0.5) ? randInt(rng, 30, 90) : null, note: '' },
  };
}

interface GeneratedCase {
  workout: Workout;
  policy: AutonomyPolicy;
  state: AthleteStateSnapshot;
}

function genCase(rng: Rng, idx: number): GeneratedCase {
  return {
    workout: genWorkout(rng, `gen-${idx}`),
    policy: genPolicy(rng),
    state: genSnapshot(rng),
  };
}

function corpus(seed: number, count: number, mapper?: (c: GeneratedCase) => GeneratedCase): GeneratedCase[] {
  const rng = mulberry32(seed);
  const cases: GeneratedCase[] = [];
  for (let i = 0; i < count; i++) {
    const c = genCase(rng, i);
    cases.push(mapper ? mapper(c) : c);
  }
  return cases;
}

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;

/* ---------- properties ---------- */

describe('property: hard constraints only ever tighten the outcome', () => {
  it('adding a hard constraint always yields safety_stop, regardless of the base result', () => {
    // Lifecycle (paused/revoked) is a separate concern covered elsewhere;
    // pin status active so the safety gate itself is what's under test.
    const cases = corpus(SEED, CASES_PER_PROPERTY, (c) => ({
      ...c,
      policy: { ...c.policy, status: 'active' },
    }));

    for (const { workout, policy, state } of cases) {
      const baseline = resolveSession({ workout, policy, state });

      const domainOf = workout.kind ?? 'strength';
      const extraHard: StateConstraint = {
        code: 'pain_hold_active',
        domain: domainOf,
        hard: true,
        reason: 'injected hard constraint',
        adjustment: 'stop the affected work',
      };
      const escalated = resolveSession({
        workout,
        policy,
        state: { ...state, constraints: [...state.constraints, extraHard] },
      });

      expect(escalated.state).toBe('safety_stop');
      void baseline; // baseline recorded only to document "regardless of what it was"
    }
  });
});

describe('property: missing data never increases autonomy', () => {
  it('forcing dataQuality to missing never leaves autoApplyAllowed true', () => {
    const cases = corpus(SEED + 1, CASES_PER_PROPERTY);
    let sawAutoApplyTrue = false;

    for (const { workout, policy, state } of cases) {
      const baseline = resolveSession({ workout, policy, state });
      if (!baseline.autoApplyAllowed) continue;
      sawAutoApplyTrue = true;

      const degraded = resolveSession({
        workout,
        policy,
        state: { ...state, dataQuality: 'missing' },
      });
      expect(degraded.autoApplyAllowed).toBe(false);
    }

    // Supplement the corpus with policies biased toward autonomy, so the
    // invariant is exercised even if the base corpus happened to produce
    // few/no autoApplyAllowed:true baselines.
    if (!sawAutoApplyTrue) {
      const biased = corpus(SEED + 101, CASES_PER_PROPERTY, (c) => ({
        ...c,
        policy: {
          ...c.policy,
          status: 'active',
          mode: 'auto_daily',
          permissions: { cap_intensity: 'auto', trim_conditioning_minutes: 'auto', hold_progression: 'auto' },
        },
        state: { ...c.state, dataQuality: 'good' },
      }));
      for (const { workout, policy, state } of biased) {
        const baseline = resolveSession({ workout, policy, state });
        if (!baseline.autoApplyAllowed) continue;
        sawAutoApplyTrue = true;
        const degraded = resolveSession({ workout, policy, state: { ...state, dataQuality: 'missing' } });
        expect(degraded.autoApplyAllowed).toBe(false);
      }
    }

    expect(sawAutoApplyTrue).toBe(true);
  });
});

describe('property: turning a permission off removes that action type', () => {
  const PERMISSION_KEY: Record<string, keyof AutonomyPolicy['permissions']> = {
    cap_intensity: 'cap_intensity',
    trim_conditioning_minutes: 'trim_conditioning_minutes',
    hold_progression: 'hold_progression',
  };

  it('no operation of a type appears once its permission is forced off', () => {
    const cases = corpus(SEED + 2, CASES_PER_PROPERTY, (c) => ({
      ...c,
      policy: { ...c.policy, status: 'active' },
    }));
    let sawGatedOperation = false;

    for (const { workout, policy, state } of cases) {
      const baseline = resolveSession({ workout, policy, state });

      for (const op of baseline.operations) {
        const permKey = PERMISSION_KEY[op.type];
        if (!permKey) continue; // keep_as_planned / rest_or_pause / ask_for_clarification aren't gated
        sawGatedOperation = true;

        const narrowed = resolveSession({
          workout,
          policy: { ...policy, permissions: { ...policy.permissions, [permKey]: 'off' } },
          state,
        });
        expect(narrowed.operations.some((o) => o.type === op.type)).toBe(false);
      }
    }

    expect(sawGatedOperation).toBe(true);
  });
});

describe('property: resolveSession never mutates its input workout', () => {
  it('input workout is byte-identical before and after resolution, across the corpus', () => {
    const cases = corpus(SEED + 3, CASES_PER_PROPERTY);
    for (const { workout, policy, state } of cases) {
      const before = JSON.stringify(workout);
      resolveSession({ workout, policy, state });
      expect(JSON.stringify(workout)).toEqual(before);
    }
  });
});

describe('property: determinism holds across the generated corpus', () => {
  it('resolving the same input twice yields identical output for every generated case', () => {
    const cases = corpus(SEED + 4, CASES_PER_PROPERTY);
    for (const { workout, policy, state } of cases) {
      const input = { workout: clone(workout), policy: clone(policy), state: clone(state) };
      const a = resolveSession(input);
      const b = resolveSession(input);
      expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
    }
  });
});
