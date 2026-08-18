import type { StrengthExposure } from './exposure';

export type CalibrationState = 'calibrated' | 'building' | 'uncalibrated';

const MIN_EXPOSURES = 3;

export function calibrationStateFor(exposures: StrengthExposure[]): CalibrationState {
  const usable = exposures.filter(e => e.exposureClass !== 'pain_blocked');
  if (usable.length === 0) return 'uncalibrated';
  return usable.length >= MIN_EXPOSURES ? 'calibrated' : 'building';
}
