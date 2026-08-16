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

  const addSet = () =>
    onSetsChange([...sets, { id: `${sets.length}-${Date.now()}`, a: '', b: '' }]);
  const dropLast = () => onSetsChange(sets.slice(0, -1));

  return (
    <div className="cb-sets-table">
      <div className="cb-sets-head">
        <span>Set</span>

        <div className="cb-col-head">
          <select
            className="cb-col-select"
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
        </div>

        <div className="cb-col-head">
          <select
            /* `.conflict` is the stylesheet's own name for a column that
               cannot be used — it greys the control rather than removing it,
               so the coach can see WHICH one is blocked and change the other. */
            className={`cb-col-select${pairValid ? '' : ' conflict'}`}
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
        </div>
      </div>

      {/*
        * `role="alert"` because this appears in response to a change the coach
        * just made, and a screen reader would otherwise never mention it — the
        * second select going quietly disabled is the only other signal, and a
        * disabled control announces nothing about WHY.
        */}
      {!pairValid && (
        <p className="cb-note" role="alert">
          Two columns cannot measure the same thing — pick another for the second.
        </p>
      )}

      <div className="cb-sets-rows">
        {sets.map((s, i) => (
          <div key={s.id} className="cb-set-row">
            {/* `.n`, not `.cb-set-n`. The stylesheet styles the number as
                `.cb-set-row .n` — a gold circle chip — and the invented class
                name meant it rendered as bare text for as long as it existed. */}
            <span className="n">{i + 1}</span>
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
              disabled={!pairValid}
              className={pairValid ? undefined : 'conflict'}
              aria-label={`Set ${i + 1} ${placeholderFor(columnB)}`}
              onChange={(e) => patch(s.id, 'b', e.target.value)}
            />
          </div>
        ))}
      </div>

      {/*
        * ONE PAIR OF CONTROLS FOR THE WHOLE EXERCISE, not a remove button per
        * row. The grid is three columns wide — number, value, value — so the
        * per-row `×` this replaces was a fourth child with no cell to sit in,
        * and wrapped underneath its own row.
        *
        * It also matches how a coach thinks about it: sets of one exercise are
        * interchangeable until they are filled in, so "three or four sets" is
        * the question, not "delete the second one".
        */}
      <div className="cb-sets-actions">
        <button
          type="button"
          className="cb-set-remove"
          aria-label="Remove a set"
          disabled={sets.length <= 1}
          onClick={dropLast}
        >
          −
        </button>
        {/* The bare word, as the mockup has it. The COUNT lives on the row's
            `.cb-sets-pill` and only there — printing it twice on one screen is
            two things to keep in step for no gain. */}
        <span>Sets</span>
        <button type="button" className="cb-set-add" aria-label="Add a set" onClick={addSet}>
          +
        </button>
      </div>
    </div>
  );
}
