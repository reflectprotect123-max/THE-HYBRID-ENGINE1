import { useState } from 'react';
import { CON_EFFORTS, CON_FORMATS } from '@hybrid/engine';
import type { CatalogueEntry, CondFmtKey, EffortKey } from '@hybrid/engine';
import { ExercisePicker } from './ExercisePicker';
import { SetRows, newSetRows, type SetRow } from './SetRows';

/**
 * The block kinds a coach can add.
 *
 * The mockup's own `BLOCK_CATEGORIES`, verbatim and in order, plus one the
 * owner asked for on 12 August 2026: `Mixed modal`. It is a conditioning block
 * with no single modality and no interval structure — one continuous effort,
 * heart rate recorded start to finish, against a target duration. Rest is not
 * prescribed; the athlete's rest timer is there if they want it.
 */
export const BLOCK_CATEGORIES = [
  'Strength/Power',
  'Conditioning',
  'Mixed modal',
  'Warm-up',
  'Cooldown',
  'Mobility',
] as const;

/** The categories that author a `CondBlock` rather than exercises and sets. */
export const CONDITIONING_CATEGORIES: readonly string[] = ['Conditioning', 'Mixed modal'];

/**
 * What a conditioning block holds. Every field maps onto one the engine's
 * `CondBlock` already has, so nothing here is a shape this app invented:
 * `minutes` and `targetDistanceM` are strings only because they are text
 * inputs mid-edit — `day-workout.ts` is where they become numbers, and where a
 * value that is not a number is dropped rather than stored as NaN.
 */
export interface CondValue {
  /** `CondFmtKey`. */
  fmt: string;
  /** `Modality`, or '' for mixed / unlabelled — which is what Mixed modal is. */
  modality: string;
  /** `EffortKey`. The engine derives the HR zone from it; the coach never picks a zone directly. */
  effort: string;
  minutes: string;
  targetDistanceM: string;
}

export const CONDITIONING_FORMATS = ['steady', 'intervals', 'tempo', 'free'] as const;
export const CONDITIONING_EFFORTS = ['easy', 'medium', 'hard'] as const;
export const CONDITIONING_MODALITIES = ['', 'row', 'run', 'ski', 'bike', 'air_bike'] as const;

/** A new block's conditioning defaults, which differ by category. */
export function newCondValue(category: string): CondValue {
  return category === 'Mixed modal'
    // Free: one continuous effort, no interval structure. No modality, because
    // "mixed" is precisely the absence of one — `types.ts` calls that
    // "unlabeled/general conditioning".
    ? { fmt: 'free', modality: '', effort: 'medium', minutes: '30', targetDistanceM: '' }
    : { fmt: 'steady', modality: '', effort: 'easy', minutes: '20', targetDistanceM: '' };
}

export interface BlockExercise {
  id: string;
  name: string;
  /** What each of the two set columns measures — see `@hybrid/engine`'s COLUMN_TYPES. */
  columnA: string;
  columnB: string;
  /**
   * Seconds of rest between these sets, and the reason it exists.
   *
   * `restAfter` (@hybrid/session-authoring) reads `Exercise.rest` and returns
   * null at zero, so a coach's session ran with NO rest timer until this was
   * authorable — the countdown, the notification and the global rest chip all
   * existed and none of them ever fired for published work.
   *
   * The mockup has no control for this, so it is an addition rather than a
   * port: `.cb-cond-rest` covers interval rest inside a conditioning block and
   * nothing covers rest between strength sets.
   */
  rest: number;
  sets: SetRow[];
}

/** Ninety seconds — the same default `newEx` gives an exercise on the phone. */
export const DEFAULT_REST_SEC = 90;

export interface BlockValue {
  id: string;
  category: string;
  /**
   * What the athlete sees this section called — "STRENGTH INTENSITY 1",
   * "FINISHER". Empty means the category is the name, which is what every
   * block said before templates existed.
   */
  heading?: string;
  /** Minutes the coach budgets for this section. A string while it is a text input. */
  minutes?: string;
  /** Every exercise in the block pairs with the next: a superset or a circuit. */
  superset?: boolean;
  exercises: BlockExercise[];
  /** Present only for a conditioning category; see `CONDITIONING_CATEGORIES`. */
  conditioning?: CondValue;
}

/** A, B, C … — the mockup letters exercises within a block rather than numbering them. */
function letterFor(i: number): string {
  return String.fromCharCode(65 + (i % 26));
}

const ChevronDown = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9l6 6 6-6" />
  </svg>
);

const Cross = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

/**
 * One block of a session, as the mockup draws it: a head carrying the block's
 * number, its kind and a remove action, over a body holding the exercises and
 * the library picker.
 *
 * The block's number comes from its POSITION, not from stored state — the
 * mockup relabels every block on each change for the same reason. A stored
 * ordinal survives a deletion and starts lying.
 */
