import {
  e1rmOf,
  isCond,
  isText,
  isWarmup,
  isWarmupBlock,
  openingLoadFor,
  saneKg,
  type AnySet,
  type LoadContext,
  type Block,
  type LoggedSet,
  type Session,
  type StrengthBlock,
} from '@hybrid/engine';
import type { Draft } from './draft';
import { nextPiece, nextUp, orderFor, roundCount, type QueueItem } from './queue';
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

/** The target as authored — `t`/`rpe` verbatim, never reparsed by a screen. */
export interface PlannedSetView {
  reps: string;
  rpe: string;
}

/** What was actually recorded, for a set that is done. */
export interface LoggedSetView {
  kg: number;
  reps: number;
  felt: number;
}

/** One set's place in its round, as the screen should draw it. */
export interface RoundSet {
  exerciseIndex: number;
  setIndex: number;
  exerciseName: string;
  status: SetStatus;
  /** The authored target — always present, done or not. */
  planned: PlannedSetView;
  /** The recorded values, or null until the set is done. */
  logged: LoggedSetView | null;
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
  /** The authored target for this set. */
  planned: PlannedSetView;
}

export interface SessionView {
  /** Which block is on screen — the single source `goToBlock` moves. */
  blockIndex: number;
  blocks: BlockView[];
  rounds: RoundView[];
  hot: HotSet | null;
  rest: RestState | null;
  draft: Draft | null;
  finished: boolean;
  /** Best estimated one-rep max across every logged WORKING set in the
   *  session, or null when there is none yet. Prep blocks and `W`-marked
   *  ramps inside a working exercise are excluded — see `bestE1rm`. */
  bestE1rm: number | null;
}

/** The target as authored, verbatim — never reparsed by a screen. */
function plannedOf(st: Pick<AnySet, 't' | 'rpe'>): PlannedSetView {
  return { reps: st.t || '', rpe: st.rpe || '' };
}

/**
 * What got recorded, for a set that is done.
 *
 * `aVal`/`aVal2`/`felt` are parsed here, once, with the same helpers the
 * engine itself judges a set by (`saneKg` for the weight; `parseInt`/
 * `parseFloat` for reps/felt match `lift.ts` and `fold.ts`'s own reads of
 * these fields) — so a screen never has to parse `aVal2` again.
 */
function loggedOf(st: Pick<LoggedSet, 'aVal' | 'aVal2' | 'felt'>): LoggedSetView {
  return {
    kg: saneKg(st.aVal),
    reps: parseInt(String(st.aVal2), 10) || 0,
    felt: parseFloat(String(st.felt)) || 0,
  };
}

function isStrengthBlock(b: Block<LoggedSet>): b is StrengthBlock<LoggedSet> {
  return !isCond(b) && !isText(b);
}

/**
 * A block's own authored title wins.
 *
 * `heading` is where every kind of block keeps one, and a strength block used
 * to be the one kind that ignored it — its title was always its exercise names
 * joined. That is a fine FALLBACK and a poor rule: it renamed the prototype's
 * "Warm-up" to "Row + Air Squats" and its "Squat + Row" to "Barbell Back Squat
 * + Dumbbell Row", so a block strip showed something the athlete never wrote.
 * Found by driving the parity harness, which is exactly what it is for.
 *
 * With no heading, a superset's paired names still read as "Press + Raise" and
 * a solo block is still just its movement.
 */
function blockTitle(block: Block<LoggedSet>): string {
  if (isCond(block)) return block.heading || 'Conditioning';
  if (isText(block)) return block.heading || 'Notes';
  return block.heading || block.exercises.map((ex) => ex.name).join(' + ');
}

/**
 * Working sets only: a warm-up sitting alongside real work must not inflate
 * this. A whole `warmup: true` block contributes nothing at all — 0 of 0 —
 * because none of its pieces are working sets to begin with, the same rule
 * `bestE1rm` applies below.
 */
function blockProgress(block: Block<LoggedSet>): BlockProgress {
  if (isCond(block)) return { done: block.condResult ? 1 : 0, total: 1 };
  if (isText(block)) return { done: block.done ? 1 : 0, total: 1 };
  if (isWarmupBlock(block)) return { done: 0, total: 0 };
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
        planned: plannedOf(st),
        logged: st.done ? loggedOf(st) : null,
      });
    }
    rounds.push({ round, sets });
  }
  return rounds;
}

