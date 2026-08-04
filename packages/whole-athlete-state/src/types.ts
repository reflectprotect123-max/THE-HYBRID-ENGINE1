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
  | 'time_limited';

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
}
