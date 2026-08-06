import type { Workout } from '@hybrid/engine';
import type { AthleteStateSnapshot, StateConstraint } from '@hybrid/whole-athlete-state';
import { WHOLE_ATHLETE_STATE_SCHEMA_VERSION } from '@hybrid/whole-athlete-state';

/**
 * Pure fixture builders for the Simulate panel. Never read from `useDb()` or
 * any store — every value here is synthetic, by construction, so a coach can
 * safely explore "what would the resolver do" without any chance of touching
 * the athlete's real workout or real athlete-state.
 */

export type ScenarioKind = 'strength' | 'conditioning';

export type ConstraintPreset =
  | 'none'
  | 'low_readiness'
  | 'time_limited'
  | 'pain_hold_active'
  | 'illness_flag_active';

export const SCENARIO_KIND_LABEL: Record<ScenarioKind, string> = {
  strength: 'Strength — synthetic example',
  conditioning: 'Conditioning — synthetic example',
};

export const CONSTRAINT_PRESET_LABEL: Record<ConstraintPreset, string> = {
  none: 'None — nothing active',
  low_readiness: 'Low readiness (soft)',
  time_limited: 'Time limited (soft)',
  pain_hold_active: 'Pain hold active (hard)',
  illness_flag_active: 'Illness flag active (hard)',
};

const sets = (n: number, t: string, rpe: string) => Array.from({ length: n }, () => ({ t, rpe }));

/**
 * A minimal representative fixture — one block, 2-3 sets — never a real
 * workout. The id prefix `sim-` keeps it unmistakable in any log output.
 */
export function buildFixtureWorkout(kind: ScenarioKind): Workout {
  if (kind === 'conditioning') {
    return {
      id: 'sim-cond',
      name: 'Simulated conditioning example',
      kind: 'conditioning',
      blocks: [
        {
          id: 'sim-c1',
          kind: 'conditioning',
          condFmt: 'steady',
          modality: 'row',
          minutes: 30,
          effort: 'hard',
          targetZone: 'high',
        },
      ],
    };
  }
  return {
    id: 'sim-str',
    name: 'Simulated strength example',
    kind: 'strength',
    blocks: [
      {
        id: 'sim-s1',
        exercises: [{ id: 'sim-e1', name: 'Back Squat', mode: 'reps_kg', sets: sets(3, '5', '8') }],
      },
    ],
  };
}

const CONSTRAINT_FIXTURES: Record<Exclude<ConstraintPreset, 'none'>, StateConstraint> = {
  low_readiness: {
    code: 'low_readiness',
    domain: 'both',
    hard: false,
    reason: 'The available recovery signals are in the low band.',
    adjustment: 'Cap the session around RPE 7 and reduce optional volume.',
  },
  time_limited: {
    code: 'time_limited',
    domain: 'both',
    hard: false,
    reason: 'Available training time is limited.',
    adjustment: 'Use a minimum viable session instead of treating the day as failed.',
  },
  pain_hold_active: {
    code: 'pain_hold_active',
    domain: 'both',
    hard: true,
    reason: 'Pain hold is active.',
    adjustment: 'Do not push through the flagged pain; modify or stop and reassess.',
  },
  illness_flag_active: {
    code: 'illness_flag_active',
    domain: 'both',
    hard: true,
    reason: 'A manual or observed illness flag is active.',
    adjustment: 'Avoid high-intensity training and follow the return-to-training process; this is not a diagnosis.',
  },
};

/**
 * A fresh, minimal AthleteStateSnapshot matching the chosen preset — never
 * the real athleteState. Readiness/illness fields stay internally consistent
 * with the preset so the resolver sees one coherent, if synthetic, picture.
 */
export function buildFixtureSnapshot(preset: ConstraintPreset, asOf: string): AthleteStateSnapshot {
  const constraint = preset === 'none' ? null : CONSTRAINT_FIXTURES[preset];
  const illnessActive = preset === 'illness_flag_active';
  const lowReadiness = preset === 'low_readiness';
  return {
    schemaVersion: WHOLE_ATHLETE_STATE_SCHEMA_VERSION,
    asOf,
    readiness: {
      score: lowReadiness ? 30 : 65,
      band: lowReadiness ? 'low' : 'moderate',
      confidence: 'good',
      signals: [],
      rationale: constraint ? [constraint.reason] : ['No dominant negative recovery signal was recorded.'],
    },
    recoveryDebt: { score: 10, band: 'low', daysObserved: 5, rationale: [] },
    capacity: { overall: 'moderate', strength: 'moderate', conditioning: 'moderate' },
    illness: { status: illnessActive ? 'active' : 'clear', source: illnessActive ? 'manual' : 'none' },
    constraints: constraint ? [constraint] : [],
    dataQuality: 'good',
    advisory: { hrvMs: null, note: 'Synthetic simulation snapshot — not a real reading.' },
  };
}
