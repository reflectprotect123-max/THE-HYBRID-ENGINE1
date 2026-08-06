import type { Workout } from '@hybrid/engine';
import type { AthleteStateSnapshot } from '@hybrid/whole-athlete-state';

/**
 * Auto-Coached mode: typed contracts for a bounded, deterministic,
 * SESSION-level resolver. This package is PURE — no storage, no network,
 * no clock reads. Every function takes versioned inputs and returns data.
 *
 * Architecture decision, from auditing the repo rather than the brief's
 * assumptions: the athlete's check-in already exists as shared-core
 * observations (RecoveryObservation / LifeLoadObservation / SafetyFlags),
 * and whole-athlete-state already interprets them into StateConstraints —
 * including session-level adjustments ("Cap the session around RPE 7",
 * "minimum viable session") that, until now, NOTHING applied. This
 * resolver's whole job is to apply those existing constraints to one
 * session, inside an athlete-owned policy. It never re-derives readiness,
 * never reads raw signals, and never touches pain/illness logic — that
 * interpretation belongs to whole-athlete-state, per the operating
 * contract.
 */

export const AUTO_COACH_SCHEMA_VERSION = 1 as const;

/* ---------- policy ---------- */

export type ActionType =
  | 'keep_as_planned'
  | 'cap_intensity'
  | 'trim_conditioning_minutes'
  | 'hold_progression'
  | 'rest_or_pause'
  | 'ask_for_clarification';

export type ActionPermission = 'off' | 'ask_first' | 'auto';

/**
 * V1 policy: deliberately small, athlete-owned, versioned. Only actions
 * that map honestly onto the existing schema exist — there is no "remove
 * optional accessory" or "substitute exercise" because the schema has no
 * removable/alternate markers, and inventing them silently is what the
 * build brief forbids. The resolver abstains instead.
 */
export interface AutonomyPolicy {
  schemaVersion: typeof AUTO_COACH_SCHEMA_VERSION;
  version: number;
  owner: 'athlete';
  mode: 'shadow' | 'assisted' | 'auto_daily';
  status: 'active' | 'paused' | 'revoked';
  permissions: {
    cap_intensity: ActionPermission;
    trim_conditioning_minutes: ActionPermission;
    hold_progression: ActionPermission;
  };
  /** cap applied by cap_intensity — matches low_readiness's own advice */
  rpeCap: number;
  /** trim may not cut conditioning below this fraction of planned minutes */
  minConditioningFraction: number;
}

export const DEFAULT_POLICY: AutonomyPolicy = {
  schemaVersion: AUTO_COACH_SCHEMA_VERSION,
  version: 1,
  owner: 'athlete',
  mode: 'shadow',
  status: 'active',
  permissions: {
    cap_intensity: 'ask_first',
    trim_conditioning_minutes: 'ask_first',
    hold_progression: 'auto',
  },
  rpeCap: 7,
  minConditioningFraction: 0.5,
};

/* ---------- resolution ---------- */

export type ResolutionState =
  | 'normal'
  | 'advisory'
  | 'uncertain'
  | 'safety_stop';

export type Materiality = 'trivial' | 'low' | 'material' | 'high';

export interface ResolutionOperation {
  type: ActionType;
  /** where in the session the operation lands, e.g. "blocks[0].exercises[1]" */
  targetPath: string;
  before: string;
  after: string;
  /** the StateConstraint code (or resolver code) that caused it */
  reasonCode: string;
  materiality: Materiality;
  reversible: true;
}

export type Confidence = 'high' | 'limited' | 'insufficient';

export interface SignalLine {
  text: string;
  quality: 'known' | 'unknown' | 'stale';
}

export interface AutoCoachResolution {
  schemaVersion: typeof AUTO_COACH_SCHEMA_VERSION;
  state: ResolutionState;
  originalWorkoutId: string;
  /** a resolved COPY; the coach-authored workout is never mutated */
  resolvedWorkout: Workout;
  operations: ResolutionOperation[];
  /** signal layer of the receipt, from the athlete-state snapshot */
  signals: SignalLine[];
  /** inference layer — the constraints that fired, in their own words */
  inferences: string[];
  reasonCodes: string[];
  confidence: Confidence;
  requiresConfirmation: boolean;
  autoApplyAllowed: boolean;
  /** short, human, non-clinical */
  athleteMessage: string;
  abstentionReason?: string;
}

export interface ResolveInput {
  workout: Workout;
  policy: AutonomyPolicy;
  /** the existing derived snapshot — constraints, readiness, data quality */
  state: AthleteStateSnapshot;
}
