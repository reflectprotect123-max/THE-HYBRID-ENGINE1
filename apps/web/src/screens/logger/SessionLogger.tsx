import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@hybrid/engine';
import { useSession, type Action, type SessionView } from '@hybrid/session-authoring';
import { useDb } from '../../store/db';
import { useRest } from '../../store/rest';
import { requestWakeLock, releaseWakeLock } from '../../native/wakeLock';
import { Button, Card } from '../../ui';

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
 * The block strip, the current block and the rest takeover are Tasks 3-5.
 * This shell renders their slots and nothing else — no placeholder text, no
 * stub markup, because there is nothing yet to show in them.
 */

/**
 * Wire `useSession` to this app's side effects.
 *
 * `useSession` hands back a derived VIEW — `blocks`, `rounds`, `hot`, `rest`,
 * `draft`, `finished` — plus the concrete `Session` it holds inside. This
 * shell renders the view and persists the session; it duplicates no part of
 * `useSession`'s own state machine to get one.
 */
export function useLoggerBridge(
  initial: Session,
  updateSession: (id: string, fn: (s: Session) => void | false) => void,
  startRest: (seconds: number) => void,
  stopRest: () => void,
): { view: SessionView; dispatch: (action: Action) => void } {
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
  const armedByUs = useRef(false);
  useEffect(() => {
    const rest = view.rest;
    if (rest && rest.kind === 'set') {
      armedByUs.current = true;
      startRest(rest.total);
    } else if (armedByUs.current) {
      armedByUs.current = false;
      stopRest();
    }
  }, [view.rest, startRest, stopRest]);

  return { view, dispatch };
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

function RunningSession({ session }: { session: Session }) {
  const { updateSession } = useDb();
  const { start: startRest, stop: stopRest } = useRest();
  useLoggerBridge(session, updateSession, startRest, stopRest);
  useWakeLock();

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[560px] flex-col px-2 pt-2 pb-3">
      {/* Block strip — Task 3. */}
      {/* Current block (rounds, hot card) — Tasks 3 and 4. */}
      {/* Rest takeover — Task 5. */}
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
