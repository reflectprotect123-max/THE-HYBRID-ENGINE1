import { useState } from 'react';
import type { CatalogueEntry } from '@hybrid/engine';
import type { BlockExercise } from './BlockEditor';
import type { SetRow } from './SetRows';
import { ExercisePicker } from './ExercisePicker';

/** Ninety seconds — the app's own default rest, unchanged from before this file existed. */
export const DEFAULT_REST_SEC = 90;

/** Two and a half minutes — the EMOM default, unchanged. */
export const DEFAULT_EVERY_SEC = 150;

/** "2:30", the way a coach writes an interval. */
export function fmtEvery(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * What the wizard's Measure step offers, standing in for a raw `columnA`/
 * `columnB` pair. There is no server-side `Measure` type — this is a UI
 * vocabulary over `@hybrid/engine`'s `COLUMN_TYPES`, the same relationship
 * `SetRows.tsx`'s dropdowns already have to it.
 */
export type Measure = 'reps_weight' | 'reps' | 'seconds' | 'distance';

export const MEASURES: { key: Measure; glyph: string; name: string; sub: string; columnA: string; columnB: string }[] = [
  { key: 'reps_weight', glyph: '⚖', name: 'Reps + Weight', sub: 'most strength work', columnA: 'reps', columnB: 'weight_kg' },
  { key: 'reps', glyph: '💪', name: 'Reps only', sub: 'bodyweight', columnA: 'reps', columnB: '' },
  { key: 'seconds', glyph: '⏱', name: 'Seconds', sub: 'holds, planks', columnA: 'seconds', columnB: '' },
  { key: 'distance', glyph: '📏', name: 'Distance', sub: 'sled, carries', columnA: 'meters', columnB: '' },
];

/** The reverse of a `MEASURES` lookup — reading a stored exercise's columns back into a Measure, for editing. */
export function measureFor(columnA: string, columnB: string): Measure {
  const found = MEASURES.find((m) => m.columnA === columnA && m.columnB === columnB);
  if (found) return found.key;
  if (columnA === 'seconds') return 'seconds';
  if (columnA === 'meters') return 'distance';
  return 'reps';
}

/** The shape of the exercise the wizard last committed in THIS block — defaults for the next ADD only, never for an edit. */
export interface WizardShape {
  measure: Measure;
  sets: number;
  a: string;
  b: string;
}

/**
 * What the wizard commits on Review (Task 4) — the same shape `BlockExercise`
 * already carries, minus `id` (assigned by the caller for a new exercise, kept
 * as-is for an edit).
 */
export interface WizardResult {
  id?: string;
  name: string;
  columnA: string;
  columnB: string;
  rest: number;
  every?: number;
  tempo?: string;
  sets: SetRow[];
}

export interface ExerciseWizardProps {
  entries: CatalogueEntry[];
  initial?: BlockExercise;
  lastShape?: WizardShape;
  onCreateMovement?: (name: string) => void;
  onSave: (result: WizardResult, shape: WizardShape) => void;
  onCancel: () => void;
}

type Step = 'exercise' | 'measure' | 'sets' | 'values' | 'review';
const STEP_ORDER: Step[] = ['exercise', 'measure', 'sets', 'values', 'review'];
const STEP_LABEL: Record<Step, string> = { exercise: 'Exercise', measure: 'Measure', sets: 'Sets', values: 'Values', review: 'Review' };

/** 'rest' = plain rest between sets, 'every' = EMOM — see `Exercise.every`. */
type Pacing = 'rest' | 'every';

interface Draft {
  name: string;
  measure: Measure;
  sets: number;
  a: string;
  b: string;
  rest: number;
  pacing: Pacing;
  every: number;
  tempo: string;
  rpe: string;
}

function initialDraft(initial?: BlockExercise, lastShape?: WizardShape): Draft {
  if (initial) {
    const rpeValues = new Set(initial.sets.map((s) => (s.rpe ?? '').trim()));
    return {
      name: initial.name,
      measure: measureFor(initial.columnA, initial.columnB),
      sets: initial.sets.length || 3,
      a: initial.sets[0]?.a ?? '',
      b: initial.sets[0]?.b ?? '',
      rest: initial.rest,
      pacing: (initial.every ?? 0) > 0 ? 'every' : 'rest',
      every: initial.every && initial.every > 0 ? initial.every : DEFAULT_EVERY_SEC,
      tempo: initial.tempo ?? '',
      rpe: rpeValues.size <= 1 ? [...rpeValues][0] ?? '' : '',
    };
  }
  return {
    name: '',
    measure: lastShape?.measure ?? 'reps_weight',
    sets: lastShape?.sets ?? 3,
    a: lastShape?.a ?? '',
    b: lastShape?.b ?? '',
    rest: DEFAULT_REST_SEC,
    pacing: 'rest',
    every: DEFAULT_EVERY_SEC,
    tempo: '',
    rpe: '',
  };
}

function shapeSummary(draft: Draft): string {
  if (draft.measure === 'reps_weight') return `${draft.sets} × ${draft.a} @ ${draft.b}kg`;
  if (draft.measure === 'seconds') return `${draft.sets} × ${draft.a}s`;
  if (draft.measure === 'distance') return `${draft.sets} × ${draft.a}m`;
  return `${draft.sets} × ${draft.a}`;
}

/**
 * The guided one-question-at-a-time flow that replaces the always-expanded
 * exercise form (see `docs/superpowers/specs/2026-08-16-exercise-wizard-design.md`).
 * This task carries only the first two of five steps — Exercise and Measure —
 * plus the history-stack navigation every later step reuses. `onSave` is not
 * called yet: there is no Review step to build a `WizardResult` from until
 * Task 4.
 */
export function ExerciseWizard({ entries, initial, lastShape, onCreateMovement, onSave, onCancel }: ExerciseWizardProps) {
  const [history, setHistory] = useState<Step[]>(['exercise']);
  const [draft, setDraft] = useState<Draft>(() => initialDraft(initial, lastShape));
  /**
   * Whether the coach actually clicked a Measure tile during THIS edit. Used
   * only when `initial` is set and its `columnA`/`columnB` pair is not one
   * `MEASURES` can represent (`weight_pct`, `reps_range`, and so on) — see
   * `commit()`. Without this, opening the wizard on such an exercise and
   * saving without ever visiting Measure would silently rewrite its columns
   * to whatever `measureFor` fell back to.
   */
  const [measureTouched, setMeasureTouched] = useState(false);
  /**
   * A stable per-mount id for a brand-new exercise's set rows, so two new
   * exercises added to the same block don't collide on `new-s0`/`new-s1`/….
   * `BlockEditor.handleWizardSave` assigns the exercise's real id separately
   * — this only has to be unique among the sets of ONE new exercise's own
   * commit, which a fresh mount already guarantees.
   */
  const [newExerciseId] = useState(
    () => `new-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  );

  const step = history[history.length - 1];
  const idx = STEP_ORDER.indexOf(step);

  function patch(next: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...next }));
  }

  function push(s: Step) {
    setHistory((h) => [...h, s]);
  }

  function back() {
    if (history.length > 1) setHistory((h) => h.slice(0, -1));
    else onCancel();
  }

  function goToReview() {
    setHistory((h) => (h.includes('review') ? h : [...h, 'review']));
  }

  function commit() {
    const opt = MEASURES.find((m) => m.key === draft.measure)!;

    /*
     * COLUMNS: don't let the wizard's Measure vocabulary silently overwrite a
     * column pair it cannot represent (weight_pct, reps_range, …) unless the
     * coach actually chose a Measure tile this edit. `measureFor` maps such a
     * pair to a representable fallback (usually 'reps') purely so the wizard
     * has SOMETHING to show pre-selected — that fallback was never meant to
     * be written back on a save the coach never touched.
     */
    let columnA = opt.columnA;
    let columnB = opt.columnB;
    if (initial && !measureTouched) {
      const representable = MEASURES.some((m) => m.columnA === initial.columnA && m.columnB === initial.columnB);
      if (!representable) {
        columnA = initial.columnA;
        columnB = initial.columnB;
      }
    }

    /*
     * SETS: the wizard's Values step edits one shared a/b (and one shared
     * RPE) for the whole exercise, which is fine for authoring but destroys a
     * genuine wave (different loads per set), individual `warm` ramp-set
     * flags, and per-set RPE the instant it REPLACES the array wholesale. If
     * the coach didn't change the set COUNT, merge the shared values onto the
     * existing rows instead — a real wave/warm-up split still has to go
     * through the block's own set-row escape hatch (`SetRows`) rather than
     * the wizard, but at minimum committing the wizard without touching Sets
     * must not erase what was already there. A set-count change has no
     * existing rows to preserve column-for-column, so it still rebuilds.
     */
    let sets: SetRow[];
    if (initial && draft.sets === initial.sets.length) {
      sets = initial.sets.map((s) => ({
        ...s,
        a: draft.a,
        b: draft.b,
        rpe: draft.rpe ? draft.rpe : s.rpe,
      }));
    } else {
      const rowId = (i: number) => `${initial?.id ?? newExerciseId}-s${i}`;
      sets = Array.from({ length: draft.sets }, (_, i) => ({
        id: rowId(i), a: draft.a, b: draft.b, ...(draft.rpe ? { rpe: draft.rpe } : {}),
      }));
    }

    /*
     * `every`/`tempo` are ALWAYS emitted (as a value or explicit `undefined`)
     * rather than only when truthy, so `BlockEditor.handleWizardSave`'s
     * `{ ...e, ...result }` merge actually CLEARS a value the coach blanked
     * out or switched off — an absent key there is indistinguishable from
     * "the wizard has no opinion", so the old exercise's value survived every
     * save whether or not the coach meant to keep it.
     */
    const result: WizardResult = {
      ...(initial ? { id: initial.id } : {}),
      name: draft.name,
      columnA,
      columnB,
      rest: draft.rest,
      every: draft.pacing === 'every' ? (draft.every > 0 ? draft.every : DEFAULT_EVERY_SEC) : undefined,
      tempo: draft.tempo.trim() ? draft.tempo.trim() : undefined,
      sets,
    };
    onSave(result, { measure: draft.measure, sets: draft.sets, a: draft.a, b: draft.b });
  }

  return (
    <div className="cb-wizard">
      <div className="cb-wizard-topbar">
        <button type="button" className="cb-wizard-back" onClick={back}>
          &larr; {step === 'exercise' ? 'Back to block' : 'Back'}
        </button>
        {step !== 'exercise' && step !== 'review' && (
          <button type="button" className="cb-wizard-skip" onClick={goToReview}>Skip to review</button>
        )}
      </div>
      <div className="cb-wizard-progress-track">
        <div className="cb-wizard-progress-fill" style={{ width: `${((idx + 1) / STEP_ORDER.length) * 100}%` }} />
      </div>
      <p className="cb-wizard-stepcount">{idx + 1} of {STEP_ORDER.length} &middot; {STEP_LABEL[step]}</p>

      {step === 'exercise' && (
        <div className="cb-wizard-step">
          <h1>What are they doing?</h1>
          {draft.name && (
            <input
              type="text"
              className="cb-wizard-selected-name"
              aria-label="Selected exercise"
              value={draft.name}
              readOnly
            />
          )}
          <ExercisePicker
            entries={entries}
            open
            onPick={(name) => patch({ name })}
            onNewExercise={(name) => {
              onCreateMovement?.(name);
              patch({ name });
            }}
            onDone={() => {}}
          />
          <div className="cb-wizard-btn-row">
            <span />
            <button type="button" className="cb-wizard-btn cb-wizard-btn-brass" disabled={!draft.name} onClick={() => push('measure')}>
              Next
            </button>
          </div>
        </div>
      )}

      {step === 'measure' && (
        <div className="cb-wizard-step">
          <h1>What are you tracking?</h1>
          <div className="cb-wizard-glyph-grid">
            {MEASURES.map((m) => (
              <button
                key={m.key}
                type="button"
                className={`cb-wizard-glyph-tile${draft.measure === m.key ? ' on' : ''}`}
                aria-label={m.name}
                onClick={() => {
                  patch({ measure: m.key });
                  setMeasureTouched(true);
                }}
              >
                <span className="glyph">{m.glyph}</span>
                <span className="name">{m.name}</span>
                <span className="sub">{m.sub}</span>
              </button>
            ))}
          </div>
          <div className="cb-wizard-btn-row">
            <button type="button" className="cb-wizard-btn" onClick={back}>Back</button>
            <button type="button" className="cb-wizard-btn cb-wizard-btn-brass" onClick={() => push('sets')}>Next</button>
          </div>
        </div>
      )}

      {step === 'sets' && (
        <div className="cb-wizard-step">
          <h1>How many sets?</h1>
          <div className="cb-wizard-stepper-row">
            <button type="button" aria-label="One fewer set" onClick={() => patch({ sets: Math.max(1, draft.sets - 1) })}>&minus;</button>
            <span className="num">{draft.sets}</span>
            <button type="button" aria-label="One more set" onClick={() => patch({ sets: Math.min(20, draft.sets + 1) })}>+</button>
          </div>
          <div className="cb-wizard-btn-row">
            <button type="button" className="cb-wizard-btn" onClick={back}>Back</button>
            <button type="button" className="cb-wizard-btn cb-wizard-btn-brass" onClick={() => push('values')}>Next</button>
          </div>
        </div>
      )}

      {step === 'values' && (
        <div className="cb-wizard-step">
          <h1>{draft.sets} sets of&hellip;</h1>
          <span className="cb-wizard-field-label">{draft.measure === 'seconds' ? 'Seconds' : draft.measure === 'distance' ? 'Metres' : 'Reps'}</span>
          <div className="cb-wizard-chip-row">
            {['5', '8', '10', '12', 'max'].map((r) => (
              <button
                key={r}
                type="button"
                className={`cb-wizard-chip${draft.a === r ? ' on' : ''}`}
                onClick={() => patch({ a: r })}
              >
                {r}
              </button>
            ))}
          </div>
          <label className="cb-wizard-sr-only" htmlFor="wizard-values-custom">Custom value</label>
          <input
            id="wizard-values-custom"
            className="cb-wizard-custom-input"
            placeholder="or a custom value"
            value={['5', '8', '10', '12', 'max'].includes(draft.a) ? '' : draft.a}
            onChange={(e) => patch({ a: e.target.value })}
          />
          {draft.measure === 'reps_weight' && (
            <div className="cb-wizard-weight-row">
              <label className="cb-wizard-sr-only" htmlFor="wizard-values-weight">Weight in kilograms</label>
              <input
                id="wizard-values-weight"
                className="cb-wizard-custom-input"
                inputMode="decimal"
                aria-label="Weight in kilograms"
                value={draft.b}
                onChange={(e) => patch({ b: e.target.value })}
              />
              <span className="cb-wizard-weight-unit">kg</span>
            </div>
          )}
          <div className="cb-wizard-btn-row">
            <button type="button" className="cb-wizard-btn" onClick={back}>Back</button>
            <button type="button" className="cb-wizard-btn cb-wizard-btn-brass" onClick={() => push('review')}>Next</button>
          </div>
        </div>
      )}

      {step === 'review' && (
        <div className="cb-wizard-step">
          <h1>Look right?</h1>
          <div className="cb-wizard-review-card">
            <div className="cb-wizard-review-head">
              <span className="ex-name">{draft.name}</span>
              <span className="ex-shape">{shapeSummary(draft)}</span>
            </div>
            <div className="cb-wizard-review-extra">
              <label className="cell">
                <span>Pacing</span>
                <select
                  aria-label="Pacing"
                  value={draft.pacing}
                  onChange={(e) => patch({ pacing: e.target.value as Pacing })}
                >
                  <option value="rest">Rest between sets</option>
                  <option value="every">Every — EMOM</option>
                </select>
              </label>
              {draft.pacing === 'every' ? (
                <label className="cell">
                  <span>Every</span>
                  <input
                    aria-label="Every, in seconds"
                    type="number"
                    min={0}
                    value={draft.every}
                    onChange={(e) => patch({ every: Math.max(0, Number(e.target.value) || 0) })}
                  />
                </label>
              ) : (
                <label className="cell">
                  <span>Rest</span>
                  <input aria-label="Rest in seconds" type="number" min={0} value={draft.rest} onChange={(e) => patch({ rest: Math.max(0, Number(e.target.value) || 0) })} />
                </label>
              )}
              <label className="cell">
                <span>Target RPE</span>
                <input aria-label="Target RPE" placeholder="8, or 7–10" value={draft.rpe} onChange={(e) => patch({ rpe: e.target.value })} />
              </label>
              <label className="cell">
                <span>Tempo</span>
                <input aria-label="Tempo" placeholder="e.g. 3-1-1-0" value={draft.tempo} onChange={(e) => patch({ tempo: e.target.value })} />
              </label>
            </div>
            <p className="cb-note">
              {draft.pacing === 'every'
                ? `${fmtEvery(draft.every)} × ${draft.sets} sets — each set starts on the clock, so a slower set gets less rest.`
                : 'The countdown starts when the set ends.'}
            </p>
          </div>
          <div className="cb-wizard-btn-row">
            <button type="button" className="cb-wizard-btn" onClick={back}>Back</button>
            <button type="button" className="cb-wizard-btn cb-wizard-btn-brass" onClick={commit}>Add exercise</button>
          </div>
        </div>
      )}
    </div>
  );
}
