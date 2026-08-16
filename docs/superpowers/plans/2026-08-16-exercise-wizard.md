# Exercise Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the coach bench's flat, all-fields-at-once exercise editor
with a guided, one-question-per-screen wizard for adding and editing an
exercise inside a Strength/Power (or other non-conditioning) block.

**Architecture:** One new component, `ExerciseWizard.tsx`, owns a five-step
sequence (Exercise → Measure → Sets → Values → Review) and emits a plain
`BlockExercise`-shaped object on commit. `BlockEditor.tsx` stops rendering
`ExercisePicker` and an always-expanded `ExerciseItem` detail body inline;
instead it opens the wizard (for a new exercise, or pre-filled for an
existing one) and folds whatever it returns into `block.exercises`, exactly
as `onChange`/`patchExercise` do today. No change to `BlockExercise`,
`SetRow`, `CondValue`, or any Supabase/day-workout serialization — this is
purely a new way to arrive at data those already accept.

**Tech Stack:** React 18 (function components, hooks only), TypeScript,
Vitest + `@testing-library/react` for tests, plain CSS in
`coach-redesign.css` (no CSS-in-JS, no Tailwind in this app).

## Global Constraints

- Conditioning blocks (`CondBlockFields`, `CondValue`) are a **hard
  exclusion** — do not touch, restructure, or fold them into the wizard.
  (Design spec, "What this deliberately does not do".)
- No data-model change: `BlockExercise`, `SetRow`, `NONE_COLUMN` keep their
  current shapes exactly. (Design spec, "Implementation notes".)
- Every interactive control (tile, chip, stepper button, pick-row) must have
  a minimum 44×44px touch target. (Design spec, "Presentation".)
