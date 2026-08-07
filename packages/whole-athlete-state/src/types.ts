import type { DataQuality, IllnessStatus, SharedCoreState } from '@hybrid/shared-core';

export const WHOLE_ATHLETE_STATE_SCHEMA_VERSION = 1 as const;

export type ReadinessBand = 'high' | 'moderate' | 'low' | 'unknown';
export type CapacityBand = 'high' | 'moderate' | 'low' | 'unknown';
export type ConstraintDomain = 'strength' | 'conditioning' | 'both';

export type ConstraintCode =
  | 'pain_hold_active'
  | 'illness_flag_active'
  | 'low_readiness'
  | 'recovery_debt_high'
  | 'physical_load_high'
  | 'time_limited'
  | 'low_energy_availability';

/**
 * Nutrition FACTS, read as context. CLAUDE.md's amended nutrition rule is the
 * binding statement: this package may read energy availability and adherence,
 * and it may not read a nutrition target as an instruction.
 *
 * That rule is enforced by what this interface DOES NOT HAVE. There is no
 * calorie target, no macro split, no goal and no program on it, so there is no
 * field through which a target could reach `deriveAthleteState` even by
 * accident — a boundary a reviewer can check by reading four fields rather
 * than by auditing every call site. Adding one here is the change that breaks
 * the contract; `packages/whole-athlete-state/test/nutrition-context.test.ts`
 * pins the behavioural half of the same guarantee.
 *
 * Every field is an OBSERVATION (what the athlete logged, what the nutrition
 * engine estimated they burn), never a prescription (what they should eat).
 */
export interface NutritionContext {
  /** Calendar days these facts were measured over. 0 disables the whole read. */
  windowDays: number;
  /**
   * Days in that window whose food log the nutrition engine counts as complete.
   * This is the adherence numerator: with too few, nothing below fires.
   */
  loggedDays: number;
  /** Mean kcal LOGGED across the counted days; null when there are none. */
  meanIntakeKcal: number | null;
  /**
   * The nutrition engine's own expenditure estimate, or null while it holds.
   *
   * An estimate of what the athlete burns — an observation about their body,
   * which is why it is allowed here. The target BUILT from it is a
   * prescription and is deliberately absent.
   */
  estimatedExpenditureKcal: number | null;
}

export interface RecentTrainingSummary {
  sessionsLast7d: number;
  hardSessionsLast7d: number;
  strengthSessionsLast7d: number;
  conditioningSessionsLast7d: number;
  lowerBodyHardSessionsLast72h: number;
}

export interface TrainingFact {
  completedAt: number;
  domain?: 'strength' | 'conditioning';
  hard?: boolean;
  lowerBodyHard?: boolean;
}

export interface StateConstraint {
  code: ConstraintCode;
  domain: ConstraintDomain;
  hard: boolean;
  reason: string;
  adjustment: string;
}

export interface ReadinessSignal {
  name: string;
  source: 'manual' | 'whoop' | 'life_load' | 'training';
  value: number;
}

export interface ReadinessEstimate {
  score: number | null;
  band: ReadinessBand;
  confidence: DataQuality;
  signals: ReadinessSignal[];
  rationale: string[];
}

export interface RecoveryDebtEstimate {
  score: number;
  band: 'low' | 'moderate' | 'high';
  daysObserved: number;
  rationale: string[];
}

export interface AthleteStateSnapshot {
  schemaVersion: typeof WHOLE_ATHLETE_STATE_SCHEMA_VERSION;
  asOf: string;
  readiness: ReadinessEstimate;
  recoveryDebt: RecoveryDebtEstimate;
  capacity: {
    overall: CapacityBand;
    strength: CapacityBand;
    conditioning: CapacityBand;
  };
  illness: {
    status: IllnessStatus;
    source: 'manual' | 'observation' | 'none';
  };
  constraints: StateConstraint[];
  dataQuality: DataQuality;
  advisory: {
    hrvMs: number | null;
    note: string;
  };
}

export interface AthleteStateInput {
  core: SharedCoreState;
  today: string;
  recentTraining?: RecentTrainingSummary;
  availableMinutes?: number;
  /** Optional. Absent means "no nutrition facts were offered", which reads
   *  exactly the same as facts too thin to act on: no constraint. */
  nutrition?: NutritionContext;
}
