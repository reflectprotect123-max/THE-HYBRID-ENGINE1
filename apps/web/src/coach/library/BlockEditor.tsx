import { useState } from 'react';
import type { CatalogueEntry } from '@hybrid/engine';
import { ExercisePicker } from './ExercisePicker';
import { SetRows, newSetRows, type SetRow } from './SetRows';

/** The block kinds the mockup's `BLOCK_CATEGORIES` offers, verbatim and in order. */
export const BLOCK_CATEGORIES = [
  'Strength/Power',
  'Conditioning',
  'Warm-up',
  'Cooldown',
  'Mobility',
] as const;

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
          onChange={(e) => onChange({ ...block, category: e.target.value })}
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

      {expanded && (
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
