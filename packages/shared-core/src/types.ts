/**
 * Shared athlete facts and cross-app contracts.
 *
 * This package deliberately has no dependency on Strength, Conditioning,
 * React, Supabase or a storage implementation. It is the compatibility layer
 * that both products can carry forward when their release cycles differ.
 */

export const SHARED_CORE_SCHEMA_VERSION = 1 as const;
export const SYNC_ENVELOPE_SCHEMA_VERSION = 1 as const;

export type SharedCoreSchemaVersion = typeof SHARED_CORE_SCHEMA_VERSION;
export type SyncEnvelopeSchemaVersion = typeof SYNC_ENVELOPE_SCHEMA_VERSION;

export type ProductDomain = 'core' | 'strength' | 'conditioning' | 'athlete_state' | 'coordinator';
export type AthleteGoal = 'strength' | 'conditioning' | 'hybrid' | 'health';
export type Units = 'kg' | 'lb';
export type IllnessStatus = 'clear' | 'suspected' | 'active' | 'returning';
export type DataQuality = 'good' | 'partial' | 'limited' | 'missing';

export interface CoreProfile {
  displayName?: string;
  age?: number;
  units?: Units;
  timezone?: string;
}

export interface GoalPriorities {
  strength: number;
  conditioning: number;
  health: number;
}

export interface AthleteGoals {
  primary: AthleteGoal;
  priorities: GoalPriorities;
  updatedAt: number;
}

export interface WeeklySchedule {
  /** ISO weekday values: Monday=1 through Sunday=7. */
  availableDays: number[];
  preferredSessionMinutes?: number;
  maxSessionsPerWeek?: number;
  strengthSessionsPerWeek: number;
  conditioningSessionsPerWeek: number;
  /** Dates explicitly protected from automatic placement. */
  blockedDates: string[];
  updatedAt: number;
}

export type BodyMetricKind = 'weight' | 'resting_hr' | 'waist';

export interface BodyMetric {
  id: string;
  kind: BodyMetricKind;
  value: number;
  unit: string;
  measuredAt: string;
  source?: string;
}

export interface LifeLoadObservation {
  id: string;
  date: string;
  /** Self-reported work/life stress, 0–10. */
  stress?: number;
  /** Physical work or unusually high daily activity, 0–10. */
  physicalLoad?: number;
  /** Optional step count; descriptive context, not a medical measure. */
  steps?: number;
  availableMinutes?: number;
  source?: 'manual' | 'device' | 'import';
}

export interface RecoveryObservation {
  id: string;
  date: string;
  sleepHours?: number;
  sleepQuality?: number;
  energy?: number;
  soreness?: number;
  motivation?: number;
  stress?: number;
  illnessStatus?: IllnessStatus;
  painAreas?: string[];
  source?: 'manual' | 'whoop' | 'import';
  recordedAt: number;
}

export interface SafetyFlags {
  painHold?: {
    active: boolean;
    areas: string[];
    updatedAt: number;
  };
  illness?: {
    status: IllnessStatus;
    updatedAt: number;
    note?: string;
  };
}

/** WHOOP values are advisory observations. They never become a pain gate. */
export interface WhoopDailyRecord {
  date: string;
  recoveryScore?: number | null;
  strain?: number | null;
  hrvMs?: number | null;
  restingHr?: number | null;
  sleepPerformance?: number | null;
  capturedAt?: string;
  source?: string;
}

export type AthleteEventType =
  | 'workout_completed'
  | 'workout_modified'
  | 'training_load_recorded'
  | 'body_weight_recorded'
  | 'readiness_recorded'
  | 'nutrition_target_updated';

export interface AthleteEvent {
  id: string;
  type: AthleteEventType;
  occurredAt: string;
  sourceDomain: ProductDomain;
  idempotencyKey: string;
  payload: Record<string, unknown>;
}

export interface SharedCoreState {
  schemaVersion: SharedCoreSchemaVersion;
  profile: CoreProfile;
  goals: AthleteGoals;
  schedule: WeeklySchedule;
  bodyMetrics: BodyMetric[];
  lifeLoad: LifeLoadObservation[];
  recovery: RecoveryObservation[];
  safety: SafetyFlags;
  whoopDaily: WhoopDailyRecord[];
  events: AthleteEvent[];
  updatedAt: number;
}

export interface VersionedSnapshot<T> {
  schemaVersion: SyncEnvelopeSchemaVersion;
  domain: ProductDomain;
  revision: number;
  updatedAt: number;
  writer: string;
  data: T;
}

/**
 * The namespace stored beside the legacy `hybridEngine` blob during migration.
 * Domain snapshots are independently versioned so a Conditioning release
 * cannot overwrite Strength data simply because it has an older client build.
 */
export interface EcosystemSyncNamespace {
  schemaVersion: SyncEnvelopeSchemaVersion;
  core: SharedCoreState;
  /** Revision metadata for the core row; kept separate for migration compatibility. */
  coreSnapshot?: VersionedSnapshot<SharedCoreState>;
  partitions: {
    strength?: VersionedSnapshot<unknown>;
    conditioning?: VersionedSnapshot<unknown>;
    athleteState?: VersionedSnapshot<unknown>;
    weeklyPlan?: VersionedSnapshot<unknown>;
  };
  events: AthleteEvent[];
}
