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

/**
 * A planned set, reduced to the two numbers the fold needs. `reps: 'max'` is an
 * AMRAP: it has no rep floor to miss and no target load of its own.
 */
export interface PlanTarget {
  reps: number | 'max';
  rpe: number;
}

/**
 * The exercise's reference point: the e1RM implied by set 1's plan at the
 * weight the athlete opened with.
 *
 * Set 1 and not the best set, because the opener is the one number the athlete
 * chose deliberately. Anchoring on the best set would let one good day ratchet
 * the whole exercise upward with no decision behind it.
 */
export function anchorFor(opener: number, first: PlanTarget): number {
  if (!(opener > 0)) return 0;
  const reps = first.reps === 'max' ? RTF_CAP : first.reps;
  return e1rmOf(opener, reps, first.rpe);
}

/**
 * What the plan says this set should weigh, before anything that happened today
 * is taken into account.
 *
 * A `max` set has no reps to price against, so it sits at the anchor and the
 * walk's own back-off rule decides what it actually gets.
 */
export function plannedKg(anchor: number, target: PlanTarget): number {
  if (!(anchor > 0)) return 0;
  if (target.reps === 'max') return anchor;
  return anchor / (1 + repsToFailure(target.reps, target.rpe) / EPLEY_DIV);
}

/** Effective RPE for a set that fell short of its rep floor. */
const MISSED_FLOOR_RPE = 10.5;

/** A set as it was actually performed, with the plan it was performed against. */
export interface FoldLog {
  reps: number;
  kg: number;
  felt: number;
  target: PlanTarget;
}

/** What the walk carries forward. */
export interface WalkState {
  /** Multiplier applied to the planned weight of the next set. */
  adj: number;
  /** Set by an underperformance. Once locked, easy sets no longer raise load. */
  locked: boolean;
  /** Consecutive easy sets immediately before now. */
  easyRun: number;
  /** The last set walked, or null. */
  last: FoldLog | null;
}

/**
 * Fold every set logged so far into one multiplier.
 *
 * Deviation is `asked - felt`: positive means easier than asked, negative means
 * harder. A missed rep floor is scored as `MISSED_FLOOR_RPE` regardless of what
 * the athlete rated it, so a modest rating on a failed set still brings the
 * weight down.
 */
export function walkLogs(logs: FoldLog[]): WalkState {
  const s: WalkState = { adj: 1, locked: false, easyRun: 0, last: null };

  for (const log of logs) {
    s.last = log;
    if (log.target.reps === 'max') continue;

    const floor = log.target.reps;
    const missed = log.reps < floor;
    const effective = missed ? MISSED_FLOOR_RPE : log.felt;
    const dev = log.target.rpe - effective;
    const k = kFor(floor);

    if (dev <= -1) {
      // Harder than asked. Full correction, and the exercise locks.
      s.adj *= 1 + clampPct(k * dev) / 100;
      s.locked = true;
      s.easyRun = 0;
    } else if (dev >= 1) {
      // Easier than asked. Half now; the second consecutive one adds the rest.
      // Nothing rises after a lock.
      if (!s.locked) {
        s.adj *= 1 + clampPct((k * dev) / 2) / 100;
        s.easyRun += 1;
      }
    } else {
      s.easyRun = 0;
    }
  }

  return s;
}
