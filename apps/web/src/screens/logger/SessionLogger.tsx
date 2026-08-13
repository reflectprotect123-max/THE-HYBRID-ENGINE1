import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { isCond, isText, type Session, type StrengthBlock, type LoggedSet } from '@hybrid/engine';
import { useSession, type Action, type SessionView } from '@hybrid/session-authoring';
import { useDb } from '../../store/db';
import { useRest } from '../../store/rest';
import { requestWakeLock, releaseWakeLock } from '../../native/wakeLock';
import { Button, Card } from '../../ui';
import { BlockStrip } from './BlockStrip';
import { BlockScreen } from './BlockScreen';
import { RestTakeover } from './RestTakeover';
import { FinishCard } from './FinishCard';

/*
 * The screen shell for `@hybrid/session-authoring`'s `useSession`.
 *
 * The hook owns every decision about running a session — which set is live,
 * what it should weigh, what order a superset runs in. This file owns none
 * of that. What it owns is the wiring the hook cannot own itself: writing
 * the session back to the app's store, holding the screen awake, and
 * bridging the hook's own rest model onto the store that actually fires the
 * rest-complete Notification and drives the global `RestChip`.
 *
 * The block strip (`BlockStrip`) and the current block's rounds
 * (`BlockScreen`) are Task 3, rendered below. The rest takeover
 * (`RestTakeover`) is Task 5, rendered whenever `view.rest` is up.
 *
 * `FinishCard` (Task 6) renders once, prepended to the LAST block's screen,
 * the moment every block's working sets are logged — the same rule the
 * prototype's `finishHtml()` uses (`i === session.blocks.length - 1`), and
 * read the same way here: off `view.blocks`' own `progress`, never off a
 * `finished`/`status` flag, because nothing in this package or the machine
 * ever dispatches `finish` today. See the task report.
 */

/**
 * Wire `useSession` to this app's side effects.
 *
 * `useSession` hands back a derived VIEW — `blockIndex`, `blocks`, `rounds`,
 * `hot`, `rest`, `draft`, `finished` — plus the concrete `Session` it holds
 * inside. This
 * shell renders the view and persists the session; it duplicates no part of
 * `useSession`'s own state machine to get one.
 */
export function useLoggerBridge(
  initial: Session,
  updateSession: (id: string, fn: (s: Session) => void | false) => void,
  startRest: (seconds: number) => void,
  stopRest: () => void,
  addRest: (seconds: number) => void,
): { view: SessionView; dispatch: (action: Action) => void; session: Session } {
  const { dispatch, session, ...view } = useSession(initial);

  // Persist: write-through on change, matching the old Logger's cadence at
  // its `updateSession` call sites — not a new debounce, not every
  // keystroke. `reduce` returns the SAME session reference when an action
  // changes nothing, `setDraft` included, so a draft being typed never
  // reaches here: only an action that actually logged, rotated, added or
  // finished a set produces a new reference and a write.
  const lastPersisted = useRef(initial);
  useEffect(() => {
    if (session === lastPersisted.current) return;
    lastPersisted.current = session;
    updateSession(session.id, (ds) => {
      Object.assign(ds, session);
      ds.updatedAt = Date.now();
    });
  }, [session, updateSession]);

  // Bridge rest to the store that actually owns the notification and the
  // chip. A `'set'` rest arms it with the same seconds the hook is about to
  // paint; a `'block'` page turn is not a rest and must never arm it. Only
  // an armed-by-us timer is ever cleared here — an unrelated rest already
  // running in the store (a reload mid-rest, say) is left alone until this
  // screen itself puts one up.
  //
  // Keyed on `armedByUs`, a flag, not on `view.rest`'s object identity. Once
  // the countdown ticks (Task 5), `tickRest` returns a NEW `RestState` every
  // second — same rest, new reference — so an identity-keyed effect would
  // call `startRest` again on every tick and restart the store's own timer
  // once a second, and the athlete's rest-complete notification would never
  // land on time. The flag only flips on a genuine transition: unarmed to
  // armed (a fresh `'set'` rest, always preceded by `rest` going back to
  // `null` — `dismissRest`/`goToBlock` before the next `logSet`, so a
  // `'block'` turn can never be mistaken for the same armed rest) or armed
  // to unarmed (the rest clears). A tick that only lowers `left` — same
  // `kind`, same `total` — changes neither. Growing `total` while still
  // armed (`extendRest`, the +15) is not a new rest either: it is relayed to
  // the store's own `add` so the background timer that fires the
  // Notification stays in step with the dial this screen paints.
  const armedByUs = useRef(false);
  const armedTotal = useRef(0);
  useEffect(() => {
    const rest = view.rest;
    if (rest && rest.kind === 'set') {
      if (!armedByUs.current) {
        armedByUs.current = true;
        armedTotal.current = rest.total;
        startRest(rest.total);
      } else if (rest.total !== armedTotal.current) {
        addRest(rest.total - armedTotal.current);
        armedTotal.current = rest.total;
      }
    } else if (armedByUs.current) {
      armedByUs.current = false;
      stopRest();
    }
  }, [view.rest, startRest, stopRest, addRest]);

  return { view, dispatch, session };
}

