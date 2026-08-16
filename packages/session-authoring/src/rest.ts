import type { LoggedSet, StrengthBlock } from '@hybrid/engine';
import { nextUp, type QueueItem } from './queue';

/**
 * A rest in progress.
 *
 * `kind: 'block'` with a zero total is not a rest — it is the page turning
 * between blocks. Both travel in the same field because both take the screen
 * over, but a screen that shows a spent 0:00 dial reads as a timer that ran
 * out rather than as a block ending, so they must stay distinguishable.
 */
export interface RestState {
  left: number;
  total: number;
  kind: 'set' | 'block';
  /**
   * This rest is the tail of an EMOM window rather than a rest of its own —
   * `Exercise.every`. The athlete's screen says so, because "1:50 rest" and
   * "next set in 1:50" are different promises: the second one is a deadline,
   * and it did not start when the set ended.
   */
  paced?: boolean;
}

/**
 * What follows the set just logged.
 *
 * TWO CLOCKS, and which one runs is the exercise's own instruction.
 *
 * `rest` starts when the set ENDS: 90 seconds means 90 seconds, whatever the
 * set took. `every` is EMOM pacing and starts when the set STARTED, so the set
 * and its recovery share one window — `elapsed` is how much of that window
 * the set itself consumed, and what is left is the rest. A set that overran
 * its window leaves nothing, and the honest answer there is no rest at all
 * rather than a 0:00 dial: the athlete is already late and the next set is
 * owed now.
 *
 * `every` beats `rest` when both are set, because it is the more specific
 * instruction. See `Exercise.every`.
 */
export function restAfter(
  block: StrengthBlock<LoggedSet>,
  item: QueueItem,
  elapsed = 0,
): RestState | null {
  if (!nextUp(block)) return { left: 0, total: 0, kind: 'block' };
  const ex = block.exercises[item.exerciseIndex];
  const every = ex.every || 0;
  if (every > 0) {
    const left = Math.max(0, every - Math.max(0, elapsed));
    if (left <= 0) return null;
    return { left, total: every, kind: 'set', paced: true };
  }
  const rest = ex.rest || 0;
  if (rest <= 0) return null;
  return { left: rest, total: rest, kind: 'set' };
}

/** One second gone. Floors at zero; a page turn has no clock to advance. */
export function tickRest(rest: RestState): RestState | null {
  if (rest.total <= 0) return rest;
  return { ...rest, left: Math.max(0, rest.left - 1) };
}

/**
 * Give it longer.
 *
 * Both numbers move, so the fraction the dial draws still means "how much of
 * this rest is left" rather than overflowing past full.
 */
export function extendRest(rest: RestState, seconds: number): RestState {
  return { ...rest, left: rest.left + seconds, total: rest.total + seconds };
}