/**
 * The best estimated one-rep max across every logged working set in the
 * session, or null when there is none.
 *
 * A prep block (`isWarmupBlock`) is skipped whole, and a `W`-marked ramp
 * inside a working exercise is skipped per set (`isWarmup`) — the identical
 * working-set rule `blockProgress` applies, so neither can inflate this any
 * more than it can inflate the progress tally. The estimate itself is
 * `@hybrid/engine`'s own `e1rmOf`, called on the recorded weight, reps, and
 * the athlete's own `felt` rating for that set (the actual difficulty, not
 * the planned `rpe`) — this package derives no lifting arithmetic of its own.
 */
function bestE1rm(session: Session): number | null {
  let best: number | null = null;
  for (const block of session.blocks) {
    if (isCond(block) || isText(block) || isWarmupBlock(block)) continue;
    for (const ex of block.exercises) {
      for (const st of ex.sets) {
        if (!st.done || isWarmup(st)) continue;
        const logged = loggedOf(st);
        if (!(logged.kg > 0) || !(logged.reps > 0) || !(logged.felt > 0)) continue;
        const est = e1rmOf(logged.kg, logged.reps, logged.felt);
        if (best === null || est > best) best = est;
      }
    }
  }
  return best;
}

/**
 * Derive the whole screen from state.
 *
 * A finished session has nothing owed and nothing live: `hot`, `rest`, and
 * `draft` all go null once `session.status` says 'completed', even if the
 * run state underneath was not itself reset.
 *
 * `ctx` is the athlete's history, and it reaches only one thing here: the
 * coaching line beside the live set, which has to be decided by the same
 * ladder that decided that set's weight. Everything else in the view is read
 * off the session in hand.
 *
 * A prep block's live piece never becomes `hot`. `hot` is the coaching
 * rule's word on a set (`openingLoadFor`, `@hybrid/engine`), and a piece
 * has nothing for the fold to judge — warming up with an empty bar must
 * never teach the progression that your bench went to 20kg. The block still
 * needs to know which piece is live, for `rounds`' own `status`, so that
 * comes from `nextPiece` (queue.ts's mirror of `nextUp`, scoped to prep
 * blocks) rather than from `nextUp`/`hot` at all.
 */
export function sessionView(session: Session, run: RunState, ctx: LoadContext = {}): SessionView {
  const finished = session.status === 'completed';
  const blocks = session.blocks.map((b) => ({ id: b.id, title: blockTitle(b), progress: blockProgress(b) }));

  const current = session.blocks[run.blockIndex];
  const strengthBlock = current && isStrengthBlock(current) ? current : null;
  const prep = !!strengthBlock && isWarmupBlock(strengthBlock);

  const liveItem = !finished && strengthBlock ? (prep ? nextPiece(strengthBlock) : nextUp(strengthBlock)) : null;
  const rounds = strengthBlock ? buildRounds(strengthBlock, liveItem) : [];

  let hot: HotSet | null = null;
  if (liveItem && strengthBlock && !prep) {
    const ex = strengthBlock.exercises[liveItem.exerciseIndex];
    /*
     * THE SAME LADDER THE DRAFT'S WEIGHT CAME FROM, asked once more for its
     * word rather than re-derived here.
     *
     * This read `foldFromExercise` directly until 15 August 2026, which was
     * correct only while `openDraft` did too. The moment the weight field
     * started opening at a banked or prescribed number, a line saying
     * "bodyweight" would have been sitting beside 120kg — the exact
     * two-numbers-contradicting-each-other-on-one-card failure this codebase
     * has paid for before. `openingLoadFor` decides both together.
     *
     * Null message means there is nothing to say, not that there is no set:
     * `hot` still renders, because the athlete still has a set in front of
     * them.
     */
    const opening = openingLoadFor(ex, liveItem.setIndex, ctx);
    const st = ex.sets[liveItem.setIndex];
    hot = {
      exerciseIndex: liveItem.exerciseIndex,
      setIndex: liveItem.setIndex,
      exerciseName: ex.name,
      message: opening.message,
      planned: plannedOf(st),
    };
  }

  return {
    blockIndex: run.blockIndex,
    blocks,
    rounds,
    hot,
    rest: finished ? null : run.rest,
    draft: finished ? null : run.draft,
    finished,
    bestE1rm: bestE1rm(session),
  };
}
