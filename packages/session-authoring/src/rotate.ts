import type { LoggedSet, StrengthBlock } from '@hybrid/engine';
import { orderFor, roundCount } from './queue';

/** Has any movement logged its set for this round yet? */
export function roundStarted(block: StrengthBlock<LoggedSet>, round: number): boolean {
  return block.exercises.some((ex) => !!ex.sets[round] && !!ex.sets[round].done);
}

/**
 * Move the pair round by one, from here on.
 *
 * The bench is taken, so you do the other movement first. That is a change of
 * plan, not a rewrite of the session: a round already underway keeps the order
 * it actually ran in, and only rounds that have not begun take the new order.
 * The old order is written down explicitly for those started rounds at the
 * moment of rotation, because "absent means storage order" would otherwise
 * silently reinterpret them.
 *
 * A rotation rather than a swap, so a triset cycles instead of only its first
 * two movements trading places.
 */
export function rotateBlock(block: StrengthBlock<LoggedSet>): StrengthBlock<LoggedSet> {
  if (block.exercises.length < 2) return block;

  const roundOrder: Record<number, number[]> = { ...(block.roundOrder || {}) };
  const rounds = roundCount(block);
  const current = orderFor(block, rounds > 0 ? rounds - 1 : 0);
  const rotated = current.slice(1).concat(current[0]);

  for (let round = 0; round < rounds; round++) {
    roundOrder[round] = roundStarted(block, round) ? orderFor(block, round) : rotated;
  }

  return { ...block, roundOrder };
}
