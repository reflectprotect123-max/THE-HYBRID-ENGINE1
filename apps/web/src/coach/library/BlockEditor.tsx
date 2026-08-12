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
  sets: SetRow[];
}

export interface BlockValue {
  id: string;
  category: string;
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
  onChange,
  onRemove,
}: {
  block: BlockValue;
  entries: CatalogueEntry[];
  index: number;
  onChange: (next: BlockValue) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
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
        { id, name, columnA: 'reps', columnB: 'weight_kg', sets: newSetRows(id) },
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
          aria-label="Collapse block"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <ChevronDown />
        </button>
        <span className="cb-block-eyebrow">BLOCK {String(index + 1).padStart(2, '0')}</span>
        <select
          className="rd-select cb-block-type"
          aria-label="Block kind"
          value={block.category}
          onChange={(e) => {
            const category = e.target.value;
            /* Switching INTO a conditioning category seeds its defaults;
               switching out drops them. Keeping a stale conditioning value on
               a strength block would round-trip a block the coach can no
               longer see or edit. */
            onChange(
              CONDITIONING_CATEGORIES.includes(category)
                ? { ...block, category, conditioning: block.conditioning ?? newCondValue(category) }
                : { id: block.id, category, exercises: block.exercises },
            );
          }}
        >
          {BLOCK_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button type="button" className="cb-block-remove" aria-label="Remove block" onClick={onRemove}>
          <Cross />
        </button>
      </div>

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
                <li key={ex.id} className="cb-item">
                  <span className="cal-letter-chip">{letterFor(i)}</span>
                  <span className="name">{ex.name}</span>
                  <button
                    type="button"
                    className="cb-block-remove"
                    aria-label={`Remove ${ex.name}`}
                    onClick={() => removeExercise(ex.id)}
                  >
                    <Cross />
                  </button>
                  <SetRows
                    sets={ex.sets}
                    columnA={ex.columnA}
                    columnB={ex.columnB}
                    onColumnChange={(which, value) =>
                      patchExercise(ex.id, which === 'a' ? { columnA: value } : { columnB: value })
                    }
                    onSetsChange={(sets) => patchExercise(ex.id, { sets })}
                  />
                </li>
              ))}
            </ol>

            {!pickerOpen && (
              <button type="button" className="cb-picker-reveal" onClick={() => setPickerOpen(true)}>
                + Add exercise from library
              </button>
            )}

            {pickerOpen && (
              <ExercisePicker
                entries={entries}
                onPick={addExercise}
                onNewExercise={(name) => {
                  if (name) addExercise(name);
                }}
                onDone={() => setPickerOpen(false)}
              />
            )}
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
