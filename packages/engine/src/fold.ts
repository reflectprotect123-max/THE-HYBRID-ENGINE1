/**
 * The coaching rule: what should the next set weigh.
 *
 * This is the ONE owner of that question. It exists to replace
 * `autoreg.computeSetAdjustment`, which judges a single set against its own
 * target and moves off the last weight lifted. The difference is not a tuning
 * change: that rule has no memory, so a hard set followed by an easy one
 * wanders, and an opener entered heavy stays the reference forever.
 *
 * This rule is plan-anchored. It reads the exercise's first planned set as the
 * anchor, prices every other planned set off that anchor, and then applies one
 * multiplier accumulated from how the session has actually gone.
 */

/** Reps-to-failure cap. Above this the Epley estimate stops meaning anything. */
export const RTF_CAP = 12;

/** Epley's divisor. */
const EPLEY_DIV = 30;

/** The most one exercise's adjustment may move on a single set, either way. */
export const MAX_STEP_PCT = 7.5;

/**
 * How many reps the athlete had left, by their own rating. An RPE of 10 is
 * failure, so the shortfall from 10 is reps in reserve.
 */
export function repsToFailure(reps: number, rpe: number): number {
  return Math.min(RTF_CAP, reps + (10 - rpe));
}

/** Estimated one-rep max for a set, via Epley over reps-to-failure. */
export function e1rmOf(kg: number, reps: number, rpe: number): number {
  return kg * (1 + repsToFailure(reps, rpe) / EPLEY_DIV);
}

/**
 * Percent of load one RPE point is worth, by rep range. A triple moves further
 * per point than a set of twelve, because the load-per-rep curve is steeper
 * where the reps are few.
 */
export function kFor(reps: number): number {
  if (reps <= 3) return 3;
  if (reps <= 7) return 2.5;
  return 2;
}

/** Hold one adjustment inside the step ceiling, in both directions. */
export function clampPct(pct: number): number {
  return Math.max(-MAX_STEP_PCT, Math.min(MAX_STEP_PCT, pct));
}
