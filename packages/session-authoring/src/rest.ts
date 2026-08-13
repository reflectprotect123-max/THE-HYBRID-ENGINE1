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
}

/** What follows the set just logged. */
export function restAfter(block: StrengthBlock<LoggedSet>, item: QueueItem): RestState | null {
  if (!nextUp(block)) return { left: 0, total: 0, kind: 'block' };
  const rest = block.exercises[item.exerciseIndex].rest || 0;
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
