import { measurementValue } from './performed';
import type { PerformedSetWithMeasurements } from './performed';

export type ExposureClass = 'successful' | 'successful_but_uncertain' | 'missed' | 'pain_blocked';

export interface ResolvedSetTarget {
  targetReps?: number;
  targetLoadKg?: number;
}

export interface StrengthExposure {
  exerciseId: string;
  assignedSessionId: string;
  reps: number;
  loadKg: number;
  rated: boolean;
  painFlagged: boolean;
  onTarget: boolean;
  exposureClass: ExposureClass;
  performedSetId: string;
  performedAt: string;
}

/**
 * One exposure per SESSION for this exercise, not per set — a product
 * decision (18 August 2026): "3 exposures" means 3 separate workout days,
 * not 3 sets in one workout. Performed sets for this exercise are grouped by
 * `assignedSessionId`, and within each session the chronologically LAST set
 * (by `performedAt`) stands in as that session's representative exposure,
 * regardless of its `status` — a session where every set for this exercise
 * was skipped or missed must still produce a `missed` exposure, not vanish
 * silently.
 *
 * The spec asked for "the last COMPLETED, non-warmup set" as the
 * representative. `PerformedSet` carries no warmup marker on today's schema,
 * so this implementation takes the last set chronologically per session —
 * the practical, documented simplification, not a warmup-aware selection —
 * and does not require the representative set to be `completed` (see above).
 *
 * A representative set with no `load` measurement at all is not strength
 * evidence and is skipped, mirroring `strengthExposuresFor`'s deleted
 * predecessor's `lastWorkingSet` selection rule.
 */
export function strengthExposuresFor(
  exerciseId: string,
  performed: PerformedSetWithMeasurements[],
  resolvedTargets: Record<string, ResolvedSetTarget> = {},
): StrengthExposure[] {
  const relevant = performed.filter(p => p.exerciseId === exerciseId);

  const bySession = new Map<string, PerformedSetWithMeasurements[]>();
  for (const set of relevant) {
    const bucket = bySession.get(set.assignedSessionId);
    if (bucket) bucket.push(set);
    else bySession.set(set.assignedSessionId, [set]);
  }

  const exposures: StrengthExposure[] = [];

  for (const [assignedSessionId, sets] of bySession) {
    const representative = [...sets].sort((a, b) => a.performedAt.localeCompare(b.performedAt)).at(-1)!;

    const loadKg = measurementValue(representative, 'load');
    if (loadKg == null) continue;
    const reps = measurementValue(representative, 'reps') ?? 0;
    const rated = measurementValue(representative, 'rpe') != null;
    const painFlagged = measurementValue(representative, 'pain') != null;

    // pain_blocked outranks everything else — a set can be both a miss and
    // pain-flagged, and "missed" would feed a real injury signal into
    // load-progression math instead of excluding it entirely.
    let exposureClass: ExposureClass;
    if (painFlagged) exposureClass = 'pain_blocked';
    else if (representative.status !== 'completed') exposureClass = 'missed';
    else exposureClass = rated ? 'successful' : 'successful_but_uncertain';

    // onTarget: did the athlete hit the prescribed stimulus (reps and load),
    // not merely complete the set. An athlete-added set (no prescribedSetId)
    // or one whose target was not supplied/resolvable defaults to true — you
    // cannot fail a target you don't know.
    const target = representative.prescribedSetId != null ? resolvedTargets[representative.prescribedSetId] : undefined;
    const onTarget = target == null
      ? true
      : (target.targetReps == null || reps >= target.targetReps) &&
        (target.targetLoadKg == null || loadKg >= target.targetLoadKg);

    exposures.push({
      exerciseId,
      assignedSessionId,
      reps,
      loadKg,
      rated,
      painFlagged,
      onTarget,
      exposureClass,
      performedSetId: representative.id,
      performedAt: representative.performedAt,
    });
  }

  return exposures.sort((a, b) => a.performedAt.localeCompare(b.performedAt));
}
