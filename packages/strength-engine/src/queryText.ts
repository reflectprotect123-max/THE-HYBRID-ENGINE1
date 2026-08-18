import type { Exercise } from './exercise';
import type { StrengthExposure } from './exposure';
import type { CalibrationState } from './calibration';

/**
 * Turns structured athlete state into the text a future decision call would
 * embed and search against. Deliberately terse and templated, not free
 * prose — the same athlete state must always produce the same query
 * (reproducibility, same discipline as the e1RM `formula` field carrying
 * its own provenance).
 */
export function progressionQueryText(exercise: Exercise, exposures: StrengthExposure[], calibration: CalibrationState): string {
  // Defensive: same reasoning as anchorKgFor/decideProgression in
  // progression.ts — nothing enforces that an arbitrary caller's exposures
  // arrive oldest-first.
  const sorted = [...exposures].sort((a, b) => a.performedAt.localeCompare(b.performedAt));
  const recent = sorted.slice(-3).map(e =>
    e.painFlagged ? `${e.exposureClass} (pain flagged)` : e.exposureClass
  ).join(', ');
  return `${exercise.name}: calibration=${calibration}, recent exposures: ${recent}`;
}
