import type { SetAdjustment, Prescription } from '../types';
import type { WorkingWeight } from '../lift';
import type { ReasonCode, TrainingDecisionExplanation } from './types';

const SET_ADJUSTMENT_REASON_CODES: Record<string, ReasonCode> = {
  'missed the rep floor': 'missed_rep_floor',
  'way too light': 'way_too_light',
  'too light': 'too_light',
  'easy': 'easy',
  'a touch under target': 'touch_under_target',
  'right on target': 'on_target',
  'grindy': 'grindy',
  'max effort': 'max_effort',
};

/**
 * Explains an already-computed set adjustment. Read-only: never recomputes
 * or alters `adj` — it only reshapes it into the adaptive-decision contract.
 */
export function explainSetAdjustment(adj: SetAdjustment): TrainingDecisionExplanation {
  const action =
    adj.verdict === 'right on target'
      ? 'hold'
      : adj.delta < 0
        ? 'reduce_load'
        : adj.delta > 0
          ? 'progress_load'
          : 'hold';
  return {
    action,
    confidence: 'high',
    reasonCodes: [SET_ADJUSTMENT_REASON_CODES[adj.verdict] || 'unclassified'],
    note: adj.verdict,
    safetyState: 'approved',
    dataLimitations: [],
  };
}

/**
 * Explains an already-computed working-weight offer. Read-only, same
 * discipline as `explainSetAdjustment`.
 */
export function explainWorkingWeight(w: WorkingWeight | null): TrainingDecisionExplanation {
  if (!w) {
    return {
      action: 'pause_insufficient_data',
      confidence: 'low',
      reasonCodes: ['no_earned_weight'],
      note: 'No working weight has been earned for this movement yet.',
      safetyState: 'approved',
      dataLimitations: ['no_lift_history'],
    };
  }
  if (w.dailyAdj < 0) {
    return {
      action: 'reduce_load',
      confidence: 'high',
      reasonCodes: ['eased_for_recovery'],
      note: w.note,
      safetyState: 'approved',
      dataLimitations: [],
    };
  }
  return {
    action: 'hold',
    confidence: 'high',
    reasonCodes: ['at_earned_weight'],
    note: w.note,
    safetyState: 'approved',
    dataLimitations: [],
  };
}

/**
 * Explains an already-computed conditioning prescription. Read-only: never
 * recomputes or alters `p` — it only reshapes it into the adaptive-decision contract.
 */
export function explainConPrescription(p: Prescription): TrainingDecisionExplanation {
  if (p.dailyAdj < 0) {
    return {
      action: 'reduce_volume',
      confidence: 'high',
      reasonCodes: ['eased_for_recovery'],
      note: p.note,
      safetyState: 'approved',
      dataLimitations: [],
    };
  }
  const noRecoveryData = p.rec == null;
  return {
    action: 'hold',
    confidence: noRecoveryData ? 'low' : 'high',
    reasonCodes: [p.level > 0 ? 'at_earned_level' : 'baseline_format'],
    note: p.note,
    safetyState: 'approved',
    dataLimitations: noRecoveryData ? ['no_recovery_data'] : [],
  };
}
