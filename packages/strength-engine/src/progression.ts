// packages/strength-engine/src/progression.ts
import { calibrationStateFor } from './calibration';
import type { CalibrationState } from './calibration';
import type { StrengthExposure } from './exposure';

export interface ProgressionDecision {
  exerciseId: string;
  action: 'progress' | 'hold' | 'deload' | 'retest';
  deltaPct?: number;
  deltaKg?: number;
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
 * "build-order note") satisfy this same interface, interchangeably. `decide`
 * is async and takes the caller's already-computed `CalibrationState`
 * explicitly, so an AI-backed decider can use it without recomputing it.
 */
export interface ProgressionDecider {
  decide(exposures: StrengthExposure[], calibration: CalibrationState, ctx: DecideCtx): Promise<ProgressionDecision>;
}

/**
 * The most recent load the athlete actually SUCCEEDED at — the anchor a
 * deload is measured from. A deload must never be cut from a load a MISSED
 * set already walked down within-session: an athlete who opened at 100kg
 * and missed down to 94kg is still anchored at 100, not 94, or the athlete
 * is charged twice for one miss. `null` is a real, held state — the caller
 * must not fall back to the most recent (missed) weight.
 *
 * Sorts its own defensive copy oldest-first by `performedAt` — callers may
 * pass an already-sorted list (as `strengthExposuresFor` guarantees), but
 * nothing enforces that for a caller who filters or concatenates two lists.
 */
export function anchorKgFor(exposures: StrengthExposure[]): number | null {
  const sorted = [...exposures].sort((a, b) => a.performedAt.localeCompare(b.performedAt));
  for (let i = sorted.length - 1; i >= 0; i--) {
    const e = sorted[i];
    if (e.exposureClass === 'successful' || e.exposureClass === 'successful_but_uncertain') return e.loadKg;
  }
  return null;
}

function base(ctx: DecideCtx): Pick<ProgressionDecision, 'exerciseId' | 'source'> {
  return { exerciseId: ctx.exerciseId, source: 'deterministic' };
}

export function decideProgression(exposures: StrengthExposure[], ctx: DecideCtx): ProgressionDecision {
  // Defensive: same reasoning as anchorKgFor above — nothing enforces that
  // an arbitrary caller's exposures arrive oldest-first.
  const sorted = [...exposures].sort((a, b) => a.performedAt.localeCompare(b.performedAt));

  const calibration = calibrationStateFor(sorted);
  if (calibration !== 'calibrated') {
    return { ...base(ctx), action: 'hold', confidence: 0.3, reasonCodes: ['insufficient_exposure'] };
  }

  const recent = sorted.slice(-3);
  // Both the exposure class AND onTarget are required: a RATED session
  // (exposureClass === 'successful') that fell short of the prescribed
  // stimulus is not full evidence of readiness to progress, and neither is
  // an on-target but unrated (successful_but_uncertain) session on its own.
  const allSuccessful = recent.every(e => e.exposureClass === 'successful' && e.onTarget);
  const repeatedDeterioration = recent.filter(e => e.exposureClass === 'missed').length >= 2;
  const anchor = anchorKgFor(sorted);

  if (allSuccessful) {
    const deltaPct = 0.025;
    return {
      ...base(ctx), action: 'progress', deltaPct, confidence: 0.9, reasonCodes: ['three_on_target'],
      ...(anchor != null ? { deltaKg: anchor * deltaPct } : {}),
    };
  }
  if (repeatedDeterioration && anchor != null) {
    const deltaPct = -0.05;
    return {
      ...base(ctx), action: 'deload', deltaPct, confidence: 0.85, reasonCodes: ['repeated_deterioration'],
      deltaKg: anchor * deltaPct,
    };
  }
  // repeatedDeterioration with no anchor (every exposure missed, nothing to
  // deload FROM) deliberately falls through to hold, same reason code as
  // any other mixed signal — there is no meaningful distinction from the
  // caller's side between "signals conflict" and "signals agree on deload
  // but there is nothing to anchor it to".
  return { ...base(ctx), action: 'hold', confidence: 0.7, reasonCodes: ['mixed_signal'] };
}

export const DeterministicDecider: ProgressionDecider = {
  async decide(exposures, _calibration, ctx) {
    // _calibration is intentionally unused here — decideProgression computes
    // its own via calibrationStateFor. The interface still accepts it so a
    // real AI decider, given the caller's already-computed calibration, can
    // use it without recomputing.
    return decideProgression(exposures, ctx);
  },
};
