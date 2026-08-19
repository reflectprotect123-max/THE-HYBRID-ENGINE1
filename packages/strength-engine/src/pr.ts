/** One row of `pr_event` (see supabase/migrations/20260818_strength_rebuild.sql):
 * PRs are per rep-count, not collapsed — the table's own comment and its
 * primary key `(athlete_id, exercise_id, rep_count, achieved_at)` both say so. */
export interface PrEvent {
  exerciseId: string;
  repCount: number;
  valueKg: number;
  achievedAt: string;
  performedSetId: string;
}

/**
 * Whether `newSet` beats every prior PR at the SAME exercise and the SAME rep
 * count. `reps` keys the comparison because that is the design (`pr_event` is
 * per rep-count): a 3RM and a 5RM are different records, and a heavier triple
 * must never be judged against a five's history.
 *
 * A set with `reps <= 0` is a failed or empty attempt — load that was loaded
 * but never lifted — and can never register as a PR at any weight.
 */
export function detectPr(
  newSet: { exerciseId: string; reps: number; loadKg: number },
  priorEvents: PrEvent[],
): boolean {
  if (newSet.reps <= 0) return false;
  const priorBest = priorEvents
    .filter(e => e.exerciseId === newSet.exerciseId && e.repCount === newSet.reps)
    .reduce<number | null>((best, e) => (best == null || e.valueKg > best ? e.valueKg : best), null);
  return priorBest == null || newSet.loadKg > priorBest;
}
