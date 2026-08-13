import { useRef, useState } from 'react';
import { plateBreakdown } from '@hybrid/engine';
import type { Action, Draft, HotSet } from '@hybrid/session-authoring';
import { cx } from '../../ui';

/*
 * The live set — one hot card, one decision at a time.
 *
 * Every value shown here is read straight off `HotSet`/`Draft`, both handed
 * down from `useSession`'s view: this file computes no weight, no next set,
 * no coaching line. `hot.message` in particular renders VERBATIM — it is
 * `@hybrid/engine`'s `foldFromExercise` speaking, pinned by
 * `packages/engine/test/golden/foldExercise.json`, and every branch of it
 * (including a long one with an em dash) must reach the screen unedited.
 *
 * The only state this component owns is whether the weight field is in edit
 * mode. Every value change — a rep, a rating, a committed weight — goes out
 * through `dispatch({ type: 'setDraft', patch })`, the same action the
 * mobile app will use on the same hook.
 *
 * Plate maths is not re-derived here: it is `@hybrid/engine`'s own
 * `plateBreakdown`, the same call `Logger.tsx`'s `Affordances` already makes
 * (bar 20kg, standard plate set) — this file does not carry a second copy of
 * that arithmetic.
 */

const BAR_KG = 20;
const PLATES_KG = [25, 20, 15, 10, 5, 2.5, 1.25];

/** The chip ladder, in the prototype's own order and values. The parity
 *  attribute is the value with the decimal point removed — `7.5` is
 *  `rpe-75`, and `10` is `rpe-10` — the same `String(v).replace('.', '')`
 *  rule the prototype (`rolling-logger.html`) and `checks/parity/script.mjs`
 *  both use. */
const RPE_CHIPS = [7, 7.5, 8, 8.5, 9, 9.5, 10].map((value) => ({
  value,
  key: String(value).replace('.', ''),
}));

export function HotCard({
  hot,
  draft,
  dispatch,
  label,
  weighted,
}: {
  hot: HotSet;
  draft: Draft;
  dispatch: (action: Action) => void;
  /** `superset ? hot.exerciseName : 'Set N'` — computed by `BlockScreen`,
   *  which already builds this exact label for every other row in the
   *  round, so it is not recomputed here. */
  label: string;
  /** Whether this exercise records a load at all — a bodyweight exercise
   *  shows no weight control. */
  weighted: boolean;
}) {
  const [editingKg, setEditingKg] = useState(false);
  const kgInputRef = useRef<HTMLInputElement>(null);

  const setDraft = (patch: Partial<Draft>) => dispatch({ type: 'setDraft', patch });

  const commitKg = () => {
    const raw = kgInputRef.current?.value;
    const v = raw == null ? NaN : parseFloat(raw);
    if (Number.isFinite(v) && v >= 0) setDraft({ kg: v });
    setEditingKg(false);
  };

  const plates = weighted && draft.kg > 0 ? plateBreakdown(draft.kg, BAR_KG, PLATES_KG) : null;
  const ready = draft.reps > 0 && draft.felt != null;

  return (
    <div className="my-1 rounded-lg border border-gold-line bg-panel px-1.5 py-1.5 shadow-lift">
      <div data-parity="hot-name" className="text-6 font-[750] tracking-[-.01em] text-text">
        {label}
      </div>
      <div data-parity="hot-presc" className="num mt-0.25 font-mono text-3 text-dim">
        {hot.planned.reps} reps @ RPE {hot.planned.rpe}
      </div>
      {/* `min-h` matches the prototype's `.hwhy` — the card must not jump when
          a short message is replaced by a long one. */}
      <div data-parity="hot-why" className="mt-1 min-h-[14px] font-mono text-3 text-gold">
        {hot.message}
      </div>

      <div className="mt-1.5 flex items-center gap-2">
        {weighted ? (
          <div className="min-w-0 flex-1">
            <div className="font-mono text-1 uppercase tracking-[.13em] text-dim">weight</div>
            {editingKg ? (
              <input
                ref={kgInputRef}
                data-parity="hot-kg"
                inputMode="decimal"
                defaultValue={draft.kg}
                autoFocus
                aria-label="Kilograms"
                onBlur={commitKg}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitKg();
                }}
                className="num w-[7rem] rounded-md border border-gold-line bg-panel2 px-1 text-8 font-[750] text-text outline-none"
              />
            ) : (
              <button
                type="button"
                data-parity="hot-kg"
                aria-label="Weight, tap to edit"
                onClick={() => setEditingKg(true)}
                className="num block text-left text-9 font-[750] tracking-[-.02em] text-text"
              >
                {draft.kg}
                <small className="ml-0.5 text-4 font-[500] text-dim">kg</small>
              </button>
            )}
            {/* Plate maths only for a loaded barbell exercise, and only once
                there is a load to break down — `@hybrid/engine`'s own
                `plateBreakdown`, not a second copy of it. See the file
                header: this app's domain model carries no barbell/dumbbell
                fact, so a dumbbell's "per hand" reading from the prototype
                has nowhere honest to hang here; every loaded set gets the
                same bar-and-plates reading `Logger.tsx` already gives it. */}
            {plates ? (
              <div className="num mt-0.5 font-mono text-2 text-muted">
                {plates.perSide.length ? `per side: ${plates.perSide.join(' · ')}` : 'bar only'}
                {!plates.loadable
                  ? ` — nearest is ${plates.achievableKg}kg (${plates.delta > 0 ? '+' : ''}${plates.delta})`
                  : ''}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className={cx('flex flex-col items-center gap-0.5', !weighted && 'flex-1')}>
          <div className="font-mono text-1 uppercase tracking-[.13em] text-dim">reps</div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              data-parity="reps-down"
              aria-label="One rep fewer"
              onClick={() => setDraft({ reps: Math.max(0, draft.reps - 1) })}
              className="grid h-4 w-4 place-items-center rounded-md border border-line2 bg-panel2 text-7 font-[750] text-muted active:bg-well"
            >
              −
            </button>
            <span className="num w-3 text-center text-7 font-[750] text-text">{draft.reps}</span>
            <button
              type="button"
              data-parity="reps-up"
              aria-label="One rep more"
              onClick={() => setDraft({ reps: draft.reps + 1 })}
              className="grid h-4 w-4 place-items-center rounded-md border border-line2 bg-panel2 text-7 font-[750] text-muted active:bg-well"
            >
              +
            </button>
          </div>
        </div>
      </div>

      <div className="mt-1.5 font-mono text-1 uppercase tracking-[.13em] text-dim">how hard was it</div>
      <div className="mt-0.5 flex gap-0.5">
        {RPE_CHIPS.map(({ value, key }) => (
          <button
            key={key}
            type="button"
            data-parity={`rpe-${key}`}
            aria-pressed={draft.felt === value}
            onClick={() => setDraft({ felt: value })}
            className={cx(
              'num h-5 flex-1 rounded-md border text-3',
              draft.felt === value
                ? 'border-done-line bg-done-bg font-[700] text-done-ink'
                : 'border-line2 bg-panel2 text-muted',
            )}
          >
            {value}
          </button>
        ))}
      </div>

      <button
        type="button"
        data-parity="log"
        disabled={!ready}
        onClick={() => dispatch({ type: 'logSet' })}
        className={cx(
          'mt-1.5 h-6 w-full rounded-md text-5 font-[750]',
          ready
            ? 'text-on-accent [background:var(--brass)]'
            : 'border border-line2 bg-panel2 text-dim',
        )}
      >
        Log set
      </button>
    </div>
  );
}
