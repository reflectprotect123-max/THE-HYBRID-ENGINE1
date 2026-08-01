/**
 * Additive, read-only contract for explaining a decision the deterministic
 * engine already made. See
 * docs/superpowers/specs/2026-08-01-adaptive-training-engine-audit-design.md §10.D.
 *
 * Nothing in this file changes what any existing function computes — it only
 * gives an already-computed output a typed, reason-coded shape a later UI or
 * AI-explainer layer can consume without re-deriving the underlying math.
 */

export type ProgressionAction =
  | 'progress_load'
  | 'progress_reps'
  | 'hold'
  | 'reduce_load'
  | 'reduce_volume'
  | 'repeat_session'
  | 'substitute_exercise'
  | 'deload'
  | 'pause_insufficient_data';

export type Confidence = 'low' | 'medium' | 'high';

export type SafetyState = 'approved' | 'held' | 'reduced' | 'blocked';

/**
 * Closed set of stable reason codes. A caller switches on these values, so
 * every explainer in `explain.ts` must draw only from this union — never
 * emit a raw verdict string here even though several explainers echo that
 * same string back in the `note` field for a human to read.
 */
export type ReasonCode =
  | 'missed_rep_floor'
  | 'way_too_light'
  | 'too_light'
  | 'easy'
  | 'touch_under_target'
  | 'on_target'
  | 'grindy'
  | 'max_effort'
  | 'unclassified'
  | 'eased_for_recovery'
  | 'at_earned_weight'
  | 'no_earned_weight'
  | 'at_earned_level'
  | 'baseline_format'
  | 'conditioning_level_progressed'
  | 'conditioning_level_deloaded'
  | 'conditioning_session_excluded'
  | 'conditioning_no_hr_data'
  | 'conditioning_level_held';

export interface TrainingDecisionExplanation {
  action: ProgressionAction;
  confidence: Confidence;
  reasonCodes: ReasonCode[];
  /**
   * Plain-language note, safe to render directly. Never empty — every
   * explainer must supply a non-empty, render-ready sentence.
   */
  note: string;
  safetyState: SafetyState;
  /** What's missing that would raise confidence, if anything. */
  dataLimitations: string[];
}
