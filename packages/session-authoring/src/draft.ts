import { foldFromExercise, incrementFor, repFloorOf, type LoggedSet, type StrengthBlock } from '@hybrid/engine';
import type { QueueItem } from './queue';

/** What the athlete is entering for the set in front of them. */
export interface Draft {
  kg: number;
  reps: number;
  /** How hard it was. Null until they say — never guessed. */
  felt: number | null;
}

/**
 * Open the entry for a set.
 *
 * The weight comes from `@hybrid/engine`'s coaching rule, not from anything
 * here — this package does not decide loads. Reps open at what was planned, so
 * the ordinary case is one tap; a `max` set opens at zero, because counting
 * them is the entire point of it and a prefilled number would be answered for
 * the athlete.
 */
export function openDraft(block: StrengthBlock<LoggedSet>, item: QueueItem): Draft {
  const ex = block.exercises[item.exerciseIndex];
  const st = ex.sets[item.setIndex];
  const folded = foldFromExercise(ex, incrementFor(ex));
  const isMax = /max/i.test(st.t || '');
  return {
    kg: folded ? folded.kg : 0,
    reps: isMax ? 0 : repFloorOf(st.t),
    felt: null,
  };
}

/** A draft can be logged once it has reps and a rating. Weight may be zero. */
export function draftReady(draft: Draft): boolean {
  return draft.reps > 0 && draft.felt != null;
}

/**
 * Write a draft onto its set.
 *
 * `t` and `rpe` are left exactly as they were: they are what was ASKED for, and
 * the coaching rule judges the performance against them. Overwriting the plan
 * with what happened would score every set as perfect and the weight would
 * never move.
 */
export function applyDraft(
  block: StrengthBlock<LoggedSet>,
  item: QueueItem,
  draft: Draft,
): StrengthBlock<LoggedSet> {
  return {
    ...block,
    exercises: block.exercises.map((ex, ei) =>
      ei !== item.exerciseIndex
        ? ex
        : {
            ...ex,
            sets: ex.sets.map((st, si) =>
              si !== item.setIndex
                ? st
                : {
                    ...st,
                    aVal: String(draft.kg),
                    aVal2: String(draft.reps),
                    felt: draft.felt == null ? st.felt : String(draft.felt),
                    done: true,
                  },
            ),
          },
    ),
  };
}
