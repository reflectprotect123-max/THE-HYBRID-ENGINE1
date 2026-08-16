import { isCond, isText, isWarmupBlock, repFloorOf, type LoadContext, type LoggedSet, type Session, type StrengthBlock } from '@hybrid/engine';
import { openDraft, applyDraft, draftReady, type Draft } from './draft';
import { blockQueue, nextPiece, nextUp, type QueueItem } from './queue';
import { rotateBlock } from './rotate';
import { restAfter, tickRest, extendRest, type RestState } from './rest';

/*
 * The reducer that runs a session.
 *
 * Every action the athlete can take passes through `reduce`, in one pure
 * place, so the web app and the mobile app agree on the rules exactly. It
 * owns none of the coaching logic — draft/rest/queue/rotate already decide
 * what to prefill, how long to rest, and what order things run in. This
 * file only sequences those decisions against an action.
 */

/** Where the run is right now, on top of the session it is running. */
export interface RunState {
  blockIndex: number;
  draft: Draft | null;
  rest: RestState | null;
  /**
   * Seconds the current set has been open, counted by `tick`.
   *
   * Only EMOM pacing needs it — `Exercise.every` measures from when a set
   * STARTS, so the rest owed afterwards is the window minus whatever the set
   * itself used. Plain `rest` ignores it entirely. Reset by every action that
   * begins a new set: logging one, skipping one, changing block.
   *
   * A `tick` while a rest is running advances the REST, not this, so a long
   * rest cannot eat the next set's window before that set has begun.
   */
  sinceSet: number;
}

export type Action =
  | { type: 'setDraft'; patch: Partial<Draft> }
  | { type: 'logSet' }
  | { type: 'completePiece' }
  | { type: 'rotate'; blockId: string }
  | { type: 'skipSet' }
  | { type: 'addSet' }
  | { type: 'goToBlock'; index: number }
  | { type: 'tick' }
  | { type: 'extendRest'; seconds: number }
  | { type: 'dismissRest' }
  | { type: 'finish' };

/** A `Block` that is not a `StrengthBlock` has no queue: nothing to draft, log or skip. */
function strengthBlockAt(session: Session, blockIndex: number): StrengthBlock<LoggedSet> | null {
  const b = session.blocks[blockIndex];
  if (!b || isCond(b) || isText(b)) return null;
  return b as StrengthBlock<LoggedSet>;
}

/** Draft open for the current item of the current block, or null if there is none owed. */
function draftFor(session: Session, blockIndex: number, ctx: LoadContext): Draft | null {
  const block = strengthBlockAt(session, blockIndex);
  if (!block) return null;
  const item = nextUp(block);
  return item ? openDraft(block, item, ctx) : null;
}

/**
 * The first block, with its first owed set drafted and no rest running.
 *
 * `ctx` is the athlete's history — banked weights, past sessions, today's
 * recovery. It is passed through to `openDraft` untouched; this file reads
 * none of it and decides nothing from it. Optional, and its absence means the
 * fold alone: see `openDraft` for why that default is the safe one.
 */
export function initialRun(session: Session, ctx: LoadContext = {}): RunState {
  return { blockIndex: 0, draft: draftFor(session, 0, ctx), rest: null, sinceSet: 0 };
}

/** Rebuild the session with one block replaced. */
function withBlock(session: Session, blockIndex: number, block: StrengthBlock<LoggedSet>): Session {
  return {
    ...session,
    blocks: session.blocks.map((b, i) => (i === blockIndex ? block : b)),
  };
}

