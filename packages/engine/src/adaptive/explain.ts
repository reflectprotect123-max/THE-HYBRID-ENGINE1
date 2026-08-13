import type { Prescription, CondResult } from '../types';
import type { WorkingWeight } from '../lift';
import type { AdaptResult } from '../conditioning';
import { isProgressedFmt } from '../conditioning';
import type { TrainingDecisionExplanation } from './types';

/**
 * Explains an already-computed working-weight offer. Read-only: never
 * recomputes or alters `w` — it only reshapes it into the adaptive-decision
 * contract.
 */
export function explainWorkingWeight(w: WorkingWeight | null, rec?: number | null): TrainingDecisionExplanation {
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
  const noRecoveryData = rec === undefined || rec === null;
  return {
    action: 'hold',
    confidence: noRecoveryData ? 'low' : 'high',
    reasonCodes: ['at_earned_weight'],
    note: w.note || 'At your earned working weight.',
    safetyState: 'approved',
    dataLimitations: noRecoveryData ? ['no_recovery_data'] : [],
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
    note: p.note || 'Baseline session — nothing earned for this format yet.',
    safetyState: 'approved',
    dataLimitations: noRecoveryData ? ['no_recovery_data'] : [],
  };
}

/**
 * Explains an already-computed conditioning-adaptation result. Never
 * recomputes `conAdapt`'s own gates — see the Task 4 design note in
 * docs/superpowers/plans/2026-08-01-adaptive-training-phase0.md.
 */
export function explainConAdapt(rec: CondResult | null | undefined, result: AdaptResult): TrainingDecisionExplanation {
  if (result.delta > 0) {
    return {
      action: 'progress_load',
      confidence: 'high',
      reasonCodes: ['conditioning_level_progressed'],
      note: 'Conditioning level progressed after an on-target session.',
      safetyState: 'approved',
      dataLimitations: [],
    };
  }
  if (result.delta < 0) {
    return {
      action: 'deload',
      confidence: 'high',
      reasonCodes: ['conditioning_level_deloaded'],
      note: 'Conditioning level eased back after repeated missed sessions.',
      safetyState: 'approved',
      dataLimitations: [],
    };
  }
  if (!rec || rec.sim) {
    return {
      action: 'hold',
      confidence: 'low',
      reasonCodes: ['conditioning_session_excluded'],
      note: 'This session does not count toward conditioning progression.',
      safetyState: 'approved',
      dataLimitations: ['simulated_or_missing_session'],
    };
  }
  if (!rec.fmt || !isProgressedFmt(rec.fmt)) {
    return {
      action: 'hold',
      confidence: 'high',
      reasonCodes: ['conditioning_session_excluded'],
      note: 'This format does not carry earned progression.',
      safetyState: 'approved',
      dataLimitations: [],
    };
  }
  const z = rec.zsec || { low: 0, mod: 0, high: 0 };
  const zoned = (z.low || 0) + (z.mod || 0) + (z.high || 0);
  if (zoned <= 0) {
    return {
      action: 'hold',
      confidence: 'low',
      reasonCodes: ['conditioning_no_hr_data'],
      note: 'No heart-rate zone data was captured, so this session neither earns nor costs progression.',
      safetyState: 'approved',
      dataLimitations: ['no_device_data'],
    };
  }
  return {
    action: 'hold',
    confidence: 'medium',
    reasonCodes: ['conditioning_level_held'],
    note: 'Conditioning level held at its current stage.',
    safetyState: 'approved',
    dataLimitations: [],
  };
}