/** Keep the screen awake for the life of this component — ported from
 *  `Logger.tsx`'s wake-lock effect verbatim; ownership of "is there a
 *  session running" already lives one level up, in whether this component
 *  is mounted at all. */
function useWakeLock() {
  useEffect(() => {
    let cancelled = false;
    let lock: WakeLockSentinel | null = null;
    requestWakeLock().then((l) => {
      if (cancelled) {
        l?.release();
        return;
      }
      lock = l;
    });
    return () => {
      cancelled = true;
      releaseWakeLock(lock);
    };
  }, []);
}

function NoLiveSession() {
  const nav = useNavigate();
  return (
    <div className="grid min-h-full place-items-center p-3">
      <Card className="text-center">
        <p className="text-6 font-[750]">No live session</p>
        <p className="mt-1 text-4 text-muted">Start one from Training.</p>
        <Button className="mt-2" variant="brass" onClick={() => nav('/training')}>
          Go to Training
        </Button>
      </Card>
    </div>
  );
}

/** A `Block` that is not a `StrengthBlock` has no rounds to log — the same
 *  guard `@hybrid/session-authoring`'s `view.ts` applies internally, mirrored
 *  here because the view exposes only the current block's `rounds`, never
 *  the block itself. */
function isStrengthBlock(b: Session['blocks'][number]): b is StrengthBlock<LoggedSet> {
  return !isCond(b) && !isText(b);
}

function RunningSession({ session: initialSession }: { session: Session }) {
  const { updateSession } = useDb();
  const { start: startRest, stop: stopRest, add: addRest } = useRest();
  const { view, dispatch, session } = useLoggerBridge(initialSession, updateSession, startRest, stopRest, addRest);
  useWakeLock();

  // `view.blockIndex` is the hook's own `run.blockIndex`, surfaced — the
  // single source `goToBlock` moves. Nothing here mirrors it into local
  // state, so there is no second copy of "which block is on screen" that
  // could drift from what the hook is actually showing.
  const goToBlock = useCallback((index: number) => dispatch({ type: 'goToBlock', index }), [dispatch]);
  const rotate = useCallback((blockId: string) => dispatch({ type: 'rotate', blockId }), [dispatch]);

  const currentBlock = session.blocks[view.blockIndex];
  const strengthBlock = currentBlock && isStrengthBlock(currentBlock) ? currentBlock : null;
  const currentTitle = view.blocks[view.blockIndex]?.title ?? '';

  // Every block's working sets logged — `BlockProgress`, the package's own
  // tally, summed rather than recomputed. Shown only on the last block's
  // screen, mirroring the prototype's own placement for the same receipt.
  const allDone = view.blocks.length > 0 && view.blocks.every((b) => b.progress.done >= b.progress.total);
  const onLastBlock = view.blockIndex === view.blocks.length - 1;
  const setsLogged = view.blocks.reduce((n, b) => n + b.progress.done, 0);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[560px] flex-col px-2 pt-2 pb-3">
      <BlockStrip blocks={view.blocks} currentIndex={view.blockIndex} onSelect={goToBlock} />
      {allDone && onLastBlock ? (
        <FinishCard blocks={view.blocks.length} setsLogged={setsLogged} bestE1rm={null} />
      ) : null}
      {strengthBlock ? (
        <BlockScreen
          block={strengthBlock}
          title={currentTitle}
          rounds={view.rounds}
          onRotate={rotate}
          hot={view.hot}
          draft={view.draft}
          dispatch={dispatch}
        />
      ) : null}
      {view.rest ? (
        <RestTakeover
          rest={view.rest}
          hot={view.hot}
          draftKg={view.draft?.kg ?? null}
          blocks={view.blocks}
          blockIndex={view.blockIndex}
          dispatch={dispatch}
        />
      ) : null}
    </div>
  );
}

export function SessionLogger() {
  const { activeSession } = useDb();

  if (!activeSession) return <NoLiveSession />;

  // Remounted whenever a DIFFERENT session becomes active — a fresh run, not
  // a mutation of the one already on screen — so the hook's state, and this
  // shell's mirror of it, always start from the session actually meant to be
  // running.
  return <RunningSession key={activeSession.id} session={activeSession} />;
}
