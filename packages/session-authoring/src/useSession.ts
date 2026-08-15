import { useCallback, useMemo, useRef, useState } from 'react';
import type { LoadContext, Session } from '@hybrid/engine';
import { initialRun, reduce, type Action, type RunState } from './machine';
import { sessionView, type SessionView } from './view';

/** `session` and `run` move together, atomically, or not at all. */
interface State {
  session: Session;
  run: RunState;
}

/**
 * The one piece of this package that is not pure.
 *
 * It holds the session and the run state, and re-derives the view when either
 * moves. Every decision it appears to make is `reduce`'s; this is glue, and it
 * is deliberately thin enough that `apps/web` and `apps/mobile` can each render
 * their own screens on it without either owning any of the logic.
 *
 * `session` and `run` are kept in ONE `useState`, not two. Two separate pieces
 * of state cannot move atomically from an updater: React (strict mode, or a
 * fast double-dispatch) can invoke a `setSession` updater more than once for
 * one commit, and a `setRun` call nested inside it — the shape sketched for
 * this hook — is a side effect performed from inside that updater. Run twice,
 * it reduces the SAME action against the SAME starting run twice, and the
 * second `setRun` clobbers the first with a stale answer: `run` and `session`
 * fall out of sync with each other and with the actions actually applied.
 * Folding both into one state value with a single pure updater removes the
 * side effect entirely — `reduce` is deterministic, so calling the updater
 * twice with the same starting state yields the same next state both times,
 * which is exactly what strict mode's double-invocation is designed to prove
 * safe.
 */
export function useSession(initial: Session, ctx: LoadContext = {}) {
  const [state, setState] = useState<State>(() => ({ session: initial, run: initialRun(initial, ctx) }));

  /*
   * `ctx` is read through a ref, not closed over by `dispatch`.
   *
   * It is the athlete's history — sessions, banked weights, today's recovery —
   * and the caller rebuilds that object on most renders. Putting it in the
   * dependency array would give `dispatch` a new identity every time, and
   * every screen holding it in a `useCallback` would re-render with it. Held
   * in a ref, `dispatch` stays stable for the life of the hook and still reads
   * the CURRENT history whenever an action fires, which is what matters: the
   * weight offered for the next set has to reflect the recovery reading that
   * arrived mid-session, not the one that was there when the screen mounted.
   */
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const dispatch = useCallback((action: Action) => {
    setState((prev) => {
      const { session, run } = reduce(prev.session, prev.run, action, ctxRef.current);
      return { session, run };
    });
  }, []);

  const view: SessionView = useMemo(() => sessionView(state.session, state.run, ctx), [state, ctx]);
  // `session` is exposed alongside the view because an app has to persist the
  // session; the alternative is a second state machine mirroring this one in
  // the screen. `SessionView` has no `session` key of its own, so this spread
  // order cannot shadow anything.
  return { ...view, session: state.session, dispatch };
}