- The wizard is one component at both 420px and 1440px — no separate mobile
  layout. (Design spec, "Presentation"; CLAUDE.md, "coach workspace is
  desktop-first, phone is a supported viewport".)
- Tests are colocated: `ExerciseWizard.tsx` is tested by
  `ExerciseWizard.test.tsx` in the same directory. (CLAUDE.md, "Where a test
  goes".)
- Run `pnpm run typecheck`, the targeted Vitest files, and
  `node checks/screens.mjs` before considering any task done; run
  `pnpm run verify` before the final commit. (CLAUDE.md, "Safe workflow".)

---

## File Structure

- **Create** `apps/web/src/coach/library/ExerciseWizard.tsx` — the wizard
  component, its step logic, and the `Measure`/`WizardShape`/`WizardResult`
  types. Also becomes the new home of `DEFAULT_REST_SEC`, `DEFAULT_EVERY_SEC`,
  and `fmtEvery` (moved from `BlockEditor.tsx`, which re-exports them so
  `day-workout.ts`'s existing `import { DEFAULT_REST_SEC } from './BlockEditor'`
  keeps working unchanged).
- **Create** `apps/web/src/coach/library/ExerciseWizard.test.tsx` — colocated
  tests.
- **Modify** `apps/web/src/coach/library/BlockEditor.tsx` — `ExerciseItem`
  loses its own expand/detail body (`useState`, `.cb-exp`, the pacing/RPE/
  tempo fields, `<SetRows>`) and becomes a plain clickable row; `BlockEditor`
  gains wizard-open state, a `lastShape` per block, and a save handler that
  replaces `addExercise`/`patchExercise`'s direct callers.
- **Modify** `apps/web/src/coach/library/BlockEditor.test.tsx` — tests that
  exercised the old expand-in-place behaviour move to
  `ExerciseWizard.test.tsx`; `BlockEditor.test.tsx` keeps only "clicking a row
  opens the wizard" / "the wizard's result lands in the block" coverage.
- **Modify** `apps/web/src/coach/coach-redesign.css` — new `.cb-wizard-*`
  rules for the full-screen overlay, glyph tiles, chip presets, and steppers.
  No existing rule is removed except the ones that only ever styled
  `ExerciseItem`'s old `.cb-exp` inline body (`.cb-pace`, `.cb-pace-note`).

---

## Task 1: Wizard types, step order, and the Measure catalogue

**Files:**
- Create: `apps/web/src/coach/library/ExerciseWizard.tsx`
- Test: `apps/web/src/coach/library/ExerciseWizard.test.tsx`

**Interfaces:**
- Produces: `export type Measure = 'reps_weight' | 'reps' | 'seconds' | 'distance';`
  `export interface WizardShape { measure: Measure; sets: number; a: string; b: string; }`
  `export function measureFor(columnA: string, columnB: string): Measure`
  `export const MEASURES: { key: Measure; glyph: string; name: string; sub: string; columnA: string; columnB: string }[]`
  `export const DEFAULT_REST_SEC = 90;`
  `export const DEFAULT_EVERY_SEC = 150;`
  `export function fmtEvery(seconds: number): string`

- [ ] **Step 1: Write the failing test for `measureFor`**

```tsx
// apps/web/src/coach/library/ExerciseWizard.test.tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { measureFor, MEASURES, fmtEvery, DEFAULT_REST_SEC, DEFAULT_EVERY_SEC } from './ExerciseWizard';

describe('measureFor', () => {
  it('reads reps + weight_kg as reps_weight', () => {
    expect(measureFor('reps', 'weight_kg')).toBe('reps_weight');
  });

  it('reads reps with no second column as reps', () => {
    expect(measureFor('reps', '')).toBe('reps');
  });

  it('reads seconds as seconds regardless of the second column', () => {
    expect(measureFor('seconds', '')).toBe('seconds');
  });

  it('reads meters as distance', () => {
    expect(measureFor('meters', '')).toBe('distance');
  });

  it('falls back to reps for an unrecognised pair', () => {
    expect(measureFor('weight_pct', '')).toBe('reps');
  });
});

describe('MEASURES', () => {
  it('has exactly the four measures the wizard offers, each mapping to a real column pair', () => {
    expect(MEASURES.map((m) => m.key)).toEqual(['reps_weight', 'reps', 'seconds', 'distance']);
    expect(MEASURES.find((m) => m.key === 'reps_weight')).toMatchObject({ columnA: 'reps', columnB: 'weight_kg' });
    expect(MEASURES.find((m) => m.key === 'distance')).toMatchObject({ columnA: 'meters', columnB: '' });
  });
});

describe('fmtEvery', () => {
  it('formats seconds as minutes:seconds, matching the prescription card', () => {
    expect(fmtEvery(150)).toBe('2:30');
    expect(fmtEvery(65)).toBe('1:05');
  });
});

describe('defaults', () => {
  it('keeps the ninety-second rest and two-and-a-half-minute EMOM defaults', () => {
    expect(DEFAULT_REST_SEC).toBe(90);
    expect(DEFAULT_EVERY_SEC).toBe(150);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/library/ExerciseWizard.test.tsx`
Expected: FAIL — `ExerciseWizard.tsx` does not exist yet.

- [ ] **Step 3: Write the minimal implementation**

```tsx
// apps/web/src/coach/library/ExerciseWizard.tsx
import type { CatalogueEntry } from '@hybrid/engine';
import type { BlockExercise } from './BlockEditor';
import type { SetRow } from './SetRows';

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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/library/ExerciseWizard.test.tsx`
Expected: PASS (5 + 2 + 1 + 1 = 9 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/coach/library/ExerciseWizard.tsx apps/web/src/coach/library/ExerciseWizard.test.tsx
git commit -m "Add Exercise Wizard's Measure vocabulary and shared constants"
```

---

## Task 2: Exercise and Measure steps, with real navigation

**Files:**
- Modify: `apps/web/src/coach/library/ExerciseWizard.tsx`
- Test: `apps/web/src/coach/library/ExerciseWizard.test.tsx`

**Interfaces:**
- Consumes: `ExercisePicker` from `./ExercisePicker` (props unchanged:
  `entries`, `open`, `onPick`, `onNewExercise`, `onDone`); `Measure`,
  `MEASURES`, `measureFor` from Task 1.
- Produces: `export function ExerciseWizard(props: ExerciseWizardProps): JSX.Element`
  where
  ```ts
  export interface ExerciseWizardProps {
    entries: CatalogueEntry[];
    initial?: BlockExercise;
    lastShape?: WizardShape;
    onCreateMovement?: (name: string) => void;
    onSave: (result: WizardResult, shape: WizardShape) => void;
    onCancel: () => void;
  }
  ```
  (`WizardResult` is introduced in Task 4, once Review can build one — for
  this task and Task 3 the component holds draft state and does not yet call
  `onSave`.)

- [ ] **Step 1: Write the failing test for step 1 and 2 navigation**

```tsx
// append to apps/web/src/coach/library/ExerciseWizard.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { ExerciseWizard } from './ExerciseWizard';

const ENTRIES = [
  { name: 'Back Squat', tags: ['Barbell'], uses: 3 },
  { name: 'Pull-Up', tags: ['Bodyweight'], uses: 1 },
];

function renderWizard(over: Partial<Parameters<typeof ExerciseWizard>[0]> = {}) {
  const props = { entries: ENTRIES, onSave: vi.fn(), onCancel: vi.fn(), ...over };
  render(<ExerciseWizard {...props} />);
  return props;
}

describe('ExerciseWizard — steps 1 and 2', () => {
  it('opens on the Exercise step and shows the library picker', () => {
    renderWizard();
    expect(screen.getByText('What are they doing?')).toBeInTheDocument();
    expect(screen.getByText('Back Squat')).toBeInTheDocument();
  });

  it('advances to Measure once an exercise is picked and Next is pressed', () => {
    renderWizard();
    fireEvent.click(screen.getByText('Back Squat'));
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    expect(screen.getByText('What are you tracking?')).toBeInTheDocument();
  });

  it('disables Next on the Exercise step until something is picked', () => {
    renderWizard();
    expect(screen.getByRole('button', { name: /^next$/i })).toBeDisabled();
  });

  it('defaults Measure to Reps + Weight, matching most strength work', () => {
    renderWizard();
    fireEvent.click(screen.getByText('Back Squat'));
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    expect(screen.getByRole('button', { name: /Reps \+ Weight/ })).toHaveClass('on');
  });

  it('picking a different measure tile updates the selection', () => {
    renderWizard();
    fireEvent.click(screen.getByText('Back Squat'));
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    fireEvent.click(screen.getByRole('button', { name: /Seconds/ }));
    expect(screen.getByRole('button', { name: /Seconds/ })).toHaveClass('on');
    expect(screen.getByRole('button', { name: /Reps \+ Weight/ })).not.toHaveClass('on');
  });

  it('Back from Measure returns to Exercise with the pick remembered', () => {
    renderWizard();
    fireEvent.click(screen.getByText('Back Squat'));
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^back$/i }));
    expect(screen.getByText('What are they doing?')).toBeInTheDocument();
  });

  it('Back from the Exercise step calls onCancel with nothing added', () => {
    const props = renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /back to block/i }));
    expect(props.onCancel).toHaveBeenCalled();
  });

  it('pre-fills the exercise and measure from `initial` when editing', () => {
    renderWizard({
      initial: {
        id: 'e1', name: 'Front Squat', columnA: 'seconds', columnB: '', rest: 90,
        sets: [{ id: 'e1-s0', a: '20', b: '' }],
      },
    });
    expect(screen.getByDisplayValue('Front Squat')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    expect(screen.getByRole('button', { name: /Seconds/ })).toHaveClass('on');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/library/ExerciseWizard.test.tsx`
Expected: FAIL — `ExerciseWizard` export is not a component yet.

- [ ] **Step 3: Write the minimal implementation**

Append to `apps/web/src/coach/library/ExerciseWizard.tsx`:

```tsx
import { useState } from 'react';
import { ExercisePicker } from './ExercisePicker';

type Step = 'exercise' | 'measure' | 'sets' | 'values' | 'review';
const STEP_ORDER: Step[] = ['exercise', 'measure', 'sets', 'values', 'review'];
const STEP_LABEL: Record<Step, string> = { exercise: 'Exercise', measure: 'Measure', sets: 'Sets', values: 'Values', review: 'Review' };

interface Draft {
  name: string;
  measure: Measure;
  sets: number;
  a: string;
  b: string;
}

function initialDraft(initial?: BlockExercise, lastShape?: WizardShape): Draft {
  if (initial) {
    return {
      name: initial.name,
      measure: measureFor(initial.columnA, initial.columnB),
      sets: initial.sets.length || 3,
      a: initial.sets[0]?.a ?? '',
      b: initial.sets[0]?.b ?? '',
    };
  }
  return {
    name: '',
    measure: lastShape?.measure ?? 'reps_weight',
    sets: lastShape?.sets ?? 3,
    a: lastShape?.a ?? '',
    b: lastShape?.b ?? '',
  };
}

export function ExerciseWizard({ entries, initial, lastShape, onCreateMovement, onSave, onCancel }: ExerciseWizardProps) {
  const [history, setHistory] = useState<Step[]>(['exercise']);
  const [draft, setDraft] = useState<Draft>(() => initialDraft(initial, lastShape));

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

  return (
    <div className="cb-wizard">
      <div className="cb-wizard-topbar">
        <button type="button" className="cb-wizard-back" onClick={back}>
          &larr; {step === 'exercise' ? 'Back to block' : 'Back'}
        </button>
      </div>
      <div className="cb-wizard-progress-track">
        <div className="cb-wizard-progress-fill" style={{ width: `${((idx + 1) / STEP_ORDER.length) * 100}%` }} />
      </div>
      <p className="cb-wizard-stepcount">{idx + 1} of {STEP_ORDER.length} &middot; {STEP_LABEL[step]}</p>

      {step === 'exercise' && (
        <div className="cb-wizard-step">
          <h1>What are they doing?</h1>
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
                onClick={() => patch({ measure: m.key })}
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
    </div>
  );
}
```

Add the `WizardResult` placeholder type and `ExerciseWizardProps` interface
(used by the JSX above) near the top of the file, below `WizardShape`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/library/ExerciseWizard.test.tsx`
Expected: PASS (17 tests: 9 from Task 1 + 8 new)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/coach/library/ExerciseWizard.tsx apps/web/src/coach/library/ExerciseWizard.test.tsx
git commit -m "Add ExerciseWizard's Exercise and Measure steps"
```

---

## Task 3: Sets and Values steps

**Files:**
- Modify: `apps/web/src/coach/library/ExerciseWizard.tsx`
- Test: `apps/web/src/coach/library/ExerciseWizard.test.tsx`

**Interfaces:**
- Consumes: `draft.sets`, `draft.measure`, `draft.a`, `draft.b` from Task 2's
  `Draft`.
- Produces: nothing new externally — extends the same `ExerciseWizard`.

- [ ] **Step 1: Write the failing test**

```tsx
// append to apps/web/src/coach/library/ExerciseWizard.test.tsx
function toValues(container = document) {
  fireEvent.click(screen.getByText('Back Squat'));
  fireEvent.click(screen.getByRole('button', { name: /^next$/i })); // -> measure
  fireEvent.click(screen.getByRole('button', { name: /^next$/i })); // -> sets
}

describe('ExerciseWizard — Sets and Values', () => {
  it('starts Sets at 3 and steps with +/-', () => {
    renderWizard();
    toValues();
    expect(screen.getByText('3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /one more set/i }));
    expect(screen.getByText('4')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /one fewer set/i }));
    fireEvent.click(screen.getByRole('button', { name: /one fewer set/i }));
    fireEvent.click(screen.getByRole('button', { name: /one fewer set/i }));
    expect(screen.getByText('1')).toBeInTheDocument(); // floor at 1, not 0
  });

  it('advancing from Sets to Values shows reps presets for Reps + Weight, plus a weight field', () => {
    renderWizard();
    toValues();
    fireEvent.click(screen.getByRole('button', { name: /^next$/i })); // -> values
    expect(screen.getByRole('button', { name: '8' })).toBeInTheDocument();
    expect(screen.getByLabelText(/weight in kilograms/i)).toBeInTheDocument();
  });

  it('hides the weight field for Reps only', () => {
    renderWizard();
    fireEvent.click(screen.getByText('Back Squat'));
    fireEvent.click(screen.getByRole('button', { name: /^next$/i })); // -> measure
    fireEvent.click(screen.getByRole('button', { name: /Reps only/ }));
    fireEvent.click(screen.getByRole('button', { name: /^next$/i })); // -> sets
    fireEvent.click(screen.getByRole('button', { name: /^next$/i })); // -> values
    expect(screen.queryByLabelText(/weight in kilograms/i)).not.toBeInTheDocument();
  });

  it('picking a reps preset sets the shared value and clears the custom box', () => {
    renderWizard();
    toValues();
    fireEvent.click(screen.getByRole('button', { name: /^next$/i })); // -> values
    fireEvent.click(screen.getByRole('button', { name: '10' }));
    expect(screen.getByRole('button', { name: '10' })).toHaveClass('on');
  });

  it('typing a custom value overrides the presets', () => {
    renderWizard();
    toValues();
    fireEvent.click(screen.getByRole('button', { name: /^next$/i })); // -> values
    fireEvent.change(screen.getByLabelText(/custom value/i), { target: { value: '8-12' } });
    expect(screen.queryAllByRole('button', { name: /^(5|8|10|12|max)$/ }).some((b) => b.classList.contains('on'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/library/ExerciseWizard.test.tsx`
Expected: FAIL — Sets/Values steps not rendered.

- [ ] **Step 3: Write the minimal implementation**

Insert into the `ExerciseWizard` return, after the `measure` block:

```tsx
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/library/ExerciseWizard.test.tsx`
Expected: PASS (22 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/coach/library/ExerciseWizard.tsx apps/web/src/coach/library/ExerciseWizard.test.tsx
git commit -m "Add ExerciseWizard's Sets and Values steps"
```

---

## Task 4: Review step, skip-to-review, and commit (`onSave`)

**Files:**
- Modify: `apps/web/src/coach/library/ExerciseWizard.tsx`
- Test: `apps/web/src/coach/library/ExerciseWizard.test.tsx`

**Interfaces:**
- Consumes: `newSetRows` is NOT used here — the wizard builds its own
  `SetRow[]` from the shared `draft.a`/`draft.b`, one row per `draft.sets`.
- Produces: the wizard now actually calls `props.onSave(result, shape)` —
  this is the first task where `onSave` fires.

- [ ] **Step 1: Write the failing test**

```tsx
// append to apps/web/src/coach/library/ExerciseWizard.test.tsx
function toReview() {
  fireEvent.click(screen.getByText('Back Squat'));
  fireEvent.click(screen.getByRole('button', { name: /^next$/i })); // -> measure
  fireEvent.click(screen.getByRole('button', { name: /^next$/i })); // -> sets
  fireEvent.click(screen.getByRole('button', { name: /^next$/i })); // -> values
  fireEvent.click(screen.getByRole('button', { name: '8' }));
  fireEvent.change(screen.getByLabelText(/weight in kilograms/i), { target: { value: '100' } });
  fireEvent.click(screen.getByRole('button', { name: /^next$/i })); // -> review
}

describe('ExerciseWizard — Review and commit', () => {
  it('shows the exercise name and its shape summary', () => {
    renderWizard();
    toReview();
    expect(screen.getByText('Back Squat')).toBeInTheDocument();
    expect(screen.getByText('3 × 8 @ 100kg')).toBeInTheDocument();
  });

  it('commits a WizardResult with three identical sets and no id, for a new exercise', () => {
    const props = renderWizard();
    toReview();
    fireEvent.click(screen.getByRole('button', { name: /add exercise/i }));
    const [result, shape] = props.onSave.mock.calls[0];
    expect(result.id).toBeUndefined();
    expect(result.name).toBe('Back Squat');
    expect(result.columnA).toBe('reps');
    expect(result.columnB).toBe('weight_kg');
    expect(result.sets).toHaveLength(3);
    expect(result.sets.every((s) => s.a === '8' && s.b === '100')).toBe(true);
    expect(shape).toEqual({ measure: 'reps_weight', sets: 3, a: '8', b: '100' });
  });

  it('carries the rest, target RPE, and tempo optional fields into the result', () => {
    const props = renderWizard();
    toReview();
    fireEvent.change(screen.getByLabelText(/^rest/i), { target: { value: '120' } });
    fireEvent.change(screen.getByLabelText(/target rpe/i), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText(/^tempo/i), { target: { value: '3-1-1-0' } });
    fireEvent.click(screen.getByRole('button', { name: /add exercise/i }));
    const [result] = props.onSave.mock.calls[0];
    expect(result.rest).toBe(120);
    expect(result.tempo).toBe('3-1-1-0');
    expect(result.sets.every((s) => s.rpe === '8')).toBe(true);
  });

  it('preserves the existing id when committing an edit', () => {
    const props = renderWizard({
      initial: { id: 'e7', name: 'Front Squat', columnA: 'reps', columnB: 'weight_kg', rest: 90, sets: [{ id: 'e7-s0', a: '5', b: '80' }] },
    });
    fireEvent.click(screen.getByRole('button', { name: /skip to review/i }));
    fireEvent.click(screen.getByRole('button', { name: /add exercise/i }));
    expect(props.onSave.mock.calls[0][0].id).toBe('e7');
  });

  it('offers Skip to review from Measure onward, not on the Exercise step', () => {
    renderWizard();
    expect(screen.queryByRole('button', { name: /skip to review/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Back Squat'));
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    fireEvent.click(screen.getByRole('button', { name: /skip to review/i }));
    expect(screen.getByText('Look right?')).toBeInTheDocument();
  });

  it('uses lastShape to default Measure/Sets/Values for a brand-new add', () => {
    renderWizard({ lastShape: { measure: 'seconds', sets: 5, a: '30', b: '' } });
    fireEvent.click(screen.getByText('Back Squat'));
    fireEvent.click(screen.getByRole('button', { name: /skip to review/i }));
    expect(screen.getByText('5 × 30s')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/library/ExerciseWizard.test.tsx`
Expected: FAIL — no Review step, `onSave` never called.

- [ ] **Step 3: Write the minimal implementation**

Extend `Draft` with the optional-extras fields and add the Review step.
Replace the `Draft` interface and `initialDraft` from Task 2 with:

```ts
interface Draft {
  name: string;
  measure: Measure;
  sets: number;
  a: string;
  b: string;
  rest: number;
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
      every: initial.every ?? 0,
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
    every: 0,
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

function unitFor(draft: Draft): string {
  return draft.measure === 'seconds' ? 'Seconds' : draft.measure === 'distance' ? 'Metres' : 'Reps';
}
```

Add a `goToReview` helper alongside `push`/`back`:

```ts
function goToReview() {
  setHistory((h) => (h.includes('review') ? h : [...h, 'review']));
}

function commit() {
  const opt = MEASURES.find((m) => m.key === draft.measure)!;
  const rowId = (i: number) => `${initial?.id ?? 'new'}-s${i}`;
  const sets: SetRow[] = Array.from({ length: draft.sets }, (_, i) => ({
    id: rowId(i), a: draft.a, b: draft.b, ...(draft.rpe ? { rpe: draft.rpe } : {}),
  }));
  const result: WizardResult = {
    ...(initial ? { id: initial.id } : {}),
    name: draft.name,
    columnA: opt.columnA,
    columnB: opt.columnB,
    rest: draft.rest,
    ...(draft.every > 0 ? { every: draft.every } : {}),
    ...(draft.tempo.trim() ? { tempo: draft.tempo.trim() } : {}),
    sets,
  };
  onSave(result, { measure: draft.measure, sets: draft.sets, a: draft.a, b: draft.b });
}
```

Add the "Skip to review" button to the topbar (only outside `exercise` and
`review`), and the Review step, in the JSX:

```tsx
{step !== 'exercise' && step !== 'review' && (
  <button type="button" className="cb-wizard-skip" onClick={goToReview}>Skip to review</button>
)}
```

```tsx
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
          <span>Rest</span>
          <input aria-label="Rest in seconds" type="number" min={0} value={draft.rest} onChange={(e) => patch({ rest: Math.max(0, Number(e.target.value) || 0) })} />
        </label>
        <label className="cell">
          <span>Target RPE</span>
          <input aria-label="Target RPE" placeholder="8, or 7–10" value={draft.rpe} onChange={(e) => patch({ rpe: e.target.value })} />
        </label>
        <label className="cell">
          <span>Tempo</span>
          <input aria-label="Tempo" placeholder="e.g. 3-1-1-0" value={draft.tempo} onChange={(e) => patch({ tempo: e.target.value })} />
        </label>
      </div>
    </div>
    <div className="cb-wizard-btn-row">
      <button type="button" className="cb-wizard-btn" onClick={back}>Back</button>
      <button type="button" className="cb-wizard-btn cb-wizard-btn-brass" onClick={commit}>Add exercise</button>
    </div>
  </div>
)}
```

Note the test's label queries: `/^rest/i` matches "Rest in seconds" (Task 5
polish can shorten it, but the aria-label must keep "Rest" as its first
word for the existing test regex).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/library/ExerciseWizard.test.tsx`
Expected: PASS (28 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/coach/library/ExerciseWizard.tsx apps/web/src/coach/library/ExerciseWizard.test.tsx
git commit -m "Add ExerciseWizard's Review step, skip-to-review, and commit"
```

---

## Task 5: Wire the wizard into `BlockEditor`, simplify `ExerciseItem`

**Files:**
- Modify: `apps/web/src/coach/library/BlockEditor.tsx`
- Modify: `apps/web/src/coach/library/BlockEditor.test.tsx`

**Interfaces:**
- Consumes: `ExerciseWizard`, `WizardResult`, `WizardShape` from
  `./ExerciseWizard`.
- Produces: `BlockEditor` no longer exports `DEFAULT_REST_SEC`,
  `DEFAULT_EVERY_SEC`, `fmtEvery` as its own definitions — it re-exports
  them from `./ExerciseWizard` so `day-workout.ts`'s import is unaffected.

- [ ] **Step 1: Write the failing test**

Replace `BlockEditor.test.tsx`'s existing exercise-detail tests (the ones
exercising the old inline pacing/RPE/tempo/`SetRows` body — anything
asserting on `Rest (seconds)`, `Pacing`, `Target RPE`, or `SetRows`'s own
rendering inside `BlockEditor`) with:

```tsx
// apps/web/src/coach/library/BlockEditor.test.tsx — replace the removed
// section with this; keep every other existing describe block (block
// heading, kind switch, minutes, superset, conditioning) unchanged.
describe('BlockEditor — the exercise wizard', () => {
  const block = { id: 'b1', category: 'Strength/Power', exercises: [] };

  it('opens the wizard on "+ Add exercise from library"', () => {
    const onChange = vi.fn();
    render(<BlockEditor block={block} entries={[]} index={0} onChange={onChange} onRemove={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /add exercise from library/i }));
    expect(screen.getByText('What are they doing?')).toBeInTheDocument();
  });

  it('folds a new exercise from the wizard into block.exercises', () => {
    const onChange = vi.fn();
    render(<BlockEditor block={block} entries={[{ name: 'Back Squat', tags: [], uses: 0 }]} index={0} onChange={onChange} onRemove={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /add exercise from library/i }));
    fireEvent.click(screen.getByText('Back Squat'));
    fireEvent.click(screen.getByRole('button', { name: /skip to review/i }));
    fireEvent.click(screen.getByRole('button', { name: /add exercise/i }));
    const next = onChange.mock.calls[0][0];
    expect(next.exercises).toHaveLength(1);
    expect(next.exercises[0].name).toBe('Back Squat');
    expect(screen.queryByText('What are they doing?')).not.toBeInTheDocument();
  });

  it('clicking an existing exercise row opens the wizard pre-filled, not an inline expansion', () => {
    const withExercise = {
      ...block,
      exercises: [{ id: 'e1', name: 'Front Squat', columnA: 'reps', columnB: 'weight_kg', rest: 90, sets: [{ id: 'e1-s0', a: '5', b: '80' }] }],
    };
    render(<BlockEditor block={withExercise} entries={[]} index={0} onChange={vi.fn()} onRemove={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /front squat/i }));
    expect(screen.getByDisplayValue('Front Squat')).toBeInTheDocument();
    expect(screen.queryByText(/pacing/i)).not.toBeInTheDocument();
  });

  it('remembers the shape of the last added exercise as the next one\'s defaults', () => {
    const onChange = vi.fn();
    const { rerender } = render(<BlockEditor block={block} entries={[{ name: 'Back Squat', tags: [], uses: 0 }, { name: 'Front Squat', tags: [], uses: 0 }]} index={0} onChange={onChange} onRemove={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /add exercise from library/i }));
    fireEvent.click(screen.getByText('Back Squat'));
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    fireEvent.click(screen.getByRole('button', { name: /seconds/i }));
    fireEvent.click(screen.getByRole('button', { name: /skip to review/i }));
    fireEvent.click(screen.getByRole('button', { name: /add exercise/i }));
    const afterFirst = onChange.mock.calls[0][0];
    rerender(<BlockEditor block={afterFirst} entries={[{ name: 'Back Squat', tags: [], uses: 0 }, { name: 'Front Squat', tags: [], uses: 0 }]} index={0} onChange={onChange} onRemove={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /add exercise from library/i }));
    fireEvent.click(screen.getByText('Front Squat'));
    fireEvent.click(screen.getByRole('button', { name: /skip to review/i }));
    expect(screen.getByRole('button', { name: /seconds/i })).toBeInTheDocument(); // Measure step reachable, remembered = seconds
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/library/BlockEditor.test.tsx`
Expected: FAIL — `BlockEditor` still renders the old picker/expand flow.

- [ ] **Step 3: Write the minimal implementation**

In `BlockEditor.tsx`:

1. Replace the three local imports/definitions that moved to
   `ExerciseWizard.tsx`:

```ts
// remove: export const DEFAULT_REST_SEC = 90;
// remove: export const DEFAULT_EVERY_SEC = 150;
// remove: export function fmtEvery(...) {...}
export { DEFAULT_REST_SEC, DEFAULT_EVERY_SEC, fmtEvery } from './ExerciseWizard';
import { ExerciseWizard, type WizardResult, type WizardShape } from './ExerciseWizard';
```

2. In `BlockEditor`, replace `pickerOpen`/`addExercise`/`removeExercise`/
   `patchExercise`'s call sites in the strength body with wizard state:

```ts
const [wizardFor, setWizardFor] = useState<'new' | string | null>(null);
const [lastShape, setLastShape] = useState<WizardShape | undefined>(undefined);

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
```

(`patchExercise` is removed entirely — the wizard is now the only writer of
an exercise's fields.)

3. Replace the strength body's JSX (the `<ol className="cb-block-items">`
   through the `<ExercisePicker>` block) with:

```tsx
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
            onOpen={() => setWizardFor(ex.id)}
          />
        ))}
      </ol>

      <button type="button" className="cb-picker-reveal" onClick={() => setWizardFor('new')}>
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
```

4. Simplify `ExerciseItem` to a plain clickable row — remove its own
   `useState`, the `.cb-exp` block, and everything inside it (Pacing, Rest/
   Every, Target RPE, Tempo, `<SetRows>`):

```tsx
function ExerciseItem({
  exercise,
  letter,
  onRemove,
  onOpen,
}: {
  exercise: BlockExercise;
  letter: string;
  onRemove: () => void;
  onOpen: () => void;
}) {
  const count = exercise.sets.length;
  return (
    <li className="cb-item">
      <div className="cb-item-head-row">
        <button type="button" className="cb-item-head" onClick={onOpen}>
          <span className="cal-letter-chip">{letter}</span>
          <span className="cb-item-name">{exercise.name}</span>
          <span className="cb-sets-pill">{count === 1 ? '1 Set' : `${count} Sets`}</span>
        </button>
        <button type="button" className="cb-item-remove" aria-label={`Remove ${exercise.name}`} onClick={onRemove}>
          <Cross />
        </button>
      </div>
    </li>
  );
}
```

5. Remove the now-unused `newSetRows` import if `BlockEditor.tsx` no longer
   calls it directly (the wizard builds its own `SetRow[]`), and remove the
   `SetRows`/`ExercisePicker` imports that are no longer used directly in
   `BlockEditor.tsx` (the wizard imports `ExercisePicker` itself now).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/library/BlockEditor.test.tsx src/coach/library/ExerciseWizard.test.tsx`
Expected: PASS

- [ ] **Step 5: Run the full web suite to catch any other test that assumed the old inline body**

Run: `pnpm --filter @hybrid/web exec vitest run`
Expected: PASS. If `day-workout.test.ts` or `session-templates.test.ts` fail
on an import of `DEFAULT_REST_SEC`/`DEFAULT_EVERY_SEC`/`fmtEvery` from
`BlockEditor`, that's expected to keep working via the Step 3.1 re-export —
investigate rather than change those files' imports.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/coach/library/BlockEditor.tsx apps/web/src/coach/library/BlockEditor.test.tsx
git commit -m "Wire the Exercise Wizard into BlockEditor, simplify ExerciseItem"
```

---

## Task 6: Wizard CSS (full-screen overlay, glyph tiles, chips, steppers, 44px targets)

**Files:**
- Modify: `apps/web/src/coach/coach-redesign.css`

**Interfaces:**
- Consumes: existing design tokens from `packages/design/src/tokens.css`
  (`--color-bg`, `--color-panel`, `--color-panel2`, `--color-line`,
  `--color-line2`, `--color-text`, `--color-muted`, `--color-dim`,
  `--color-gold`, `--color-gold2`, `--color-gold-wash`, `--color-gold-line`,
  `--color-on-accent`) — already loaded globally, no new tokens needed.
- Produces: the `.cb-wizard*` class names referenced by `ExerciseWizard.tsx`
  in Tasks 2–4.

- [ ] **Step 1: Add the rules**

Append to `apps/web/src/coach/coach-redesign.css`:

```css
/*
 * THE EXERCISE WIZARD — a full-screen takeover, the same component at
 * 420px and 1440px (see docs/superpowers/specs/2026-08-16-exercise-wizard-
 * design.md). `position: fixed` over the whole viewport rather than a
 * modal/drawer: a coach on a phone gets the native full-screen pattern,
 * and nothing here needs a second, desktop-only layout to keep in step.
 */
.cb-wizard {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: var(--color-bg);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.cb-wizard-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px 0;
  position: relative;
}

.cb-wizard-back {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  background: none;
  border: none;
  color: var(--color-muted);
  font: inherit;
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;
  padding: 0 4px 0 0;
}
.cb-wizard-back:hover { color: var(--color-text); }
.cb-wizard-back:focus-visible { outline: 2px solid var(--color-gold2); outline-offset: 2px; }

.cb-wizard-skip {
  position: absolute;
  top: 14px;
  right: 20px;
  min-height: 44px;
  background: none;
  border: none;
  color: var(--color-gold2);
  font: inherit;
  font-size: 12.5px;
  font-weight: 650;
  cursor: pointer;
  text-decoration: underline;
  text-decoration-color: var(--color-gold-line);
  text-underline-offset: 3px;
}
.cb-wizard-skip:focus-visible { outline: 2px solid var(--color-gold2); outline-offset: 2px; }

.cb-wizard-progress-track {
  margin: 10px 20px 0;
  height: 3px;
  border-radius: 2px;
  background: var(--color-panel2);
  overflow: hidden;
}
.cb-wizard-progress-fill {
  height: 100%;
  background: var(--color-gold2);
  border-radius: 2px;
  transition: width 0.25s ease;
}
.cb-wizard-stepcount {
  text-align: center;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-dim);
  padding-top: 6px;
  margin: 0;
}

.cb-wizard-step {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 20px 22px 32px;
  text-align: center;
}

.cb-wizard-step h1 {
  font-size: 22px;
  font-weight: 800;
  margin: 0;
  text-wrap: balance;
  color: var(--color-text);
}

.cb-wizard-field-label {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-dim);
}

.cb-wizard-btn {
  padding: 10px 18px;
  min-height: 44px;
  border-radius: 10px;
  border: 1px solid var(--color-line2);
  background: none;
  color: var(--color-muted);
  font: inherit;
  font-size: 13.5px;
  font-weight: 650;
  cursor: pointer;
}
.cb-wizard-btn:hover { border-color: var(--color-gold-line); color: var(--color-text); }
.cb-wizard-btn:focus-visible { outline: 2px solid var(--color-gold2); outline-offset: 2px; }
.cb-wizard-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.cb-wizard-btn-brass { background: var(--color-gold2); border-color: var(--color-gold2); color: var(--color-on-accent); }
.cb-wizard-btn-brass:hover { background: #ecc999; }
.cb-wizard-btn-row { display: flex; gap: 8px; margin-top: 8px; }

.cb-wizard-glyph-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  width: 100%;
  max-width: 340px;
}
.cb-wizard-glyph-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 76px;
  padding: 12px;
  border-radius: 13px;
  border: 1px solid var(--color-line2);
  background: var(--color-panel);
  color: var(--color-text);
  font: inherit;
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;
  line-height: 1.25;
}
.cb-wizard-glyph-tile:hover { border-color: var(--color-gold-line); background: var(--color-gold-wash); }
.cb-wizard-glyph-tile:focus-visible { outline: 2px solid var(--color-gold2); outline-offset: 2px; }
.cb-wizard-glyph-tile.on { border-color: var(--color-gold2); background: var(--color-gold-wash); }
.cb-wizard-glyph-tile.on .name { color: var(--color-gold2); }
.cb-wizard-glyph-tile .glyph { font-size: 21px; }
.cb-wizard-glyph-tile .sub { font-size: 10.5px; font-weight: 550; color: var(--color-dim); }

.cb-wizard-stepper-row { display: flex; align-items: center; gap: 18px; }
.cb-wizard-stepper-row button {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 1px solid var(--color-line2);
  background: var(--color-panel);
  color: var(--color-gold2);
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.cb-wizard-stepper-row button:hover { border-color: var(--color-gold-line); background: var(--color-gold-wash); }
.cb-wizard-stepper-row button:focus-visible { outline: 2px solid var(--color-gold2); outline-offset: 2px; }
.cb-wizard-stepper-row .num {
  width: 56px;
  text-align: center;
  font-size: 34px;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  color: var(--color-text);
}

.cb-wizard-chip-row { display: flex; flex-wrap: wrap; justify-content: center; gap: 7px; }
.cb-wizard-chip {
  padding: 10px 16px;
  min-height: 44px;
  border-radius: 999px;
  border: 1px solid var(--color-line2);
  background: var(--color-panel);
  color: var(--color-muted);
  font: inherit;
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
}
.cb-wizard-chip:hover { border-color: var(--color-gold-line); }
.cb-wizard-chip:focus-visible { outline: 2px solid var(--color-gold2); outline-offset: 2px; }
.cb-wizard-chip.on { border-color: var(--color-gold2); background: var(--color-gold-wash); color: var(--color-gold2); }

.cb-wizard-custom-input {
  width: 220px;
  min-height: 44px;
  padding: 9px 12px;
  text-align: center;
  border-radius: 8px;
  border: 1px solid var(--color-line);
  background: var(--color-well);
  color: var(--color-text);
  font: inherit;
  font-size: 13.5px;
}
.cb-wizard-custom-input::placeholder { color: var(--color-dim); }
.cb-wizard-custom-input:focus-visible { outline: none; border-color: var(--color-gold-line); }

.cb-wizard-weight-row { display: flex; align-items: center; gap: 10px; }
.cb-wizard-weight-unit { font-size: 12px; color: var(--color-dim); font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }

.cb-wizard-review-card {
  width: 100%;
  max-width: 340px;
  text-align: left;
  border-radius: 14px;
  border: 1px solid var(--color-line2);
  background: var(--color-panel);
  overflow: hidden;
}
.cb-wizard-review-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 14px 16px 12px;
  border-bottom: 1px solid var(--color-line);
}
.cb-wizard-review-head .ex-name { font-size: 16px; font-weight: 650; color: var(--color-text); }
.cb-wizard-review-head .ex-shape { font-size: 12px; color: var(--color-gold2); font-weight: 600; }
.cb-wizard-review-extra {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1px;
  background: var(--color-line);
}
.cb-wizard-review-extra .cell {
  background: var(--color-panel);
  padding: 11px 14px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-height: 44px;
  justify-content: center;
}
.cb-wizard-review-extra .cell > span {
  font-size: 9.5px;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--color-dim);
}
.cb-wizard-review-extra input {
  background: none;
  border: none;
  color: var(--color-text);
  font: inherit;
  font-size: 13px;
  padding: 0;
}
.cb-wizard-review-extra input::placeholder { color: var(--color-dim); }
.cb-wizard-review-extra input:focus-visible { outline: 2px solid var(--color-gold2); outline-offset: 2px; }

.cb-wizard-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (prefers-reduced-motion: reduce) {
  .cb-wizard-progress-fill { transition: none; }
}
```

Remove the now-dead `.cb-pace` and `.cb-pace-note` rules (they only ever
styled `ExerciseItem`'s old inline detail body, which Task 5 deleted) —
search the file for both class names before deleting, to confirm nothing
else references them.

- [ ] **Step 2: Verify visually**

Run: `pnpm --filter @hybrid/web dev` and open `/coach/library` (or
`/coach/day/:date` with a seeded date), open a Strength/Power block, click
"+ Add exercise from library", and click through all five steps at both a
1440px and a 420px browser width. Confirm no horizontal scroll at 420px and
every tile/chip/stepper button is comfortably tappable.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/coach/coach-redesign.css
git commit -m "Add Exercise Wizard styles: full-screen overlay, glyph tiles, chips, steppers"
```

---

## Task 7: Full verification and phone/desktop parity

**Files:** none (verification only)

- [ ] **Step 1: Typecheck the whole repo**

Run: `pnpm run typecheck`
Expected: every package reports `Done`, no errors.

- [ ] **Step 2: Run the full web test suite**

Run: `pnpm --filter @hybrid/web exec vitest run`
Expected: all tests pass, including `ExerciseWizard.test.tsx` and the
updated `BlockEditor.test.tsx`.

- [ ] **Step 3: Run the coach-bench phone/desktop screenshot gate**

Run: `node checks/screens.mjs`
Expected: PASS at both 1440px and 420px for every declared `/coach` route —
the wizard doesn't add a new route, so this is confirming the existing
`/coach/day/:date`, `/coach/week/...`, and `/coach/library` shots still hold
with the new component in the tree.

- [ ] **Step 4: Run the full verify gate**

Run: `pnpm run verify`
Expected: PASS — this is everything CI runs in one command, per CLAUDE.md's
"Useful commands".

- [ ] **Step 5: Final commit**

If Steps 1–4 required any fixes, commit them now with a message describing
what broke and why. If nothing needed fixing, this step is a no-op — the
per-task commits from Tasks 1–6 already cover the feature.

```bash
git status
# only commit if there are uncommitted changes from fixes made in this task
```
