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
 *
 * Nine members were removed on 13 August 2026 — `missed_rep_floor`,
 * `way_too_light`, `too_light`, `easy`, `touch_under_target`, `on_target`,
 * `grindy`, `max_effort`, `unclassified`. They were the per-set RPE
 * classification emitted by `explainSetAdjustment`, which the plan-anchored
 * fold replaced and this branch deleted. Nothing emitted them afterwards and
 * nothing read them: no explainer, no UI switch, and no stored data — a
 * `TrainingDecisionExplanation` is computed on demand and never persisted, and
 * the one `reason_codes` column that IS persisted
 * (`autocoach_receipts`, migration 20260808) is the auto-coach resolver's own
 * disjoint vocabulary, enumerated in its own CHECK constraint. Removing a dead
 * member is therefore not a breaking change, and leaving it would have made
 * "closed set" a claim about the past rather than about what this engine can
 * say today.
 */
export type ReasonCode =
  | 'eased_for_recovery'
  | 'at_earned_weight'
  | 'no_earned_weight'
  | 'at_earned_level'
  | 'baseline_format'
  | 'conditioning_level_progressed'
  | 'conditioning_level_deloaded'
  | 'conditioning_session_excluded'
  | 'conditioning_no_hr_data'
  | 'conditioning_level_held'
  | 'insufficient_exposure_history'
  | 'consistently_on_target'
  | 'consistently_missed'
  // The two "there is nothing to add" codes. A progression decision is judged
  // against what the Logger's field is ALREADY prefilled with, so a streak can
  // be real and the right answer still be silence.
  /** The plan's own rep target already asks for at least what a rep step would. */
  | 'already_at_rep_target'
  /** The earned/prefilled load already meets or beats the load change. */
  | 'already_at_earned_load'
  /**
   * The 2.5% target could not be expressed on the equipment without exceeding
   * `AUTOREG.maxJumpPct`, so the load HELD and reps moved instead. The review
   * that set those constants insists this be recorded rather than silently
   * rounded away — "the correct result is not 27.5 kg disguised as a 2.5%
   * progression".
   */
  | 'equipment_resolution_limits_load'
  /**
   * A deload was owed and there is no on-target session on record to measure
   * it from. Cutting from the missed weight would compound the within-session
   * correction, so nothing moves — see `anchorKgFor`.
   */
  | 'no_successful_anchor'
  | 'mixed_recent_results'
  /**
   * Stage 3 of the RPE progression design: an exposure met its rep floor but
   * carries no RPE rating. It still counts as evidence — it is not
   * `mixed_recent_results` — but it cannot raise confidence past `low` until
   * it is rated.
   */
  | 'exposure_not_rated'
  /**
   * Stage 5: this movement's exposures cross a layoff gap
   * (`AUTOREG.calibrationGapDays`) with fewer than two stable exposures
   * logged since. The session offers a reduced weight to observe, not to
   * progress or deload — see `calibrationStateFor`.
   */
  | 'calibration_active';

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
  /** A concrete number to offer, when `action` proposes one. Absent when the
   * action doesn't have a number to propose (hold, pause_insufficient_data). */
  prescription?: { load?: number; reps?: number };
}
