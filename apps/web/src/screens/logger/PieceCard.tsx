import { useEffect, useState } from 'react';
import type { Action, RoundSet } from '@hybrid/session-authoring';
import { cx } from '../../ui';

/*
 * The live piece of a warm-up / cool-down block — the prototype's
 * `renderWarm`'s hot card (`checks/fixtures/prototype/rolling-logger.html`).
 *
 * A piece is a prep movement, not a working set: nothing here may reach a
 * working weight or an e1RM, so unlike `HotCard` this file renders no rating
 * chips and takes no `HotSet` at all — that shape is `@hybrid/engine`'s
 * coaching fold speaking (`view.ts`'s `sessionView` never folds a prep
 * block's piece, so it is never `hot`), and a piece has nothing for the fold
 * to judge. What this file reads is `piece` — the live `RoundSet` off
 * `useSession`'s own `view.rounds`, the same round-major item every other
 * status in the block comes from — for the two fields a piece actually has:
 * its name and its authored target.
 *
 * A `mode: 'seconds'` piece runs a countdown; a `mode: 'reps'` piece is just
 * a target and a Done button. The clock is local to this component on
 * purpose — it is "the per-set timer carried over from the old Logger.tsx"
 * the task brief points at, and it auto-starts the instant this component
 * mounts as the live piece and stops for good the instant it unmounts. A
 * block switch unmounts this card (`BlockScreen` renders pieces only for the
 * block on screen), which is the only "pause" a piece's clock gets: there is
 * no store in scope that would let it resume from the same second later, so
 * coming back to the block restarts the piece at its own full target. See
 * the task report for why a real pause/resume was left out rather than
 * invented here.
 *
 * `finish` dispatches `completePiece` — the reducer action that marks a prep
 * piece done without a rating. Unlike `logSet` (gated on a `felt` that a
 * piece never gives), it writes no `felt` at all: `deviationFelt`'s own doc
 * in `@hybrid/engine`'s autoreg.ts is explicit that an unwritten `felt` means
 * "no evidence", and this file used to fabricate one (`felt: 0`) just to get
 * past that gate. That workaround is gone.
 */

const fmtSecs = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

export function PieceCard({
  piece,
  mode,
  dispatch,
}: {
  /** `useSession`'s view.rounds — the live `RoundSet` for this piece.
   *  `exerciseName` and `planned.reps` (the authored target, verbatim) are
   *  the only fields read. */
  piece: RoundSet;
  /** `block.exercises[piece.exerciseIndex].mode` — only `'seconds'` gets a
   *  clock; every other mode (`'reps'` included) is just a target. */
  mode: string;
  dispatch: (action: Action) => void;
}) {
  const target = parseInt(piece.planned.reps, 10) || 0;
  const timed = mode === 'seconds' && target > 0;

  const [left, setLeft] = useState(target);
  const [running, setRunning] = useState(timed);

  const finish = () => {
    dispatch({ type: 'completePiece' });
  };

  // The clock itself: ticks once a second while running, and only while
  // mounted — unmounting (leaving this block) clears the interval below, so
  // nothing keeps counting down for a piece that is no longer on screen.
  useEffect(() => {
    if (!timed || !running) return;
    const id = window.setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(id);
  }, [timed, running]);

  // Reaching zero finishes the piece on its own, exactly like the prototype's
  // `finishWarm` called from inside `startWarm`'s own interval.
  useEffect(() => {
    if (timed && running && left <= 0) {
      setRunning(false);
      finish();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left]);

  return (
    <div className="my-1 rounded-lg border border-gold-line bg-panel px-1.5 py-1.5 shadow-lift">
      <div data-parity="hot-name" className="text-6 font-[750] tracking-[-.01em] text-text">
        {piece.exerciseName}
      </div>

      {/* A timed piece's target IS the big clock — printing it twice is noise,
          the same call `renderWarm` makes in the prototype. */}
      {!timed ? (
        <div data-parity="hot-presc" className="num mt-0.25 font-mono text-3 text-dim">
          {piece.planned.reps}
        </div>
      ) : null}

      {timed ? (
        <div className="mt-1.5 flex items-center gap-2">
          <b data-parity="warm-clock" className="num font-mono text-9 font-[750] tracking-[-.02em] text-gold2">
            {fmtSecs(left)}
          </b>
          <button
            type="button"
            aria-label={running ? 'Pause' : 'Start'}
            onClick={() => setRunning((r) => !r)}
            className="h-4 rounded-pill border border-line2 bg-panel2 px-1.5 text-3 font-[650] text-muted"
          >
            {running ? 'Pause' : 'Start'}
          </button>
        </div>
      ) : null}

      <button
        type="button"
        data-parity="piece-done"
        onClick={finish}
        className={cx('mt-1.5 h-6 w-full rounded-md text-5 font-[750] text-on-accent [background:var(--brass)]')}
      >
        Done
      </button>
    </div>
  );
}
