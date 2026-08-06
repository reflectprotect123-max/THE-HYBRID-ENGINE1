import type { Workout } from '@hybrid/engine';
import type { AthleteStateSnapshot, StateConstraint } from '@hybrid/whole-athlete-state';
import { DEFAULT_POLICY, type ActionType, type AutonomyPolicy, type Confidence, type ResolutionState, type ResolveInput } from '../../src/index';

export const sets = (n: number, t: string, rpe: string) =>
  Array.from({ length: n }, () => ({ t, rpe }));

export const strengthWorkout = (): Workout =>
  ({
    id: 'w-str',
    name: 'Heavy Lower',
    kind: 'strength',
    blocks: [
      {
        id: 'warm',
        warmup: true,
        exercises: [{ id: 'wu', name: 'Ramp', mode: 'reps_kg', sets: sets(2, 'W5', '') }],
      },
      {
        id: 'work',
        exercises: [
          { id: 'e1', name: 'Back Squat', mode: 'reps_kg', sets: sets(5, '5', '8') },
          { id: 'e2', name: 'RDL', mode: 'reps_kg', sets: sets(3, '8', '7') },
        ],
      },
    ],
  }) as Workout;

export const mixedCondWorkout = (): Workout =>
  ({
    id: 'w-cond',
    name: 'Engine',
    kind: 'conditioning',
    blocks: [
      {
        id: 'c1',
        kind: 'conditioning',
        condFmt: 'intervals',
        modality: 'row',
        minutes: 40,
        effort: 'hard',
        targetZone: 'high',
      },
    ],
  }) as Workout;

export const constraint = (over: Partial<StateConstraint>): StateConstraint => ({
  code: 'low_readiness',
  domain: 'both',
  hard: false,
  reason: 'Readiness is low',
  adjustment: 'Cap the session around RPE 7',
  ...over,
});

export const snapshot = (over: Partial<AthleteStateSnapshot>): AthleteStateSnapshot =>
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

export const policy = (over: Partial<AutonomyPolicy>): AutonomyPolicy => ({ ...DEFAULT_POLICY, ...over });

export interface FixtureExpectation {
  state: ResolutionState;
  reasonCodes: string[];
  confidence: Confidence;
  autoApplyAllowed: boolean;
  operationTypes: ActionType[];
  abstentionReason?: string;
}

export interface Fixture {
  name: string;
  input: ResolveInput;
  expected: FixtureExpectation;
}
