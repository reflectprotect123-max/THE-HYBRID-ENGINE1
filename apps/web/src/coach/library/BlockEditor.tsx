import { useRef, useState } from 'react';
import { CON_EFFORTS, CON_FORMATS } from '@hybrid/engine';
import type { CatalogueEntry, CondFmtKey, EffortKey } from '@hybrid/engine';
import { ExerciseWizard, type WizardResult, type WizardShape } from './ExerciseWizard';
import { SetRows, type SetRow } from './SetRows';

export { DEFAULT_REST_SEC, DEFAULT_EVERY_SEC, fmtEvery } from './ExerciseWizard';

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
  /**
   * EMOM pacing in seconds — see `Exercise.every`. Zero or absent means the
   * plain rest above, which is the mode every exercise authored before
   * 16 August 2026 is in.
   */
  every?: number;
  /**
   * Free-text eccentric/concentric tempo, "3-1-1-0" or a coach's own words —
   * `Exercise.tempo` in `@hybrid/engine`, present in the model since before
   * this bench existed and never authorable from it until now. Never
   * required: the field the athlete's card reads is empty exactly when the
   * coach left it that way.
   */
  tempo?: string;
  sets: SetRow[];
}

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
  onCreateMovement,
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
  /**
   * Put a brand-new movement into the coach's own library, so it is there the
   * next time the picker opens. Without it "+ New exercise" only ever added
   * the movement to THIS block and the library never grew — which is exactly
   * the state the emptied library would have been stuck in.
   */
  onCreateMovement?: (name: string) => void;
  onChange: (next: BlockValue) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(!startCollapsed);
  /**
   * Section name / Kind / Minutes / Superset, collapsed behind their own
   * toggle rather than always showing the moment a block is expanded.
   *
   * These four are set once and rarely touched again — a coach expanding a
   * block is almost always there for the exercise list. Defaults to OPEN for
   * a block the coach just added by hand (`!startCollapsed`, same initial
   * value as `expanded` itself) because that block genuinely has nothing
   * configured yet; defaults CLOSED for a template-seeded block reopened
   * later, since a template already set all four correctly.
   */
  const [metaOpen, setMetaOpen] = useState(!startCollapsed);
  /**
   * Which exercise the wizard is open for — `'new'` for a fresh add, an
   * exercise's own `id` to edit it pre-filled, or `null` when it is closed.
   * The wizard is the only writer of an exercise's fields now; `BlockEditor`
   * only decides which one (if any) it is open for and folds the result in.
   */
  const [wizardFor, setWizardFor] = useState<'new' | string | null>(null);
  const [lastShape, setLastShape] = useState<WizardShape | undefined>(undefined);
  /**
   * The set-table escape hatch (Critical finding 2b, 17 August 2026): which
   * exercise (if any) has its raw `SetRows` table expanded inline, beneath
   * its row. The wizard authors one shared value across every set and can
   * never author a genuine wave (different loads per set) or per-set
   * `warm`/`rpe` divergence — see `ExerciseWizard.commit()`'s own doc — so
   * this is the direct path to the same `SetRows` component the wizard's
   * Values step can't reach. Independent of `wizardFor`: a coach can have
   * the wizard closed and a set table open, never both for the SAME
   * exercise at once because opening the wizard on a row closes this.
   */
  const [setsOpenFor, setSetsOpenFor] = useState<string | null>(null);
  const isConditioning = CONDITIONING_CATEGORIES.includes(block.category);
  const headingInputRef = useRef<HTMLInputElement>(null);

  /*
   * EVERY BLOCK'S HEADING IS EDITABLE — the field itself always was (it is
   * not gated on category, only on `expanded`), but a coach had no way to
   * REACH it from the collapsed head row except the unlabelled chevron. This
   * is the second, more direct way in: click the name itself, and land in
   * the field that renames it rather than just an opened block.
   */
  function openHeading() {
    setExpanded(true);
    setMetaOpen(true);
    // The field mounts on this same render; focusing it has to wait one tick.
    requestAnimationFrame(() => headingInputRef.current?.focus());
  }

  function handleWizardSave(result: WizardResult, shape: WizardShape) {
    setLastShape(shape);
    if (result.id) {
      onChange({
        ...block,
        exercises: block.exercises.map((e) => (e.id === result.id ? { ...e, ...result } : e)),
      });
    } else {
      const id = `${block.id}-${block.exercises.length}-${result.name}`;
      onChange({ ...block, exercises: [...block.exercises, { ...result, id }] });
    }
    setWizardFor(null);
  }

  function removeExercise(id: string) {
    onChange({ ...block, exercises: block.exercises.filter((e) => e.id !== id) });
  }

  /** The same edit path `handleWizardSave` uses, but for the set-table escape hatch. */
  function patchExerciseSets(id: string, patch: Partial<Pick<BlockExercise, 'sets' | 'columnA' | 'columnB'>>) {
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
        <button type="button" className="cb-block-name" onClick={openHeading} title="Rename this block">
          {block.heading?.trim() || block.category}
        </button>
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
        <button
          type="button"
          className="cb-block-meta-toggle"
          aria-expanded={metaOpen}
          onClick={() => setMetaOpen((v) => !v)}
        >
          <ChevronDown />
          Block settings
          {!metaOpen && (
            <span className="cb-block-meta-summary">
              {block.category}
              {block.minutes ? ` · ${block.minutes} min` : ''}
              {block.superset ? ' · Superset' : ''}
            </span>
          )}
        </button>
      )}

      {expanded && metaOpen && (
        <div className="cb-block-meta">
          <label className="cb-field-block">
            <span className="cal-field-label">
              Section name <span className="cb-optional-inline">optional</span>
            </span>
            <input
              ref={headingInputRef}
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

      {expanded && !isConditioning && !wizardFor && (
        <div className="cb-block-body-wrap">
          <div className="cb-strength-body">
            <ol className="cb-block-items">
              {block.exercises.map((ex, i) => (
                <ExerciseItem
                  key={ex.id}
                  exercise={ex}
                  letter={letterFor(i)}
                  onRemove={() => removeExercise(ex.id)}
                  onOpen={() => {
                    setSetsOpenFor(null);
                    setWizardFor(ex.id);
                  }}
                  setsOpen={setsOpenFor === ex.id}
                  onToggleSets={() => setSetsOpenFor((cur) => (cur === ex.id ? null : ex.id))}
                  onPatchSets={(patch) => patchExerciseSets(ex.id, patch)}
                />
              ))}
            </ol>

            {/*
              * `.cb-add-exercise-btn`, NOT `.cb-picker-reveal` — that class is
              * `display: none` outside the phone media query in
              * `coach-redesign.css`, and this button is now the ONLY way to
              * add an exercise at any width. See the class's own comment.
              */}
            <button type="button" className="cb-add-exercise-btn" onClick={() => setWizardFor('new')}>
              + Add exercise from library
            </button>
          </div>
        </div>
      )}

      {wizardFor && (
        <ExerciseWizard
          entries={entries}
          initial={wizardFor === 'new' ? undefined : block.exercises.find((e) => e.id === wizardFor)}
          lastShape={lastShape}
          onCreateMovement={onCreateMovement}
          onSave={handleWizardSave}
          onCancel={() => setWizardFor(null)}
        />
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
 * ONE EXERCISE IN A BLOCK: a row you can read at a glance, opening the
 * exercise wizard pre-filled for editing.
 *
 * Rebuilt to the mockup on 16 August 2026 as an always-expanded inline
 * editor beneath the row, then simplified again on 17 August 2026 when the
 * wizard took over the editing job entirely: a row is `[letter] [name] [3
 * Sets]`, and clicking it opens `ExerciseWizard` rather than an inline `.cb-
 * exp` body. `BlockExercise` fields it once wrote directly — Pacing, Rest/
 * Every, Target RPE, Tempo — are now authored exclusively through the
 * wizard's Values and Review steps; `ExerciseItem` neither reads nor writes
 * them.
 *
 * THE SETS TABLE ITSELF CAME BACK the same day (Critical finding 2b of the
 * final review), as a second, independent toggle. The wizard's Values step
 * writes one shared value across every set — necessarily, it's one field —
 * so it can never author a genuine wave (10/8/6 at three different loads),
 * never sets a per-set `warm` ramp flag, and never diverges per-set RPE; see
 * `ExerciseWizard.commit()`'s own doc for the merge that keeps it from
 * DESTROYING those when they already exist. Editing them at all requires
 * `SetRows` directly, which is what this toggle reaches — deliberately not
 * a wizard step, exactly as the design spec's "What this deliberately does
 * not do" always said: "a coach who wants a genuine wave still uses the
 * block's own set table after the wizard closes."
 */
function ExerciseItem({
  exercise,
  letter,
  onRemove,
  onOpen,
  setsOpen,
  onToggleSets,
  onPatchSets,
}: {
  exercise: BlockExercise;
  letter: string;
  onRemove: () => void;
  onOpen: () => void;
  setsOpen: boolean;
  onToggleSets: () => void;
  onPatchSets: (patch: Partial<Pick<BlockExercise, 'sets' | 'columnA' | 'columnB'>>) => void;
}) {
  const count = exercise.sets.length;
  return (
    <li className={`cb-item${setsOpen ? ' expanded' : ''}`}>
      <div className="cb-item-head-row">
        <button type="button" className="cb-item-head" onClick={onOpen}>
          <span className="cal-letter-chip">{letter}</span>
          <span className="cb-item-name">{exercise.name}</span>
          {/* The mockup's own wording and capitalisation: "1 Set", "3 Sets". */}
          <span className="cb-sets-pill">{count === 1 ? '1 Set' : `${count} Sets`}</span>
        </button>
        <button
          type="button"
          className="cb-item-sets-toggle"
          aria-label={setsOpen ? `Hide ${exercise.name}'s set table` : `Edit ${exercise.name}'s sets directly`}
          aria-expanded={setsOpen}
          title="Edit individual sets — for a wave or a warm-up ramp the wizard can't author"
          onClick={onToggleSets}
        >
          #
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
      {setsOpen && (
        <div className="cb-item-sets-body">
          <SetRows
            sets={exercise.sets}
            columnA={exercise.columnA}
            columnB={exercise.columnB}
            onColumnChange={(which, value) => onPatchSets(which === 'a' ? { columnA: value } : { columnB: value })}
            onSetsChange={(sets) => onPatchSets({ sets })}
          />
        </div>
      )}
    </li>
  );
}
