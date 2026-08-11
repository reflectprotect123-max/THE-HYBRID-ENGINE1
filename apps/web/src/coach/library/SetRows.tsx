import { COLUMN_TYPES, availableSecondColumns, isColumnPairValid } from '@hybrid/engine';

export interface SetRow {
  id: string;
  /** First column's value, in whatever `columnA` measures. */
  a: string;
  /** Second column's value, in whatever `columnB` measures. */
  b: string;
}

/**
 * Three empty rows, matching the mockup's note and the app's existing default
 * (`GuidedBuilder` seeds `sets: 3`). A different default here would hand the
 * same coach a different session depending on which screen they opened.
 */
export function newSetRows(exerciseId: string): SetRow[] {
  return [0, 1, 2].map((i) => ({ id: `${exerciseId}-s${i}`, a: '', b: '' }));
}

function placeholderFor(value: string): string {
  return COLUMN_TYPES.find((c) => c.value === value)?.placeholder ?? '';
}

/**
 * An exercise's sets, and the two dropdowns choosing what its columns measure.
 *
 * The pair rule lives in `@hybrid/engine`'s `isColumnPairValid` — this renders
 * that verdict and nothing more. Two columns measuring the same thing produce a
 * set claiming "8 reps and 8 reps", which is bad data that survives into every
 * later read of it, so the second column locks rather than merely looking odd.
 */
export function SetRows({
  sets,
  columnA,
  columnB,
  onColumnChange,
  onSetsChange,
}: {
  sets: SetRow[];
  columnA: string;
  columnB: string;
  onColumnChange: (which: 'a' | 'b', value: string) => void;
  onSetsChange: (sets: SetRow[]) => void;
}) {
  const pairValid = isColumnPairValid(columnA, columnB);

  function patch(id: string, key: 'a' | 'b', value: string) {
    onSetsChange(sets.map((s) => (s.id === id ? { ...s, [key]: value } : s)));
  }

  return (
    <div className="cb-sets">
      <div className="cb-set-columns">
        <label className="cb-set-column">
          <span className="cal-field-label">First column measures</span>
          <select
            className="rd-select"
            aria-label="First column measures"
            value={columnA}
            onChange={(e) => onColumnChange('a', e.target.value)}
          >
            {COLUMN_TYPES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>

        <label className="cb-set-column">
          <span className="cal-field-label">Second column measures</span>
          <select
            className="rd-select"
            aria-label="Second column measures"
            value={columnB}
            disabled={!pairValid}
            onChange={(e) => onColumnChange('b', e.target.value)}
          >
            {availableSecondColumns(columnA).map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!pairValid && (
        <p className="cb-note">Two columns cannot measure the same thing — pick another for the second.</p>
      )}

      <ol className="cb-set-rows">
        {sets.map((s, i) => (
          <li key={s.id} className="cb-set-row">
            <span className="cb-set-n">{i + 1}</span>
            <input
              type="text"
              value={s.a}
              placeholder={placeholderFor(columnA)}
              aria-label={`Set ${i + 1} ${placeholderFor(columnA)}`}
              onChange={(e) => patch(s.id, 'a', e.target.value)}
            />
            <input
              type="text"
              value={s.b}
              placeholder={placeholderFor(columnB)}
              aria-label={`Set ${i + 1} ${placeholderFor(columnB)}`}
              onChange={(e) => patch(s.id, 'b', e.target.value)}
            />
            <button
              type="button"
              className="cb-block-remove"
              aria-label={`Remove set ${i + 1}`}
              onClick={() => onSetsChange(sets.filter((x) => x.id !== s.id))}
            >
              ×
            </button>
          </li>
        ))}
      </ol>

      <button
        type="button"
        className="cb-add-btn ghost"
        onClick={() => onSetsChange([...sets, { id: `${sets.length}-${Date.now()}`, a: '', b: '' }])}
      >
        + Add set
      </button>
    </div>
  );
}
