import { measurementValue } from './performed';
import type { PerformedSetWithMeasurements } from './performed';

export type ExposureClass = 'successful' | 'successful_but_uncertain' | 'missed' | 'pain_blocked';

export interface StrengthExposure {
  exerciseId: string;
  reps: number;
  loadKg: number;
  rated: boolean;
  painFlagged: boolean;
  exposureClass: ExposureClass;
  performedSetId: string;
  performedAt: string;
}

/**
 * One exposure per performed_set for this exercise that carries a real load
 * measurement — sets with no `load` measurement (e.g. pure-bodyweight or
 * cardio-adjacent work) are not strength evidence and are skipped entirely,
 * mirroring `strengthExposuresFor`'s deleted predecessor's `lastWorkingSet`
 * selection rule.
 */
export function strengthExposuresFor(exerciseId: string, performed: PerformedSetWithMeasurements[]): StrengthExposure[] {
  const relevant = performed.filter(p => p.exerciseId === exerciseId);
  const exposures: StrengthExposure[] = [];

  for (const set of relevant) {
    const loadKg = measurementValue(set, 'load');
    if (loadKg == null) continue;
    const reps = measurementValue(set, 'reps') ?? 0;
    const rated = measurementValue(set, 'rpe') != null;
    const painFlagged = measurementValue(set, 'pain') != null;

    // pain_blocked outranks everything else — a set can be both a miss and
    // pain-flagged, and "missed" would feed a real injury signal into
    // load-progression math instead of excluding it entirely.
    let exposureClass: ExposureClass;
    if (painFlagged) exposureClass = 'pain_blocked';
    else if (set.status !== 'completed') exposureClass = 'missed';
    else exposureClass = rated ? 'successful' : 'successful_but_uncertain';

    exposures.push({ exerciseId, reps, loadKg, rated, painFlagged, exposureClass, performedSetId: set.id, performedAt: set.performedAt });
  }

  return exposures.sort((a, b) => a.performedAt.localeCompare(b.performedAt));
}
