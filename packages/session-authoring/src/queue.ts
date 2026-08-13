import { isWarmup, type Exercise, type LoggedSet, type StrengthBlock } from '@hybrid/engine';

/** One working set's address inside a block. */
export interface QueueItem {
  exerciseIndex: number;
  setIndex: number;
}

/** How many rounds the block has: the longest exercise decides. */
export function roundCount(block: StrengthBlock<LoggedSet>): number {
  return block.exercises.reduce((n, ex) => Math.max(n, ex.sets.length), 0);
}

/**
 * Which movement leads round `round`, as indices into `block.exercises`.
 *
 * Falls back to storage order, which is what every round of an unreordered
 * block uses and what every session logged before reordering existed will have.
 */
export function orderFor(block: StrengthBlock<LoggedSet>, round: number): number[] {
  const recorded = block.roundOrder && block.roundOrder[round];
  if (recorded && recorded.length === block.exercises.length) return recorded;
  return block.exercises.map((_, i) => i);
}

/**
 * Every working set in the block, in the order it is meant to be performed.
 *
 * Round-major: a superset alternates its pair each round rather than finishing
 * one movement before starting the other. An exercise with fewer sets simply
 * stops appearing — the others keep their places rather than sliding up, so
 * "round 4" means the same thing to both movements.
 *
 * Warm-up sets are not in the queue. They are real work the athlete performs,
 * but they are not the sets the session is counting, and nothing in a warm-up
 * may reach a working weight.
 */
export function blockQueue(block: StrengthBlock<LoggedSet>): QueueItem[] {
  const out: QueueItem[] = [];
  const rounds = roundCount(block);
  for (let round = 0; round < rounds; round++) {
    for (const exerciseIndex of orderFor(block, round)) {
      const ex: Exercise<LoggedSet> | undefined = block.exercises[exerciseIndex];
      const st = ex && ex.sets[round];
      if (!st || isWarmup(st)) continue;
      out.push({ exerciseIndex, setIndex: round });
    }
  }
  return out;
}

/**
 * The set the athlete is on: the first in the queue that is not done.
 *
 * A skipped set is still owed, so this returns to it rather than running past —
 * skipping is "not now", not "never", and the block is not finished while one
 * is outstanding.
 */
export function nextUp(block: StrengthBlock<LoggedSet>): QueueItem | null {
  for (const item of blockQueue(block)) {
    const st = block.exercises[item.exerciseIndex].sets[item.setIndex];
    if (!st.done) return item;
  }
  return null;
}