export function BlockEditor({
  block,
  entries,
  index,
  startCollapsed = false,
  onChange,
  onRemove,
}: {
  block: BlockValue;
  entries: CatalogueEntry[];
  index: number;
  /**
   * Open the block closed. Only the day builder sets this, and only for the
   * blocks a TEMPLATE just laid down: six sections each opening onto its own
   * exercise library is a 7,600px page before the coach has chosen anything.
   * A block added one at a time still opens expanded, because the coach who
   * pressed Add block is about to fill it in.
   */
  startCollapsed?: boolean;
  onChange: (next: BlockValue) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(!startCollapsed);
  const [pickerOpen, setPickerOpen] = useState(false);
  const isConditioning = CONDITIONING_CATEGORIES.includes(block.category);

  function addExercise(name: string) {
    const id = `${block.id}-${block.exercises.length}-${name}`;
    onChange({
      ...block,
      exercises: [
        ...block.exercises,
        // Reps and kilos: the pair a coach reaches for most, and a valid pair
        // by `isColumnPairValid` so nothing opens already locked.
        { id, name, columnA: 'reps', columnB: 'weight_kg', rest: DEFAULT_REST_SEC, sets: newSetRows(id) },
      ],
    });
  }

  function removeExercise(id: string) {
    onChange({ ...block, exercises: block.exercises.filter((e) => e.id !== id) });
  }

  function patchExercise(id: string, patch: Partial<BlockExercise>) {
    onChange({
      ...block,
      exercises: block.exercises.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    });
  }

  return (
    <div className={`cb-block${expanded ? '' : ' collapsed'}`}>
      <div className="cb-block-head">
        <button
          type="button"
          className="cb-block-collapse"
          aria-label={expanded ? 'Collapse block' : 'Expand block'}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <ChevronDown />
        </button>
        <span className="cb-block-eyebrow">BLOCK {String(index + 1).padStart(2, '0')}</span>
        {/*
          * THE HEAD CARRIES THE SECTION'S NAME, and it did not until 16 August
          * 2026 — it carried the kind dropdown, because before templates the
          * kind was the only thing a block had to say for itself. A six-section
          * template made the cost obvious at a glance: four blocks in a row all
          * read "Strength/Power", and the names that told them apart were
          * buried in a field below the fold of a collapsed block. The kind is
          * still one control away, in the row underneath.
          */}
        <span className="cb-block-name">{block.heading?.trim() || block.category}</span>
        <button type="button" className="cb-block-remove" aria-label="Remove block" onClick={onRemove}>
          <Cross />
        </button>
      </div>

      {/*
        * WHAT A SECTION IS CALLED, HOW LONG IT GETS, AND WHETHER IT PAIRS.
        *
        * All three are fields the engine's `StrengthBlock` has always had and
        * this screen never authored, which is why a session template could not
        * be expressed here: "STRENGTH INTENSITY 1 · 15 minutes · superset" had
        * nowhere to live. The name is separate from the kind — see
        * `StrengthBlock.category` — so a block can read as a section and still
        * be a Strength/Power block underneath.
        */}
      {expanded && (
        <div className="cb-block-meta">
          <label className="cb-field-block">
            <span className="cal-field-label">
              Section name <span className="cb-optional-inline">optional</span>
            </span>
            <input
              type="text"
              className="cb-text-input"
              placeholder={block.category}
              value={block.heading ?? ''}
              onChange={(e) => onChange({ ...block, heading: e.target.value })}
            />
          </label>
          <label className="cb-field-block">
            <span className="cal-field-label">Kind</span>
            <select
              className="cb-text-input"
              aria-label="Block kind"
              value={block.category}
              onChange={(e) => {
                const category = e.target.value;
                /* Switching INTO a conditioning category seeds its defaults;
                   switching out drops them. Keeping a stale conditioning value
                   on a strength block would round-trip a block the coach can no
                   longer see or edit. */
                const { conditioning: _drop, ...kept } = block;
                onChange(
                  CONDITIONING_CATEGORIES.includes(category)
                    ? { ...block, category, conditioning: block.conditioning ?? newCondValue(category) }
                    : { ...kept, category },
                );
              }}
            >
              {BLOCK_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          {/* A conditioning block keeps its minutes in its OWN fields below,
              and that is the one the engine reads. Two inputs both labelled
              Minutes, only one of which is wired, is worse than one. */}
          {!isConditioning && (
            <label className="cb-field-block">
              <span className="cal-field-label">
                Minutes <span className="cb-optional-inline">optional</span>
              </span>
              <input
                type="text"
                inputMode="numeric"
                className="cb-text-input"
                placeholder="—"
                value={block.minutes ?? ''}
                onChange={(e) => onChange({ ...block, minutes: e.target.value })}
              />
            </label>
          )}
          {!isConditioning && (
            <label className="cb-opt-toggle cb-block-superset">
              <input
                type="checkbox"
                checked={!!block.superset}
                onChange={(e) => onChange({ ...block, superset: e.target.checked })}
              />
              Superset — every movement pairs with the next
            </label>
          )}
        </div>
      )}

      {expanded && isConditioning && (
        <div className="cb-block-body-wrap">
          <CondBlockFields
            value={block.conditioning ?? newCondValue(block.category)}
            mixed={block.category === 'Mixed modal'}
            onChange={(conditioning) => onChange({ ...block, conditioning })}
          />
        </div>
      )}

      {expanded && !isConditioning && (
        <div className="cb-block-body-wrap">
          <div className="cb-strength-body">
            <ol className="cb-block-items">
              {block.exercises.map((ex, i) => (
                <ExerciseItem
                  key={ex.id}
                  exercise={ex}
                  letter={letterFor(i)}
                  onRemove={() => removeExercise(ex.id)}
                  onPatch={(patch) => patchExercise(ex.id, patch)}
                />
              ))}
            </ol>

            {/*
              * The reveal button is a PHONE control — `.cb-picker-reveal` is
              * `display: none` until the phone media query turns it on. It is
              * still rendered here at every width because hiding it is the
              * stylesheet's job, and on desktop it costs nothing.
              */}
            {!pickerOpen && (
              <button type="button" className="cb-picker-reveal" onClick={() => setPickerOpen(true)}>
                + Add exercise from library
              </button>
            )}

            {/*
              * ALWAYS MOUNTED, visibility decided in CSS. This was behind
              * `pickerOpen &&` until 16 August 2026, and `pickerOpen` can only
              * be set by the reveal button above — which does not exist at
              * desktop width. The result was a block a coach could not put a
              * single exercise into on the 1440px screen this workspace is
              * composed at.
              */}
            <ExercisePicker
              entries={entries}
              open={pickerOpen}
              onPick={addExercise}
              onNewExercise={(name) => {
                if (name) addExercise(name);
              }}
              onDone={() => setPickerOpen(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A conditioning block's prescription.
 *
 * Every control maps onto a field the engine's `CondBlock` already has, and
 * the coach picks an EFFORT rather than a heart-rate zone: `CON_EFFORTS` owns
 * that mapping, and letting a coach set a zone directly would make the two
 * disagree the moment either changed.
 *
 * A Mixed modal block hides the format and modality choices rather than
 * showing them greyed out — it IS free format with no single modality, and a
 * disabled control that can never change is a question the coach has to read
 * and dismiss every time.
 */
function CondBlockFields({
  value,
  mixed,
  onChange,
}: {
  value: CondValue;
  mixed: boolean;
  onChange: (next: CondValue) => void;
}) {
  const effort = CON_EFFORTS[(value.effort as EffortKey)] ?? CON_EFFORTS.easy;
  return (
    <div className="cb-cond-body">
      {mixed ? (
        <p className="cb-note">
          One continuous effort, heart rate recorded start to finish. No intervals and no prescribed
          rest — the rest timer is there if the athlete wants it.
        </p>
      ) : (
        <div className="cb-cond-row">
          <label className="cb-cond-field">
            <span className="cal-field-label">Format</span>
            <select
              className="rd-select"
              aria-label="Conditioning format"
              value={value.fmt}
              onChange={(e) => onChange({ ...value, fmt: e.target.value })}
            >
              {CONDITIONING_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {CON_FORMATS[f]?.name ?? f}
                </option>
              ))}
            </select>
          </label>
          <label className="cb-cond-field">
            <span className="cal-field-label">Modality</span>
            <select
              className="rd-select"
              aria-label="Modality"
              value={value.modality}
              onChange={(e) => onChange({ ...value, modality: e.target.value })}
            >
              {CONDITIONING_MODALITIES.map((m) => (
                <option key={m || 'mixed'} value={m}>
                  {m ? MODALITY_LABELS[m] : 'Mixed / any'}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div className="cb-cond-row">
        <label className="cb-cond-field">
          <span className="cal-field-label">Effort</span>
          <select
            className="rd-select"
            aria-label="Effort"
            value={value.effort}
            onChange={(e) => onChange({ ...value, effort: e.target.value })}
          >
            {CONDITIONING_EFFORTS.map((e) => (
              <option key={e} value={e}>
                {CON_EFFORTS[e].name}
              </option>
            ))}
          </select>
        </label>
        <label className="cb-cond-field">
          <span className="cal-field-label">{mixed ? 'Target minutes' : 'Minutes'}</span>
          <input
            type="number"
            inputMode="numeric"
            min="0"
            aria-label={mixed ? 'Target minutes' : 'Minutes'}
            value={value.minutes}
            onChange={(e) => onChange({ ...value, minutes: e.target.value })}
          />
        </label>
        <label className="cb-cond-field">
          <span className="cal-field-label">Target distance (m)</span>
          <input
            type="number"
            inputMode="numeric"
            min="0"
            aria-label="Target distance in metres"
            placeholder="optional"
            value={value.targetDistanceM}
            onChange={(e) => onChange({ ...value, targetDistanceM: e.target.value })}
          />
        </label>
      </div>

      {/* The zone is DERIVED, so it is reported rather than offered. */}
      <p className="cb-note">
        {effort.name} · RPE {effort.rpe[0]}–{effort.rpe[1]} · {effort.cue} · heart-rate zone{' '}
        {effort.zone}
      </p>
    </div>
  );
}

const MODALITY_LABELS: Record<string, string> = {
  row: 'Row', run: 'Run', ski: 'Ski', bike: 'Bike', air_bike: 'Air bike',
};

/**
 * ONE EXERCISE IN A BLOCK: a row you can read at a glance, opening into its
 * sets.
 *
 * Rebuilt to the mockup on 16 August 2026. What shipped before was the same
 * data with none of the shape — a letter, a name, a remove button, and then
 * the full sets table inline, for every exercise, always. Five exercises in a
 * block meant five stacked tables and a page a coach had to scroll past to
 * reach the one they wanted.
 *
 * The mockup collapses it. A row is `[letter] [name] [3 Sets]`, and clicking
 * the row opens the editor beneath it. That is not decoration: the stylesheet
 * was ported whole in stage 1 and has carried `.cb-item-head-row`,
 * `.cb-item-head`, `.cb-sets-pill`, `.cb-item.expanded` and `.cb-exp`
 * (`display: none` until expanded) ever since, describing exactly this. None
 * of it was rendered, so it was invisible — the same failure as the exercise
 * picker two commits ago, and 41 of the stylesheet's 77 `cb-` classes are
 * still in that state.
 *
 * WHAT IS DELIBERATELY NOT PORTED, because the mockup's `.cb-exp` also holds:
 *
 *   - `.cb-exp-cues`, a per-exercise instructions box with a 0/500 counter
 *   - `.cb-swaps`, suggested swaps and points of performance
 *   - `.cb-opt-toggle`, an "Optional" checkbox per column
 *
 * `BlockExercise` has nowhere to put any of them — no `cues`, no `swaps`, no
 * per-column optional flag — and `day-workout.ts` would drop them on the way
 * to a `Workout`. A textarea a coach types into that is discarded on save is
 * worse than no textarea, so they wait for the data model rather than
 * arriving as scenery.
 */
function ExerciseItem({
  exercise,
  letter,
  onRemove,
  onPatch,
}: {
  exercise: BlockExercise;
  letter: string;
  onRemove: () => void;
  onPatch: (patch: Partial<BlockExercise>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const count = exercise.sets.length;

  return (
    <li className={`cb-item${expanded ? ' expanded' : ''}`}>
      <div className="cb-item-head-row">
        <button
          type="button"
          className="cb-item-head"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <span className="cal-letter-chip">{letter}</span>
          <span className="cb-item-name">{exercise.name}</span>
          {/* The mockup's own wording and capitalisation: "1 Set", "3 Sets". */}
          <span className="cb-sets-pill">{count === 1 ? '1 Set' : `${count} Sets`}</span>
        </button>
        <button
          type="button"
          className="cb-item-remove"
          aria-label={`Remove ${exercise.name}`}
          onClick={onRemove}
        >
          <Cross />
        </button>
      </div>

      {/*
        * ALWAYS RENDERED, hidden by `.cb-exp`'s own `display: none` until the
        * item carries `expanded`. Mounting it conditionally would put React in
        * charge of a visibility the stylesheet already owns — which is the
        * exact mistake that made the picker unreachable at desktop width.
        */}
      <div className="cb-exp">
        {/*
          * `.cb-field-block` and `.cb-text-input` are the stylesheet's own
          * names for a labelled field inside the expanded editor — both were
          * ported in stage 1 and neither had ever been rendered.
          */}
        <label className="cb-field-block">
          <span className="cal-field-label">Rest between sets (seconds)</span>
          <input
            className="cb-text-input"
            type="number"
            min={0}
            step={15}
            inputMode="numeric"
            value={exercise.rest}
            onChange={(e) => onPatch({ rest: Math.max(0, Number(e.target.value) || 0) })}
          />
        </label>

        <SetRows
          sets={exercise.sets}
          columnA={exercise.columnA}
          columnB={exercise.columnB}
          onColumnChange={(which, value) => onPatch(which === 'a' ? { columnA: value } : { columnB: value })}
          onSetsChange={(sets) => onPatch({ sets })}
        />
      </div>
    </li>
  );
}
