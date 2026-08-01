import type { SetAdjustment } from '../types';
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
