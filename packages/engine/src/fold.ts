/**
 * The coaching rule: what should the next set weigh.
 *
 * This is the ONE owner of that question. It replaced (and deleted)
 * `autoreg.computeSetAdjustment`, which judged a single set against its own
 * target and moved off the last weight lifted. The difference was not a tuning
 * change: that rule had no memory, so a hard set followed by an easy one
 * wandered, and an opener entered heavy stayed the reference forever.
 *
 * This rule is plan-anchored. It reads the exercise's first planned set as the
 * anchor, prices every other planned set off that anchor, and then applies one
 * multiplier accumulated from how the session has actually gone.
 */

import { isWarmup, repFloorOf, rpeCenterOf } from './autoreg';
import { AUTOREG } from './constants';
import { roundToIncrement, saneKg } from './num';
import type { Exercise, LoggedSet } from './types';

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

export interface FoldInput {
  targets: PlanTarget[];
  logs: FoldLog[];
  /** Set 1's weight, as the athlete entered it. 0 for bodyweight. */
  opener: number;
  /** Smallest load step this exercise's equipment allows. */
  increment: number;
}

export interface FoldResult {
  setIndex: number;
  target: PlanTarget;
  kg: number;
  message: string;
}

/**
 * What the next set should weigh, and the one line explaining it.
 *
 * Returns null when the exercise is finished. The message is part of the
 * contract, not decoration: the parity gate asserts on it, because a number
 * with no reason attached is what athletes override.
 */
export function foldExercise({ targets, logs, opener, increment }: FoldInput): FoldResult | null {
  const setIndex = logs.length;
  if (setIndex >= targets.length) return null;

  const target = targets[setIndex];
  const inc = increment > 0 ? increment : 1;

  if (!(opener > 0)) return { setIndex, target, kg: 0, message: 'bodyweight' };
  if (setIndex === 0) {
    return { setIndex, target, kg: opener, message: 'opener — everything works from here' };
  }

  const state = walkLogs(logs);
  const anchor = anchorFor(opener, targets[0]);

  if (target.reps === 'max') {
    // A max set is not priced off the plan — it is set 1's weight, minus any
    // back-off the session has earned, so the athlete arrives fresh enough to
    // make the rep count mean something.
    const base = logs[0] ? logs[0].kg : opener;
    const ground = state.last != null && state.last.felt >= state.last.target.rpe + 1;
    const kg = roundToIncrement(base * (state.locked ? state.adj : 1) * (ground ? 0.95 : 1), inc);
    return {
      setIndex,
      target,
      kg,
      message:
        kg < base
          ? 'set 1 minus the back-off — arrive fresh'
          : 'back to set 1’s weight — count the reps',
    };
  }

  const planned = plannedKg(anchor, target);
  let want = planned * state.adj;
  // One easy set may nudge by at most a single increment, however generous the
  // rating was. The rest of the correction waits for a second easy set.
  if (!state.locked && state.easyRun === 1) want = Math.min(want, planned + inc);

  const kg = roundToIncrement(want, inc);
  const plan = roundToIncrement(planned, inc);
  const last = state.last;

  let message: string;
  if (state.locked && kg < plan && last) {
    message = `backed off — your ${last.reps} @ ${last.felt} was harder than asked`;
  } else if (kg === plan && state.easyRun >= 1) {
    message =
      Math.abs(want - planned) < inc && inc >= 2
        ? `holding — the next jump is ${inc} kg, chase clean reps instead`
        : 'holding — one easy set is not evidence yet';
  } else if (kg > plan) {
    message =
      state.easyRun >= 2
        ? 'two easy sets — full correction'
        : `one jump up — your ${last?.reps} @ ${last?.felt} was easy`;
  } else {
    message = 'on plan';
  }

  return { setIndex, target, kg, message };
}

/** A planned set's rep target, read out of its free-text `t`. */
function targetRepsOf(t: string | undefined): number | 'max' {
  if (/max/i.test(t || '')) return 'max';
  const floor = repFloorOf(t);
  return floor > 0 ? floor : 8;
}

/**
 * Read an engine exercise into the fold's terms: the planned targets, the sets
 * actually logged so far, and the opener.
 *
 * Warm-up sets are dropped before anything else happens — they are real work
 * the athlete performs, but they must never reach a working weight. That rule
 * belongs here, once, rather than at each call site. Null when the exercise
 * has no working sets at all.
 */
function readExercise(
  ex: Exercise<LoggedSet>,
): { targets: PlanTarget[]; logs: FoldLog[]; opener: number } | null {
  const working = ex.sets.filter((st) => !isWarmup(st));
  if (!working.length) return null;

  const targets: PlanTarget[] = working.map((st) => ({
    reps: targetRepsOf(st.t),
    rpe: rpeCenterOf(st),
  }));

  const logs: FoldLog[] = [];
  for (let i = 0; i < working.length; i++) {
    const st = working[i];
    if (!st.done) break;
    const reps = parseInt(String(st.aVal2), 10) || 0;
    const felt = parseFloat(String(st.felt));
    if (!(reps > 0) || !Number.isFinite(felt)) break;
    logs.push({ reps, kg: saneKg(st.aVal), felt, target: targets[i] });
  }

  const opener = logs.length ? logs[0].kg : saneKg(working[0].aVal);
  return { targets, logs, opener };
}

/**
 * The increment to price THIS exercise's next step by.
 *
 * `ex.inc` when the movement carries one, the global `AUTOREG.plateIncrement`
 * otherwise. One reader, so no caller has to remember the fallback and no two
 * callers can disagree about it.
 */
export function incrementFor(ex: Pick<Exercise<LoggedSet>, 'inc'>): number {
  return ex.inc && ex.inc > 0 ? ex.inc : AUTOREG.plateIncrement;
}

/**
 * Run the fold over an engine exercise.
 */
export function foldFromExercise(
  ex: Exercise<LoggedSet>,
  increment: number,
): FoldResult | null {
  const read = readExercise(ex);
  if (!read) return null;
  return foldExercise({ ...read, increment });
}


/**
 * What the NEXT session should open this exercise at.
 *
 * The sibling of `foldExercise`, answering a different question: that one
 * prices the next set INSIDE a session and goes null when the session is
 * finished; this one runs exactly then. `liftMoves` banks its answer.
 *
 * Same walk, same lock, same one-easy-set cap — applied to the opener the
 * athlete actually chose rather than to a planned set.
 */
export function foldNextOpener(
  ex: Exercise<LoggedSet>,
  increment: number,
): { kg: number; message: string } | null {
  const read = readExercise(ex);
  if (!read || !read.logs.length) return null;
  const opener = read.logs[0].kg;
  if (!(opener > 0)) return null;

  const s = walkLogs(read.logs);
  const inc = increment > 0 ? increment : 1;
  let want = opener * s.adj;
  if (!s.locked && s.easyRun === 1) want = Math.min(want, opener + inc);
  const kg = roundToIncrement(want, inc);

  let message: string;
  if (s.locked && kg < opener) message = 'backed off — harder than asked';
  else if (kg > opener)
    message = s.easyRun >= 2 ? 'two easy sets — full correction' : 'one easy set — one jump';
  else message = 'hold — open here again';
  return { kg, message };
}
