// packages/strength-engine/src/progression.ts
import { calibrationStateFor } from './calibration';
import type { StrengthExposure } from './exposure';

export interface ProgressionDecision {
  exerciseId: string;
  action: 'progress' | 'hold' | 'deload' | 'retest';
  deltaPct?: number;
  confidence: number;
  source: 'deterministic' | 'ai_retrieval';
  reasonCodes: string[];
}

export interface DecideCtx {
  exerciseId: string;
}

/**
 * The seam: both this deterministic implementation and a future AI-backed
 * one (on hold — see docs/superpowers/specs/2026-08-17-adaptive-engine-v2-design.md,
 * "build-order note") satisfy this same interface, interchangeably.
 */
export interface ProgressionDecider {
  decide(exposures: StrengthExposure[], ctx: DecideCtx): ProgressionDecision;
}

/**
 * The most recent load the athlete actually SUCCEEDED at — the anchor a
 * deload is measured from. A deload must never be cut from a load a MISSED
 * set already walked down within-session: an athlete who opened at 100kg
 * and missed down to 94kg is still anchored at 100, not 94, or the athlete
 * is charged twice for one miss. `null` is a real, held state — the caller
 * must not fall back to the most recent (missed) weight.
 */
export function anchorKgFor(exposures: StrengthExposure[]): number | null {
  for (let i = exposures.length - 1; i >= 0; i--) {
    const e = exposures[i];
    if (e.exposureClass === 'successful' || e.exposureClass === 'successful_but_uncertain') return e.loadKg;
  }
  return null;
}

function base(ctx: DecideCtx): Pick<ProgressionDecision, 'exerciseId' | 'source'> {
  return { exerciseId: ctx.exerciseId, source: 'deterministic' };
}

export function decideProgression(exposures: StrengthExposure[], ctx: DecideCtx): ProgressionDecision {
  const calibration = calibrationStateFor(exposures);
  if (calibration !== 'calibrated') {
    return { ...base(ctx), action: 'hold', confidence: 0.3, reasonCodes: ['insufficient_exposure'] };
  }

  const recent = exposures.slice(-3);
  const allSuccessful = recent.every(e => e.exposureClass === 'successful' || e.exposureClass === 'successful_but_uncertain');
  const repeatedDeterioration = recent.filter(e => e.exposureClass === 'missed').length >= 2;
  const anchor = anchorKgFor(exposures);

  if (allSuccessful) {
    return { ...base(ctx), action: 'progress', deltaPct: 0.025, confidence: 0.9, reasonCodes: ['three_on_target'] };
  }
  if (repeatedDeterioration && anchor != null) {
    return { ...base(ctx), action: 'deload', deltaPct: -0.05, confidence: 0.85, reasonCodes: ['repeated_deterioration'] };
  }
  // repeatedDeterioration with no anchor (every exposure missed, nothing to
  // deload FROM) deliberately falls through to hold, same reason code as
  // any other mixed signal — there is no meaningful distinction from the
  // caller's side between "signals conflict" and "signals agree on deload
  // but there is nothing to anchor it to".
  return { ...base(ctx), action: 'hold', confidence: 0.7, reasonCodes: ['mixed_signal'] };
}

export const DeterministicDecider: ProgressionDecider = {
  decide: decideProgression,
};