export function reduce(
  session: Session,
  run: RunState,
  action: Action,
  ctx: LoadContext = {},
): { session: Session; run: RunState } {
  switch (action.type) {
    case 'setDraft': {
      if (!run.draft) return { session, run };
      return { session, run: { ...run, draft: { ...run.draft, ...action.patch } } };
    }

    case 'logSet': {
      const block = strengthBlockAt(session, run.blockIndex);
      if (!block || !run.draft || !draftReady(run.draft)) return { session, run };
      const item = nextUp(block);
      if (!item) return { session, run };
      const logged = applyDraft(block, item, run.draft);
      const nextSession = withBlock(session, run.blockIndex, logged);
      const rest = restAfter(logged, item, run.sinceSet);
      const nextItem = nextUp(logged);
      const draft = nextItem ? openDraft(logged, nextItem, ctx) : null;
      return { session: nextSession, run: { ...run, draft, rest, sinceSet: 0 } };
    }

    // A prep piece is not a rated set — it never gives a `felt`, and writing
    // one anyway (the app's old workaround, a fabricated `felt: 0`) would be
    // evidence the athlete never gave (`deviationFelt`'s own doc, engine's
    // autoreg.ts). This action marks the piece done and records the one
    // thing it DOES have — the authored target, `seconds` for a timed piece
    // or the rep target for a rep piece, both taken from `t` the same way
    // `openDraft`/`repFloorOf` already read it — and leaves `felt` untouched.
    case 'completePiece': {
      const block = strengthBlockAt(session, run.blockIndex);
      if (!block || !isWarmupBlock(block)) return { session, run };
      const item = nextPiece(block);
      if (!item) return { session, run };
      const ex = block.exercises[item.exerciseIndex];
      const st = ex.sets[item.setIndex];
      const recorded = ex.mode === 'seconds' ? String(parseInt(st.t, 10) || 0) : String(repFloorOf(st.t));
      const completed: StrengthBlock<LoggedSet> = {
        ...block,
        exercises: block.exercises.map((e, ei) =>
          ei !== item.exerciseIndex
            ? e
            : {
                ...e,
                sets: e.sets.map((s, si) => (si !== item.setIndex ? s : { ...s, aVal: recorded, done: true })),
              },
        ),
      };
      const nextSession = withBlock(session, run.blockIndex, completed);
      /*
       * The last piece ends the block, and the block ending has to be SAID.
       *
       * `restAfter` is no use here: it is written against `nextUp`, which is
       * empty for a prep block by design, so asking it would return a page
       * turn after every piece rather than after the last one. `nextPiece` is
       * the prep block's own queue and is the honest question.
       *
       * A prep block never opens a timed rest — a piece is not a set and
       * carries no rest — so the only thing that can follow it is the page
       * turn. Without this, finishing a warm-up left the athlete on a
       * finished block with nothing on screen saying so and no way forward,
       * which is what the parity harness caught: the driver went looking for
       * `rest-go` and found nothing there.
       */
      const rest = nextPiece(completed) ? run.rest : { left: 0, total: 0, kind: 'block' as const };
      return { session: nextSession, run: { ...run, rest } };
    }

    case 'rotate': {
      const idx = session.blocks.findIndex((b) => b.id === action.blockId);
      if (idx < 0) return { session, run };
      const block = strengthBlockAt(session, idx);
      if (!block) return { session, run };
      const rotated = rotateBlock(block);
      const nextSession = withBlock(session, idx, rotated);
      const draft = idx === run.blockIndex ? draftFor(nextSession, run.blockIndex, ctx) : run.draft;
      return { session: nextSession, run: { ...run, draft } };
    }

    case 'skipSet': {
      // "Not now" rather than "never": the set itself is never touched, so it
      // is still the first thing `nextUp` will return once the athlete comes
      // back around to it. Only the draft moves on, to whatever is next in
      // the block's fixed queue order.
      const block = strengthBlockAt(session, run.blockIndex);
      if (!block) return { session, run };
      const item = nextUp(block);
      if (!item) return { session, run };
      const following = itemAfter(block, item);
      const draft = following ? openDraft(block, following, ctx) : null;
      /* A different set is now open, so its window starts here. */
      return { session, run: { ...run, draft, sinceSet: 0 } };
    }

    case 'addSet': {
      const block = strengthBlockAt(session, run.blockIndex);
      if (!block) return { session, run };
      const item = nextUp(block) || lastOwedTarget(block);
      if (!item) return { session, run };
      const ex = block.exercises[item.exerciseIndex];
      const last = ex.sets[ex.sets.length - 1];
      if (!last) return { session, run };
      const appended: StrengthBlock<LoggedSet> = {
        ...block,
        exercises: block.exercises.map((e, ei) =>
          ei !== item.exerciseIndex ? e : { ...e, sets: [...e.sets, { t: last.t, rpe: last.rpe }] },
        ),
      };
      const nextSession = withBlock(session, run.blockIndex, appended);
      return { session: nextSession, run };
    }

    case 'goToBlock': {
      if (action.index < 0 || action.index >= session.blocks.length) return { session, run };
      /*
       * ENTERING A BLOCK IS STAMPED, so the recap can say how long each part
       * took. See `Session.blockLog` for why this is a wall-clock stamp and
       * not a stopwatch, and why it is a list — an athlete going back to an
       * earlier block opens a second segment for it rather than overwriting
       * the first.
       *
       * The second impure edge in this package, alongside `finish`, and for
       * the same unavoidable reason: the moment a thing happened is not
       * derivable from the state it happened to.
       *
       * Re-selecting the block already open stamps NOTHING. The athlete has
       * not gone anywhere, and a stamp there would end the current segment and
       * start an identical one — harmless to the arithmetic, but it would fill
       * the log with entries describing a move nobody made.
       */
      const sameBlock = action.index === run.blockIndex;
      const target = session.blocks[action.index];
      const stamped: Session =
        sameBlock || !target?.id
          ? session
          : { ...session, blockLog: [...(session.blockLog ?? []), { id: target.id, at: Date.now() }] };
      return {
        session: stamped,
        run: { ...run, blockIndex: action.index, draft: draftFor(stamped, action.index, ctx), rest: null, sinceSet: 0 },
      };
    }

    case 'tick': {
      /*
       * WITH NO REST RUNNING, A TICK IS THE SET'S OWN CLOCK.
       *
       * It used to be ignored outright, because the only thing that counted
       * seconds was a rest. EMOM pacing needs the other half: `Exercise.every`
       * measures from when a set starts, so `restAfter` has to be told how
       * much of the window the set consumed. Ticking here and nowhere else
       * keeps that in one place, and keeps the reducer pure — the caller
       * decides when a second has passed, exactly as it already did for rest.
       */
      if (!run.rest) return { session, run: { ...run, sinceSet: run.sinceSet + 1 } };
      // A 'set' rest that has already hit zero clears itself on the tick
      // that finds it spent; a 'block' page-turn (total 0) is untouched by
      // `tickRest` and stands until the athlete dismisses it.
      if (run.rest.kind === 'set' && run.rest.left <= 0) {
        return { session, run: { ...run, rest: null } };
      }
      return { session, run: { ...run, rest: tickRest(run.rest) } };
    }

    case 'extendRest': {
      if (!run.rest) return { session, run };
      return { session, run: { ...run, rest: extendRest(run.rest, action.seconds) } };
    }

    case 'dismissRest': {
      if (!run.rest) return { session, run };
      return { session, run: { ...run, rest: null } };
    }

    case 'finish': {
      // The one impure edge in this package: `finish` stamps wall-clock time.
      return { session: { ...session, status: 'completed', completedAt: Date.now() }, run };
    }

    default:
      return { session, run };
  }
}

/** Whichever item comes after `item` in the block's fixed queue order. */
function itemAfter(block: StrengthBlock<LoggedSet>, item: QueueItem): QueueItem | null {
  const queue = blockQueue(block);
  const idx = queue.findIndex((q) => q.exerciseIndex === item.exerciseIndex && q.setIndex === item.setIndex);
  return idx >= 0 && idx + 1 < queue.length ? queue[idx + 1] : null;
}

/** Fallback target for `addSet` when the block has no set left owed: its last exercise. */
function lastOwedTarget(block: StrengthBlock<LoggedSet>): QueueItem | null {
  const exerciseIndex = block.exercises.length - 1;
  if (exerciseIndex < 0) return null;
  const ex = block.exercises[exerciseIndex];
  return ex.sets.length ? { exerciseIndex, setIndex: ex.sets.length - 1 } : null;
}
