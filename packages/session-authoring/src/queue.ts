import { isWarmup, isWarmupBlock, type Exercise, type LoggedSet, type StrengthBlock } from '@hybrid/engine';

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
 * Every item in the block, round-major, whatever kind of block it is.
 *
 * A superset alternates its pair each round rather than finishing one
 * movement before starting the other. An exercise with fewer sets simply
 * stops appearing — the others keep their places rather than sliding up, so
 * "round 4" means the same thing to both movements.
 *
 * A per-set `W`-marked ramp (`isWarmup`) is never in here: it is real work
 * the athlete performs, but it is not a set either queue below is allowed to
 * count. `blockQueue` and `pieceQueue` are this same traversal, filtered by
 * which kind of block is allowed to use it — see their own docs for why the
 * split exists.
 */
function itemsInOrder(block: StrengthBlock<LoggedSet>): QueueItem[] {
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
 * Every working set in the block, in the order it is meant to be performed.
 *
 * A `warmup: true` block is prep, not work (`isWarmupBlock`, `@hybrid/engine`'s
 * own doc on `StrengthBlock.warmup`): it never appears here, empty rather than
 * merely reordered. This is the ONE gate every coaching-facing consumer in this
 * package sits behind — `nextUp` below feeds `view.ts`'s `hot` (which folds
 * through `@hybrid/engine`'s coaching rule) and `machine.ts`'s `draftFor`
 * (which opens a draft, coaching weight included, against whatever `nextUp`
 * returns). Neither of those files re-checks `warmup` itself; they inherit the
 * exclusion from here, so a prep block can never reach the fold no matter which
 * of those two paths gets there first. A prep block's own sequencing runs
 * through `pieceQueue`/`nextPiece` instead, which never touches either.
 */
export function blockQueue(block: StrengthBlock<LoggedSet>): QueueItem[] {
  if (isWarmupBlock(block)) return [];
  return itemsInOrder(block);
}

/**
 * Every piece in a prep block, in the order it is performed — `blockQueue`'s
 * mirror image. Empty for anything that is not a `warmup: true` block, so a
 * working block can never be driven through the piece path either and the
 * two queues stay exhaustive and disjoint over every block kind.
 */
export function pieceQueue(block: StrengthBlock<LoggedSet>): QueueItem[] {
  if (!isWarmupBlock(block)) return [];
  return itemsInOrder(block);
}

/** The first item in `queue` that is not yet done, or null if none is owed.
 *
 * A skipped item is still owed, so this returns to it rather than running
 * past — skipping is "not now", not "never", and the block is not finished
 * while one is outstanding. */
function firstNotDone(block: StrengthBlock<LoggedSet>, queue: QueueItem[]): QueueItem | null {
  for (const item of queue) {
    const st = block.exercises[item.exerciseIndex].sets[item.setIndex];
    if (!st.done) return item;
  }
  return null;
}

/** The working set the athlete is on. Null for a prep block — see `blockQueue`. */
export function nextUp(block: StrengthBlock<LoggedSet>): QueueItem | null {
  return firstNotDone(block, blockQueue(block));
}

/** The piece the athlete is on. Null for anything but a prep block — see `pieceQueue`. */
export function nextPiece(block: StrengthBlock<LoggedSet>): QueueItem | null {
  return firstNotDone(block, pieceQueue(block));
}
