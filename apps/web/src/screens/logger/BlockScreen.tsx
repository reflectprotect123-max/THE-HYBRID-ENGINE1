import { isLiftMode, type LoggedSet, type StrengthBlock } from '@hybrid/engine';
import type { Action, Draft, HotSet, RoundSet, RoundView } from '@hybrid/session-authoring';
import { cx } from '../../ui';
import { HotCard } from './HotCard';

/*
 * The rounds of the block currently on screen.
 *
 * `rounds` comes straight from `useSession`'s view, in the order it will
 * actually run — round-major, a superset's pair alternating rather than one
 * movement finishing before the other starts (`queue.ts`'s `orderFor`,
 * already applied by the hook). This file recomputes none of that: it walks
 * `rounds` in the order given and paints each `RoundSet` by its `status`,
 * `planned` and `logged` — never indexing back into `block` for a set's
 * values. The engine already parsed `aVal`/`aVal2`/`felt` once, in
 * `@hybrid/session-authoring`'s `view.ts`; this file only formats what it was
 * handed.
 */

const isSupersetRound = (round: RoundView) => round.sets.length > 1;
const roundStarted = (round: RoundView) => round.sets.some((s) => s.status === 'done');
const roundIsLive = (round: RoundView) => round.sets.some((s) => s.status === 'live');

/** `L.kg × L.reps @ L.felt`, the prototype's receipt line — reusing the same
 *  `isLiftMode` shape `LoggedList` already renders in `Logger.tsx`, but off
 *  `RoundSet.logged` rather than a raw `aVal`/`aVal2`. */
function receiptValue(ex: { mode: string }, logged: NonNullable<RoundSet['logged']>): string {
  const parts: string[] = [];
  if (logged.kg) parts.push(`${logged.kg}${isLiftMode(ex.mode) ? 'kg' : ''}`);
  if (logged.reps) parts.push(`× ${logged.reps}`);
  const load = parts.join(' ');
  return logged.felt ? (load ? `${load} @ ${logged.felt}` : `@ ${logged.felt}`) : load;
}

export function BlockScreen({
  block,
  title,
  rounds,
  onRotate,
  hot,
  draft,
  dispatch,
}: {
  block: StrengthBlock<LoggedSet>;
  /** The block's title, from the hook's own `BlockView.title` — not
   *  recomputed here, so a superset's "Press + Raise" join stays in one
   *  place. */
  title: string;
  rounds: RoundView[];
  onRotate: (blockId: string) => void;
  /** The set in front of the athlete, and the coaching rule's word on it —
   *  `useSession`'s `view.hot`, straight through. Null whenever no round in
   *  `rounds` is `'live'`. */
  hot: HotSet | null;
  /** The athlete's in-progress entry for `hot` — `view.draft`. */
  draft: Draft | null;
  dispatch: (action: Action) => void;
}) {
  const superset = !!block.superset;
  let receiptIndex = 0; // within THIS block, DOM order — never across the session

  return (
    <div className="px-0.5 pt-0.5 pb-3">
      <h2 className="mt-0.5 mb-0.5 text-7 font-[750] tracking-[-.015em]">{title}</h2>

      {rounds.map((round) => {
        const showGrip = superset && roundIsLive(round) && !roundStarted(round);

        return (
          <div key={round.round}>
            {isSupersetRound(round) ? (
              <div className="mt-2 mb-0.5 font-mono text-1 tracking-[.12em] text-dim uppercase">
                Round {round.round + 1}
              </div>
            ) : null}

            {round.sets.map((set) => {
              const ex = block.exercises[set.exerciseIndex];
              if (!ex) return null;

              const label = superset ? set.exerciseName : `Set ${set.setIndex + 1}`;
              const key = `${set.exerciseIndex}-${set.setIndex}`;

              if (set.status === 'done' && set.logged) {
                const parity = `receipt-${receiptIndex}`;
                receiptIndex += 1;
                return (
                  <div
                    key={key}
                    data-parity={parity}
                    className="my-0.5 flex items-center gap-1 rounded-md border border-line bg-well px-1.5 py-1"
                  >
                    <span className="grid h-2.5 w-2.5 shrink-0 place-items-center rounded-full border border-done-line bg-done-bg text-done-ink">
                      <CheckIcon />
                    </span>
                    <span className="flex-1 truncate text-4 font-[600] text-muted">{label}</span>
                    <span className="num shrink-0 font-mono text-3 text-done-ink">{receiptValue(ex, set.logged)}</span>
                  </div>
                );
              }

              if (set.status === 'live') {
                // `nextUp` (via `view.ts`'s `buildRounds`) is the only thing
                // that marks a set 'live', and it is the same call that
                // produces `hot` — so a live row here and a null/mismatched
                // `hot` would mean the hook contradicted itself. Rendering
                // nothing in that case is a safe no-op, not a guess.
                if (!hot || !draft || hot.exerciseIndex !== set.exerciseIndex || hot.setIndex !== set.setIndex) {
                  return null;
                }
                return (
                  <HotCard
                    key={key}
                    hot={hot}
                    draft={draft}
                    dispatch={dispatch}
                    label={label}
                    weighted={isLiftMode(ex.mode)}
                  />
                );
              }

              return (
                <div
                  key={key}
                  className={cx(
                    'relative my-0.5 flex items-baseline justify-between gap-1 rounded-md border border-dashed border-line px-1.5 py-1',
                    showGrip && 'pl-4.5',
                  )}
                >
                  {showGrip ? (
                    <button
                      type="button"
                      data-parity="grip"
                      aria-label="Do this movement first"
                      onClick={() => onRotate(block.id)}
                      // A native button already activates on Enter via the
                      // browser's own click synthesis — this handler exists
                      // so that behaviour is asserted, not assumed, and so it
                      // fires exactly once: `preventDefault` on the keydown
                      // cancels the browser's own synthesized click for this
                      // key, rather than stacking a second `onRotate` call on
                      // top of it.
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return;
                        e.preventDefault();
                        onRotate(block.id);
                      }}
                      className="absolute top-1/2 left-0.5 grid h-5 w-3.5 -translate-y-1/2 place-items-center text-dim hover:text-gold2"
                    >
                      <GripIcon />
                    </button>
                  ) : null}
                  <span className="text-4 font-[600] text-dim">{label}</span>
                  <span className="num font-mono text-3 text-dim">
                    {set.planned.reps} @ RPE {set.planned.rpe}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="4 12 9 17 20 6" />
    </svg>
  );
}

/** Six dots, two columns of three — the prototype's `grip` glyph
 *  (`ICONS.grip` in `rolling-logger.html`). A drag-only affordance is
 *  unreachable without a pointer, so this is a real `<button>`: tap and
 *  keyboard Enter both fire `onClick`. */
function GripIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="9" cy="6" r="1.4" />
      <circle cx="15" cy="6" r="1.4" />
      <circle cx="9" cy="12" r="1.4" />
      <circle cx="15" cy="12" r="1.4" />
      <circle cx="9" cy="18" r="1.4" />
      <circle cx="15" cy="18" r="1.4" />
    </svg>
  );
}
