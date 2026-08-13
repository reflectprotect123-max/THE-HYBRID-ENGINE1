import { useEffect } from 'react';
import type { Action, BlockView, HotSet, RestState } from '@hybrid/session-authoring';
import { Button, cx } from '../../ui';

/*
 * The screen while the athlete waits between sets.
 *
 * `RestState.kind` is the one fact this file must never blur: `'set'` is a
 * real clock, `'block'` is the page turning between blocks with nothing to
 * count down (`total: 0`). The prototype (`rolling-logger.html`'s
 * `renderRest`) originally drew a spent `0:00` dial on a block turn and it
 * read as a timer that had run out rather than as a block ending — fixed
 * there, and the fix is the point of this file: a `'block'` turn renders no
 * dial at all.
 *
 * No decision logic lives here. `rest`, `hot`, `blocks` and `blockIndex` are
 * `useSession`'s own view, read and formatted, never recomputed — the
 * "what's next" line is `view.hot`/`view.draft` for a timed rest (already
 * the UPCOMING set, because `logSet` advances the hook's `hot` before the
 * rest ever renders) and the next `BlockView.title` for a block turn.
 */

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

export function RestTakeover({
  rest,
  hot,
  draftKg,
  blocks,
  blockIndex,
  dispatch,
}: {
  rest: RestState;
  /** The upcoming set — `view.hot`, already advanced past the set just logged. */
  hot: HotSet | null;
  /** The upcoming set's prefilled weight — `view.draft`'s own `kg`, not recomputed. */
  draftKg: number | null;
  blocks: BlockView[];
  blockIndex: number;
  dispatch: (action: Action) => void;
}) {
  const timed = rest.kind === 'set';
  const nextBlock = blocks[blockIndex + 1] ?? null;

  // The countdown's one and only owner: mounted only while a rest is up
  // (the parent renders this component solely off `view.rest`), so the
  // interval starts and stops with it — nothing else in this app dispatches
  // `tick`. A page turn (`total: 0`) has no clock, so it is spared the
  // dispatch entirely rather than sent a no-op every second.
  useEffect(() => {
    if (!timed) return;
    const id = window.setInterval(() => dispatch({ type: 'tick' }), 1000);
    return () => window.clearInterval(id);
  }, [timed, dispatch]);

  const frac = rest.total > 0 ? Math.max(0, Math.min(1, rest.left / rest.total)) : 0;

  const leave = () => {
    if (rest.kind === 'block') {
      if (nextBlock) dispatch({ type: 'goToBlock', index: blockIndex + 1 });
      else dispatch({ type: 'dismissRest' });
      return;
    }
    dispatch({ type: 'dismissRest' });
  };

  const extend = () => dispatch({ type: 'extendRest', seconds: 15 });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Resting"
      className="fixed inset-0 z-30 flex flex-col items-center justify-center gap-1 bg-[rgba(7,7,6,0.97)] p-3 text-center backdrop-blur-md"
    >
      <span className="font-mono text-1 tracking-[.16em] text-dim uppercase">{timed ? 'rest' : 'block done'}</span>

      {timed ? (
        <div
          data-parity="rest-dial"
          className="relative my-1.5 grid h-[210px] w-[210px] place-items-center rounded-full"
          style={{
            background: `conic-gradient(var(--color-gold2, var(--gold2)) calc(${frac} * 1turn), var(--color-line, var(--line)) 0)`,
          }}
        >
          <div className="absolute inset-[5px] rounded-full bg-[rgba(7,7,6,0.97)]" />
          <b className="num relative font-mono text-[52px] font-[750] tracking-[-.02em] text-gold2">
            {fmt(Math.max(0, rest.left))}
          </b>
        </div>
      ) : (
        <div className="h-[18px]" />
      )}

      {timed && hot ? (
        <div className="min-w-[260px] rounded-2xl border border-gold-line bg-panel px-2 py-1.5">
          <div className="font-mono text-1 tracking-[.14em] text-dim uppercase">up next</div>
          <div className="mt-0.25 text-4 font-[700]">{hot.exerciseName}</div>
          <div className="num mt-0.5 font-mono text-7 font-[750] text-gold2">
            {draftKg ? `${draftKg} kg × ` : ''}
            {hot.planned.reps}
          </div>
          <div className="mt-0.5 font-mono text-1 text-gold">{hot.message}</div>
        </div>
      ) : null}

      {!timed ? (
        <div className="min-w-[260px] rounded-2xl border border-gold-line bg-panel px-2 py-1.5">
          <div className="font-mono text-1 tracking-[.14em] text-dim uppercase">next block</div>
          <div className="mt-0.25 text-4 font-[700]">{nextBlock ? nextBlock.title : 'Session done'}</div>
        </div>
      ) : null}

      <div className="mt-2.5 flex gap-1.5">
        {timed && rest.left > 0 ? (
          <Button variant="ghost" onClick={extend}>
            +15
          </Button>
        ) : null}
        <Button
          data-parity="rest-go"
          variant="brass"
          className={cx(!timed && !nextBlock && 'min-w-[120px]')}
          onClick={leave}
        >
          {rest.kind === 'block' ? (nextBlock ? 'Go' : 'Finish') : rest.left > 0 ? 'Skip' : 'Lift'}
        </Button>
      </div>
    </div>
  );
}
