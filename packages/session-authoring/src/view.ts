import {
  AUTOREG,
  foldFromExercise,
  isCond,
  isText,
  isWarmup,
  type Block,
  type LoggedSet,
  type Session,
  type StrengthBlock,
} from '@hybrid/engine';
import type { Draft } from './draft';
import { nextUp, orderFor, roundCount, type QueueItem } from './queue';
import type { RunState } from './machine';
import type { RestState } from './rest';

/*
 * Everything a screen needs to draw a session, derived and held nowhere.
 *
 * `sessionView` owns no state of its own — call it again with a new
 * `session`/`run` and it answers fresh. It decides nothing about coaching:
 * the live set's message comes verbatim from `@hybrid/engine`'s
 * `foldFromExercise`, because that fold is the one and only owner of the
 * coaching rule and this package is forbidden from re-deriving it.
 */

/** How far along one block is, in working sets — warm-up sets never count. */
export interface BlockProgress {
  done: number;
  total: number;
}

/** One row on the block list. */
export interface BlockView {
  id: string;
  title: string;
  progress: BlockProgress;
}

export type SetStatus = 'done' | 'live' | 'upcoming';

/** One set's place in its round, as the screen should draw it. */
export interface RoundSet {
  exerciseIndex: number;
  setIndex: number;
  exerciseName: string;
  status: SetStatus;
}

/** A round of the block currently being run, in the order it will run in. */
export interface RoundView {
  round: number;
  sets: RoundSet[];
}

/** The set in front of the athlete right now, and the coaching rule's word on it. */
export interface HotSet {
  exerciseIndex: number;
  setIndex: number;
  exerciseName: string;
  /** Verbatim from `foldFromExercise` — never composed here. */
  message: string;
}

export interface SessionView {
  blocks: BlockView[];
  rounds: RoundView[];
  hot: HotSet | null;
  rest: RestState | null;
  draft: Draft | null;
  finished: boolean;
}

function isStrengthBlock(b: Block<LoggedSet>): b is StrengthBlock<LoggedSet> {
  return !isCond(b) && !isText(b);
}

/** A superset's paired names read as "Press + Raise"; a solo block is just its name. */
function blockTitle(block: Block<LoggedSet>): string {
  if (isCond(block)) return block.heading || 'Conditioning';
  if (isText(block)) return block.heading || 'Notes';
  return block.exercises.map((ex) => ex.name).join(' + ');
}

/** Working sets only: a warm-up sitting alongside real work must not inflate this. */
function blockProgress(block: Block<LoggedSet>): BlockProgress {
  if (isCond(block)) return { done: block.condResult ? 1 : 0, total: 1 };
  if (isText(block)) return { done: block.done ? 1 : 0, total: 1 };
  let done = 0;
  let total = 0;
  for (const ex of block.exercises) {
    for (const st of ex.sets) {
      if (isWarmup(st)) continue;
      total += 1;
      if (st.done) done += 1;
    }
  }
  return { done, total };
}

/** Every round of the block, in the order it will actually run, with each set's status. */
function buildRounds(block: StrengthBlock<LoggedSet>, hotItem: QueueItem | null): RoundView[] {
  const rounds: RoundView[] = [];
  const total = roundCount(block);
  for (let round = 0; round < total; round++) {
    const sets: RoundSet[] = [];
    for (const exerciseIndex of orderFor(block, round)) {
      const ex = block.exercises[exerciseIndex];
      const st = ex && ex.sets[round];
      if (!st || isWarmup(st)) continue;
      const live = !!hotItem && hotItem.exerciseIndex === exerciseIndex && hotItem.setIndex === round;
      sets.push({
        exerciseIndex,
        setIndex: round,
        exerciseName: ex.name,
        status: st.done ? 'done' : live ? 'live' : 'upcoming',
      });
    }
    rounds.push({ round, sets });
  }
  return rounds;
}

/**
 * Derive the whole screen from state.
 *
 * A finished session has nothing owed and nothing live: `hot`, `rest`, and
 * `draft` all go null once `session.status` says 'completed', even if the
 * run state underneath was not itself reset.
 */
export function sessionView(session: Session, run: RunState): SessionView {
  const finished = session.status === 'completed';
  const blocks = session.blocks.map((b) => ({ id: b.id, title: blockTitle(b), progress: blockProgress(b) }));

  const current = session.blocks[run.blockIndex];
  const strengthBlock = current && isStrengthBlock(current) ? current : null;

  const hotItem = !finished && strengthBlock ? nextUp(strengthBlock) : null;
  const rounds = strengthBlock ? buildRounds(strengthBlock, hotItem) : [];

  let hot: HotSet | null = null;
  if (hotItem && strengthBlock) {
    const ex = strengthBlock.exercises[hotItem.exerciseIndex];
    const folded = foldFromExercise(ex, AUTOREG.plateIncrement);
    if (folded) {
      hot = {
        exerciseIndex: hotItem.exerciseIndex,
        setIndex: hotItem.setIndex,
        exerciseName: ex.name,
        message: folded.message,
      };
    }
  }

  return {
    blocks,
    rounds,
    hot,
    rest: finished ? null : run.rest,
    draft: finished ? null : run.draft,
    finished,
  };
}
