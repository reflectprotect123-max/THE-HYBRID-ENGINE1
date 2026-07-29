# Coach Builder Guided Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the coach builder's always-visible dense editor with a TrainHeroic-style week grid (Plan view) and a full-screen, one-step-at-a-time guided flow for authoring a session's content.

**Architecture:** Pure, testable functions first (`builder/grid.ts` for the grid's cell data, `builder/flowSteps.ts` for the guided flow's step sequencing), then components built on them, then wiring into `App.tsx`, then deletion of the now-dead dense editor. No engine or data-model changes — `CoachSession`/`CoachWeek`/`CoachProgram` (`apps/coach/src/model.ts`) stay exactly as they are; this is a UI-only redesign.

**Tech Stack:** React 19, TypeScript, Tailwind (existing `apps/coach/src/ui.tsx` kit — `BRASS`, `GHOST`, `WELL`, `Chip`, `Field`, `MICRO`, icon components), Vitest.

## Global Constraints

- `PlannedSet` stays exactly `{t, rpe}` — both strings. The guided flow's reps/warm-up steps are a friendlier INPUT method that still produces the same string values the engine already parses (e.g. a warm-up toggle + "10 reps" still writes `t: 'W10'`, because `packages/engine/src/autoreg.ts`'s `isWarmup()` tests `/^\s*w/i` on `t` — this is a frozen contract, not something this plan touches).
- Build `PlannedSet` objects as plain literals (`{ t: '5', rpe: '8' }`), never via the bare imported `newSet` — the engine has two functions of that name (session.ts's zero-arg version wins the top-level export; the one that takes `(target, rpe)` only exists as `emit.newSet`). Calling the wrong one silently discards values. This exact mistake happened once already in `model.ts`'s `migrateBlock` and is documented there.
- The movement picker (`apps/coach/src/editor/MovementPicker.tsx`) is reused completely unchanged — it tested well in the fresh-eyes review.
- Superset chaining (the seam/chain-link interaction) carries over unchanged in behavior — only its container changes.
- Full replacement, no toggle back to the old dense editor.
- Desktop-only by construction, matching the rest of this app (`App.tsx`'s own comment: "Laptop-only by design").

---

### Task 1: Pure grid cell-summary logic

**Files:**
- Create: `apps/coach/src/builder/grid.ts`
- Test: `apps/coach/test/grid.test.ts`

**Interfaces:**
- Consumes: `CoachSession`, `CoachProgram` (`../model`); `isCond`, `blockExercises`, `CON_FORMATS` (`@hybrid/engine`).
- Produces: `CellSummary { status: 'empty' | 'filled'; line: string; sets: number; isCond: boolean }`, `cellSummary(sess: CoachSession | null): CellSummary`, `libraryCandidates(program: CoachProgram): CoachSession[]` — consumed by Task 3 (`WeekGrid`).

This extracts and generalizes `App.tsx`'s existing private `preview()` function (currently untested) into a pure, testable module, and adds the "what sessions can I reuse" query the new empty-cell "Add from library" action needs.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { cellSummary, libraryCandidates } from '../src/builder/grid';
import type { CoachProgram, CoachSession } from '../src/model';

const session = (id: string, blocks: CoachSession['blocks']): CoachSession => ({ id, name: 'S', blocks, updatedAt: 1 });

describe('cellSummary', () => {
  it('is empty for no session', () => {
    expect(cellSummary(null)).toEqual({ status: 'empty', line: '', sets: 0, isCond: false });
  });

  it('lists up to 3 movement names, with a +N overflow', () => {
    const s = session('s1', [
      { id: 'b1', heading: 'Main', superset: false, exercises: [
        { id: 'e1', name: 'Back Squat', mode: 'reps_kg', rest: 90, sets: [{ t: '5', rpe: '8' }] },
        { id: 'e2', name: 'Bench', mode: 'reps_kg', rest: 90, sets: [{ t: '5', rpe: '8' }] },
        { id: 'e3', name: 'Row', mode: 'reps_kg', rest: 90, sets: [{ t: '5', rpe: '8' }] },
        { id: 'e4', name: 'Curl', mode: 'reps_kg', rest: 90, sets: [{ t: '5', rpe: '8' }] },
      ] },
    ]);
    const r = cellSummary(s);
    expect(r).toEqual({ status: 'filled', line: 'Back Squat · Bench · Row +1', sets: 4, isCond: false });
  });

  it('names the conditioning format when there are no lift exercises', () => {
    const s = session('s2', [{ id: 'b1', kind: 'conditioning', condFmt: 'intervals', targetZone: 'mod' }]);
    expect(cellSummary(s)).toEqual({ status: 'filled', line: 'Intervals', sets: 0, isCond: true });
  });

  it('says "No movements yet" for a session with an empty block', () => {
    const s = session('s3', [{ id: 'b1', heading: 'Main', superset: false, exercises: [{ id: 'e1', name: '', mode: 'reps_kg', rest: 90, sets: [] }] }]);
    expect(cellSummary(s).line).toBe('No movements yet');
  });
});

describe('libraryCandidates', () => {
  it('collects every distinct session across all weeks, deduplicated by id', () => {
    const a = session('a', []);
    const b = session('b', []);
    const program: CoachProgram = {
      id: 'p1', name: 'P',
      weeks: [
        { days: [a, null, b, null, null, null, null] },
        { days: [a, null, null, null, null, null, null] }, // same session reused on week 2
      ],
    };
    expect(libraryCandidates(program).map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('is empty for a programme with nothing written', () => {
    const program: CoachProgram = { id: 'p1', name: 'P', weeks: [{ days: [null, null, null, null, null, null, null] }] };
    expect(libraryCandidates(program)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @hybrid/coach test -- grid.test.ts`
Expected: FAIL — `Cannot find module '../src/builder/grid'`.

- [ ] **Step 3: Write `apps/coach/src/builder/grid.ts`**

```ts
import { blockExercises, isCond, CON_FORMATS } from '@hybrid/engine';
import type { CoachProgram, CoachSession } from '../model';

export interface CellSummary {
  status: 'empty' | 'filled';
  line: string;
  sets: number;
  isCond: boolean;
}

/** What a day's cell shows in the grid, without opening it. */
export function cellSummary(sess: CoachSession | null): CellSummary {
  if (!sess) return { status: 'empty', line: '', sets: 0, isCond: false };
  const names: string[] = [];
  const cond: string[] = [];
  let sets = 0;
  for (const b of sess.blocks) {
    if (isCond(b)) {
      cond.push(CON_FORMATS[b.condFmt].name);
      continue;
    }
    for (const e of blockExercises(b)) {
      if (e.name.trim()) names.push(e.name.trim());
      sets += e.sets.length;
    }
  }
  const line = names.length
    ? names.slice(0, 3).join(' · ') + (names.length > 3 ? ' +' + (names.length - 3) : '')
    : cond.length
      ? cond.join(' · ')
      : 'No movements yet';
  return { status: 'filled', line, sets, isCond: cond.length > 0 };
}

/**
 * Sessions already written anywhere in the programme, deduplicated by id, in
 * first-seen order. This IS the "library" an empty cell's "Add from library"
 * offers to reuse — there is no separate template store, so what a coach has
 * already authored elsewhere in this programme is what's available to copy.
 */
export function libraryCandidates(program: CoachProgram): CoachSession[] {
  const seen = new Set<string>();
  const out: CoachSession[] = [];
  for (const week of program.weeks) {
    for (const day of week.days) {
      if (day && !seen.has(day.id)) {
        seen.add(day.id);
        out.push(day);
      }
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @hybrid/coach test -- grid.test.ts`
Expected: PASS — all 6 cases.

- [ ] **Step 5: Commit**

```bash
git add apps/coach/src/builder/grid.ts apps/coach/test/grid.test.ts
git commit -m "Coach: pure grid cell-summary and library-candidate logic"
```

---

### Task 2: Pure guided-flow step sequencing

**Files:**
- Create: `apps/coach/src/builder/flowSteps.ts`
- Test: `apps/coach/test/flowSteps.test.ts`

**Interfaces:**
- Consumes: nothing (pure, no dependencies).
- Produces: `FlowStep` type, `FlowState { blockKind: 'lift' | 'warmup' | 'cond' | 'metcon' | null; isWarmupSet: boolean }`, `stepsFor(state: FlowState): FlowStep[]`, `nextStep(current: FlowStep, state: FlowState): FlowStep | null`, `prevStep(current: FlowStep, state: FlowState): FlowStep | null` — consumed by Task 7 (`GuidedFlow`).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { nextStep, prevStep, stepsFor } from '../src/builder/flowSteps';

describe('stepsFor', () => {
  it('a lift block walks movement through review, including RPE', () => {
    expect(stepsFor({ blockKind: 'lift', isWarmupSet: false })).toEqual([
      'block-type', 'movement', 'sets', 'reps', 'rpe', 'more', 'review',
    ]);
  });

  it('a warm-up SET skips the RPE step entirely', () => {
    expect(stepsFor({ blockKind: 'lift', isWarmupSet: true })).toEqual([
      'block-type', 'movement', 'sets', 'reps', 'more', 'review',
    ]);
  });

  it('conditioning and metcon blocks skip movement/sets/reps/rpe entirely', () => {
    expect(stepsFor({ blockKind: 'cond', isWarmupSet: false })).toEqual(['block-type', 'more', 'review']);
    expect(stepsFor({ blockKind: 'metcon', isWarmupSet: false })).toEqual(['block-type', 'more', 'review']);
  });
});

describe('nextStep / prevStep', () => {
  const lift = { blockKind: 'lift' as const, isWarmupSet: false };

  it('walks forward through the sequence', () => {
    expect(nextStep('block-type', lift)).toBe('movement');
    expect(nextStep('movement', lift)).toBe('sets');
  });

  it('is null past the last step', () => {
    expect(nextStep('review', lift)).toBeNull();
  });

  it('walks backward, and is null before the first step', () => {
    expect(prevStep('sets', lift)).toBe('movement');
    expect(prevStep('block-type', lift)).toBeNull();
  });

  it('adapts mid-flow when isWarmupSet flips between reps and more', () => {
    // Sitting on 'reps' and the coach flips the set to a warm-up before
    // advancing: the RPE step should no longer be next.
    const warm = { blockKind: 'lift' as const, isWarmupSet: true };
    expect(nextStep('reps', warm)).toBe('more');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @hybrid/coach test -- flowSteps.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `apps/coach/src/builder/flowSteps.ts`**

```ts
export type FlowStep = 'block-type' | 'movement' | 'sets' | 'reps' | 'rpe' | 'more' | 'review';

export interface FlowState {
  blockKind: 'lift' | 'warmup' | 'cond' | 'metcon' | null;
  /** Whether the SET currently being authored is marked as a warm-up. */
  isWarmupSet: boolean;
}

const LIFT_SEQUENCE: FlowStep[] = ['block-type', 'movement', 'sets', 'reps', 'rpe', 'more', 'review'];
const NON_LIFT_SEQUENCE: FlowStep[] = ['block-type', 'more', 'review'];

/**
 * The ordered steps for the current state. A conditioning or metcon block has
 * no movement/sets/reps/RPE to author — it goes straight from "what kind of
 * work" to the free-form "more" step. A warm-up set skips RPE, since nothing
 * in a warm-up counts toward autoregulation (packages/engine/src/autoreg.ts).
 */
export function stepsFor(state: FlowState): FlowStep[] {
  if (state.blockKind === 'cond' || state.blockKind === 'metcon') return NON_LIFT_SEQUENCE;
  return state.isWarmupSet ? LIFT_SEQUENCE.filter((s) => s !== 'rpe') : LIFT_SEQUENCE;
}

export function nextStep(current: FlowStep, state: FlowState): FlowStep | null {
  const seq = stepsFor(state);
  const i = seq.indexOf(current);
  return i >= 0 && i < seq.length - 1 ? seq[i + 1] : null;
}

export function prevStep(current: FlowStep, state: FlowState): FlowStep | null {
  const seq = stepsFor(state);
  const i = seq.indexOf(current);
  return i > 0 ? seq[i - 1] : null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @hybrid/coach test -- flowSteps.test.ts`
Expected: PASS — all 7 cases.

- [ ] **Step 5: Commit**

```bash
git add apps/coach/src/builder/flowSteps.ts apps/coach/test/flowSteps.test.ts
git commit -m "Coach: pure guided-flow step sequencing"
```

---

### Task 3: WeekGrid component

**Files:**
- Create: `apps/coach/src/builder/WeekGrid.tsx`

**Interfaces:**
- Consumes: `cellSummary`, `libraryCandidates` (Task 1); `useLib` (`../store`); `newSession` (`../model`).
- Produces: `WeekGrid({ onEdit, onCreate }: { onEdit: (dayIndex: number) => void; onCreate: (dayIndex: number, session: CoachSession) => void })` — consumed by Task 8 (`App.tsx` wiring). `onCreate` is called with either a brand-new blank session (from "Create a session") or a copied one (from "Add from library"); `onEdit` is called for an already-filled cell's "Edit".

This is the Plan view's new primary content — days as columns is unnecessary given this app is one programme at a time with a 7-day week already fixed; the grid is rows of days (matching the existing day-list order) with each row showing its `cellSummary` and the two/one action(s) per the design.

- [ ] **Step 1: Write the component**

```tsx
import { useState } from 'react';
import { cellSummary, libraryCandidates } from './grid';
import { useLib } from '../store';
import { newSession, type CoachSession } from '../model';
import { BRASS, Chip, GHOST, MICRO } from '../ui';

export function WeekGrid({
  onEdit,
  onCreate,
}: {
  onEdit: (dayIndex: number) => void;
  onCreate: (dayIndex: number, session: CoachSession) => void;
}) {
  const { lib } = useLib();
  const prog = lib.programs[lib.sel.p];
  const week = prog.weeks[lib.sel.w];
  const [libraryFor, setLibraryFor] = useState<number | null>(null);
  const candidates = libraryCandidates(prog);

  return (
    <div className="flex min-h-full flex-col gap-1 p-3">
      <h1 className="text-8 font-[800] tracking-[-.02em]">Week {lib.sel.w + 1}</h1>
      <div className="mt-1 flex flex-col gap-1">
        {week.days.map((sess, i) => {
          const cell = cellSummary(sess);
          return (
            <div key={i} className="flex items-center gap-2 rounded-md border border-line bg-panel p-2">
              <span className="num grid h-5 w-5 shrink-0 place-items-center rounded-pill border border-line2 bg-panel2 text-4 font-[750]">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className={MICRO}>Day {i + 1}</div>
                <b className="block truncate text-5 font-[750]">{sess ? sess.name || 'Session' : 'Rest day'}</b>
                {cell.status === 'filled' ? (
                  <span className="flex items-center gap-1 text-3 text-muted">
                    <span className="min-w-0 flex-1 truncate">{cell.line}</span>
                    {cell.sets ? <span className="num shrink-0 text-2 text-dim">{cell.sets} sets</span> : null}
                    {cell.isCond ? <Chip tone="cond">♥ HR</Chip> : null}
                  </span>
                ) : null}
              </div>

              {cell.status === 'filled' ? (
                <button onClick={() => onEdit(i)} className={GHOST + ' shrink-0'}>
                  Edit
                </button>
              ) : libraryFor === i ? (
                <LibraryPicker
                  candidates={candidates}
                  onPick={(s) => {
                    onCreate(i, { ...s, id: crypto.randomUUID(), updatedAt: Date.now() });
                    setLibraryFor(null);
                  }}
                  onClose={() => setLibraryFor(null)}
                />
              ) : (
                <div className="flex shrink-0 gap-1">
                  <button onClick={() => onCreate(i, newSession('Session'))} className={BRASS}>
                    Create a session
                  </button>
                  {candidates.length ? (
                    <button onClick={() => setLibraryFor(i)} className={GHOST}>
                      Add from library
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A short pick-one list of sessions already written elsewhere in this programme. */
function LibraryPicker({
  candidates,
  onPick,
  onClose,
}: {
  candidates: CoachSession[];
  onPick: (s: CoachSession) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden="true" />
      <div role="menu" aria-label="choose a session to reuse" className="absolute z-50 flex max-h-[40vh] w-56 flex-col gap-0.5 overflow-y-auto rounded-md border border-line2 bg-panel2 p-1 shadow-lift">
        {candidates.map((s) => (
          <button key={s.id} onClick={() => onPick(s)} className="rounded-sm px-1 py-0.5 text-left text-4 hover:bg-panel3 hover:text-gold2">
            {s.name || 'Session'}
          </button>
        ))}
      </div>
    </>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @hybrid/coach typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/coach/src/builder/WeekGrid.tsx
git commit -m "Coach: WeekGrid — the new Plan view"
```

---

### Task 4: Guided-flow steps — block type and movement

**Files:**
- Create: `apps/coach/src/builder/steps/BlockTypeStep.tsx`
- Create: `apps/coach/src/builder/steps/MovementStep.tsx`

**Interfaces:**
- Consumes: `Picker` (`../../editor/MovementPicker`, unchanged).
- Produces: `BlockTypeStep({ onPick }: { onPick: (kind: 'lift' | 'warmup' | 'cond' | 'metcon') => void })`, `MovementStep({ current, onPick }: { current: string; onPick: (name: string) => void })` — consumed by Task 7 (`GuidedFlow`).

- [ ] **Step 1: Write `BlockTypeStep.tsx`**

```tsx
import { BRASS } from '../../ui';

const CHOICES: { kind: 'lift' | 'warmup' | 'cond' | 'metcon'; label: string; icon: string }[] = [
  { kind: 'lift', label: 'Lift', icon: '🏋' },
  { kind: 'warmup', label: 'Warm-up / Cooldown', icon: '☀' },
  { kind: 'cond', label: 'Conditioning', icon: '♥' },
  { kind: 'metcon', label: 'Metcon / notes', icon: '✎' },
];

export function BlockTypeStep({ onPick }: { onPick: (kind: 'lift' | 'warmup' | 'cond' | 'metcon') => void }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-2 p-3">
      <h1 className="text-8 font-[800]">What are we doing?</h1>
      <div className="grid w-full max-w-[420px] grid-cols-2 gap-2">
        {CHOICES.map((c) => (
          <button
            key={c.kind}
            onClick={() => onPick(c.kind)}
            className={BRASS + ' flex h-10 flex-col items-center justify-center gap-0.5 text-5'}
          >
            <span aria-hidden="true" className="text-7">{c.icon}</span>
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `MovementStep.tsx`**

```tsx
import { Picker } from '../../editor/MovementPicker';

/** A thin full-screen wrapper around the (unchanged) movement picker. */
export function MovementStep({ current, onPick }: { current: string; onPick: (name: string) => void }) {
  return <Picker current={current} onClose={() => onPick(current)} onPick={onPick} />;
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @hybrid/coach typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/coach/src/builder/steps/BlockTypeStep.tsx apps/coach/src/builder/steps/MovementStep.tsx
git commit -m "Coach: guided-flow steps — block type, movement"
```

---

### Task 5: Guided-flow steps — sets, reps, RPE

**Files:**
- Create: `apps/coach/src/builder/steps/SetsStep.tsx`
- Create: `apps/coach/src/builder/steps/RepsStep.tsx`
- Create: `apps/coach/src/builder/steps/RpeStep.tsx`

**Interfaces:**
- Consumes: nothing beyond React and `../../ui`.
- Produces: `SetsStep({ count, onChange }: { count: number; onChange: (n: number) => void })`, `RepsStep({ value, isWarmup, onChange, onWarmupToggle }: { value: string; isWarmup: boolean; onChange: (v: string) => void; onWarmupToggle: (v: boolean) => void })`, `RpeStep({ value, onChange }: { value: string; onChange: (v: string) => void })` — all consumed by Task 7 (`GuidedFlow`). `RepsStep`'s `value`/`onChange` carry the plain numeric-looking string a coach taps (e.g. `"10"`); `GuidedFlow` is what prefixes it with `W` when `isWarmup` is true before it's written into a `PlannedSet.t` — these step components never see or produce the `W`-prefixed string themselves.

- [ ] **Step 1: Write `SetsStep.tsx`**

```tsx
import { BRASS } from '../../ui';

export function SetsStep({ count, onChange }: { count: number; onChange: (n: number) => void }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-2 p-3">
      <h1 className="text-8 font-[800]">How many sets?</h1>
      <div className="flex items-center gap-3">
        <button onClick={() => onChange(Math.max(1, count - 1))} aria-label="fewer sets" className="grid h-8 w-8 place-items-center rounded-full border border-line2 text-8">
          −
        </button>
        <span className="num w-12 text-center text-9 font-[900]">{count}</span>
        <button onClick={() => onChange(Math.min(10, count + 1))} aria-label="more sets" className="grid h-8 w-8 place-items-center rounded-full border border-line2 text-8">
          +
        </button>
      </div>
      <button onClick={() => onChange(count)} className={BRASS + ' mt-2'}>
        Next
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Write `RepsStep.tsx`**

```tsx
import { BRASS, GHOST } from '../../ui';

const CHIPS = ['5', '8', '10', '12', 'max'];

export function RepsStep({
  value,
  isWarmup,
  onChange,
  onWarmupToggle,
}: {
  value: string;
  isWarmup: boolean;
  onChange: (v: string) => void;
  onWarmupToggle: (v: boolean) => void;
}) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-2 p-3">
      <h1 className="text-8 font-[800]">How many reps?</h1>
      <label className="flex items-center gap-1 text-4 text-muted">
        <input type="checkbox" checked={isWarmup} onChange={(e) => onWarmupToggle(e.target.checked)} />
        This is a warm-up
      </label>
      <div className="flex flex-wrap justify-center gap-1">
        {CHIPS.map((c) => (
          <button
            key={c}
            onClick={() => onChange(c)}
            aria-pressed={value === c}
            className={value === c ? BRASS : GHOST}
          >
            {c}
          </button>
        ))}
      </div>
      <input
        value={CHIPS.includes(value) ? '' : value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="or type a custom target, e.g. 8-12"
        aria-label="custom rep target"
        className="mt-1 w-full max-w-[280px] rounded-md border border-line2 bg-panel2 px-1.5 py-1 text-center text-4"
      />
      <button onClick={() => onChange(value)} className={BRASS + ' mt-2'} disabled={!value}>
        Next
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Write `RpeStep.tsx`**

```tsx
import { BRASS, GHOST } from '../../ui';

const RPE_CHIPS = ['6', '7', '8', '9', '10'];

export function RpeStep({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-2 p-3">
      <h1 className="text-8 font-[800]">How hard should it feel?</h1>
      <div className="flex flex-wrap justify-center gap-1">
        {RPE_CHIPS.map((c) => (
          <button key={c} onClick={() => onChange(c)} aria-pressed={value === c} className={value === c ? BRASS : GHOST}>
            RPE {c}
          </button>
        ))}
      </div>
      <button onClick={() => onChange(value)} className={BRASS + ' mt-2'} disabled={!value}>
        Next
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @hybrid/coach typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/coach/src/builder/steps/SetsStep.tsx apps/coach/src/builder/steps/RepsStep.tsx apps/coach/src/builder/steps/RpeStep.tsx
git commit -m "Coach: guided-flow steps — sets, reps, RPE"
```

---

### Task 6: Guided-flow steps — more (rest/tempo/notes) and publish

**Files:**
- Create: `apps/coach/src/builder/steps/MoreStep.tsx`
- Create: `apps/coach/src/builder/steps/PublishStep.tsx`

**Interfaces:**
- Consumes: `MODE_KEYS`, `MODES` (`@hybrid/engine`); `useCoachCloud` (`../../cloud`); `assertPublishable` (`../../model`).
- Produces: `MoreStep({ rest, tempo, mode, note, onChange, onDone }: {...})`, `PublishStep({ sess }: { sess: CoachSession })` — consumed by Task 7 (`GuidedFlow`), which renders `<PublishStep sess={session} />` with no other props. `PublishStep` ports the existing Deliver panel logic straight from `Editor.tsx` (athlete select, scheduled date, validate/publish, the inline toast) rather than reimplementing it.

- [ ] **Step 1: Write `MoreStep.tsx`**

```tsx
import { MODE_KEYS, MODES, type ModeKey } from '@hybrid/engine';
import { BRASS, MICRO, WELL } from '../../ui';

export function MoreStep({
  rest,
  tempo,
  mode,
  note,
  onChange,
  onDone,
}: {
  rest: number;
  tempo: string;
  mode: ModeKey;
  note: string;
  onChange: (patch: { rest?: number; tempo?: string; mode?: ModeKey; note?: string }) => void;
  onDone: () => void;
}) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-2 p-3">
      <h1 className="text-8 font-[800]">Anything else? (optional)</h1>
      <div className="flex w-full max-w-[360px] flex-col gap-2">
        <label className="flex flex-col gap-0.5">
          <span className={MICRO}>Rest (seconds)</span>
          <input
            type="number"
            value={rest || ''}
            onChange={(e) => onChange({ rest: parseInt(e.target.value, 10) || 0 })}
            className={WELL + ' px-1 py-1 text-4'}
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className={MICRO}>Mode</span>
          <select value={mode} onChange={(e) => onChange({ mode: e.target.value as ModeKey })} className={WELL + ' px-1 py-1 text-4'}>
            {MODE_KEYS.map((m) => (
              <option key={m} value={m}>{MODES[m].label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className={MICRO}>Tempo</span>
          <input value={tempo} onChange={(e) => onChange({ tempo: e.target.value })} placeholder="3-1-1-0" className={WELL + ' px-1 py-1 text-4'} />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className={MICRO}>Note for the athlete</span>
          <textarea value={note} onChange={(e) => onChange({ note: e.target.value })} rows={3} className={WELL + ' resize-y px-1 py-1 text-4'} />
        </label>
      </div>
      <button onClick={onDone} className={BRASS + ' mt-2'}>
        Done
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Write `PublishStep.tsx`**, porting `Editor.tsx`'s existing Deliver panel (its `athlete`/`date`/`msg` state and `validate`/`publish` functions) into a full-screen step:

```tsx
import { useState } from 'react';
import { assertPublishable, type CoachSession } from '../../model';
import { useCoachCloud } from '../../cloud';
import { BRASS, Field, MICRO, WELL } from '../../ui';

export function PublishStep({ sess }: { sess: CoachSession }) {
  const cloud = useCoachCloud();
  const [athlete, setAthlete] = useState(cloud.athletes[0]?.id || '');
  const [date, setDate] = useState('');
  const [msg, setMsg] = useState('');
  const [publishing, setPublishing] = useState(false);

  const validate = () => {
    try {
      assertPublishable(sess);
      setMsg(cloud.user ? 'Ready to send.' : 'Ready to send — sign in to send this to an athlete.');
    } catch (e) {
      setMsg('Could not validate: ' + (e as Error).message);
    }
  };

  const publish = async () => {
    setPublishing(true);
    // cloud.publish already calls assertPublishable internally and returns
    // an error string on failure, null on success — see apps/coach/src/cloud.tsx.
    const err = await cloud.publish(sess, athlete, date);
    setMsg(err || 'Sent to athlete.');
    setPublishing(false);
  };

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-2 p-3">
      <h1 className="text-8 font-[800]">Ready to send</h1>
      <Field label="Deliver">
        <div className="flex w-full max-w-[360px] flex-col gap-1">
          {cloud.user ? (
            <>
              <label className={MICRO} htmlFor="rx-athlete">Athlete</label>
              <select id="rx-athlete" value={athlete} onChange={(e) => setAthlete(e.target.value)} className={WELL + ' h-5 px-1 text-4'}>
                {cloud.athletes.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
              <label className={MICRO} htmlFor="rx-date">Scheduled date</label>
              <input id="rx-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={WELL + ' h-5 px-1 text-4'} />
              <button onClick={() => void publish()} disabled={publishing} className={BRASS + ' mt-1 w-full'}>
                {publishing ? 'Sending…' : 'Send to athlete'}
              </button>
            </>
          ) : (
            <>
              <button onClick={validate} className={BRASS + ' w-full'}>Validate &amp; publish</button>
              <p className="text-2 leading-relaxed text-dim">
                Sign in to send this to an athlete. Until then it stays on this machine — validation still runs, so you know it would cross the boundary cleanly.
              </p>
            </>
          )}
          {msg ? <p role="status" className="mt-1 rounded-md border bg-panel2 px-1.5 py-1 text-3">{msg}</p> : null}
        </div>
      </Field>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @hybrid/coach typecheck`
Expected: PASS — `cloud.publish(sess, athlete, date)` returns `Promise<string | null>` per `apps/coach/src/cloud.tsx`, matching the code above exactly.

- [ ] **Step 4: Commit**

```bash
git add apps/coach/src/builder/steps/MoreStep.tsx apps/coach/src/builder/steps/PublishStep.tsx
git commit -m "Coach: guided-flow steps — more, publish"
```

---

### Task 7: GuidedFlow orchestrator

**Files:**
- Create: `apps/coach/src/builder/GuidedFlow.tsx`

**Interfaces:**
- Consumes: `FlowStep`, `FlowState`, `nextStep`, `prevStep`, `stepsFor` (Task 2); all step components (Tasks 4–6); `duplicateExercise`, `sessionLetters`, `newBlock`, `newWarmupBlock`, `newCondBlock`, `newTextBlock`, `newEx`, `blockExercises`, `isCond`, `isText` (`@hybrid/engine`); `CoachSession` (`../model`).
- Produces: `GuidedFlow({ session, onChange, onClose }: { session: CoachSession; onChange: (s: CoachSession) => void; onClose: () => void })` — consumed by Task 8 (`App.tsx` wiring).

This owns "which step am I on," the persistent breadcrumb header, back navigation, and — on reaching `review` — an overview screen listing the session's blocks/exercises with the SAME superset seam interaction `Editor.tsx` has today (unchanged behavior, just relocated), plus "add another exercise/block" entry points that jump back into `block-type`/`movement`.

- [ ] **Step 1: Write `GuidedFlow.tsx`**

```tsx
import { useState } from 'react';
import {
  blockExercises, duplicateExercise, isCond, isText,
  newBlock, newCondBlock, newEx, newTextBlock, newWarmupBlock, sessionLetters,
  type ModeKey,
} from '@hybrid/engine';
import { nextStep, prevStep, stepsFor, type FlowState, type FlowStep } from './flowSteps';
import { BlockTypeStep } from './steps/BlockTypeStep';
import { MovementStep } from './steps/MovementStep';
import { SetsStep } from './steps/SetsStep';
import { RepsStep } from './steps/RepsStep';
import { RpeStep } from './steps/RpeStep';
import { MoreStep } from './steps/MoreStep';
import { PublishStep } from './steps/PublishStep';
import type { CoachSession } from '../model';
import { GHOST, Ltr } from '../ui';

interface Draft {
  blockKind: 'lift' | 'warmup' | 'cond' | 'metcon' | null;
  movementName: string;
  sets: number;
  reps: string;
  isWarmup: boolean;
  rpe: string;
  rest: number;
  tempo: string;
  mode: ModeKey;
  note: string;
}

const EMPTY_DRAFT: Draft = {
  blockKind: null, movementName: '', sets: 3, reps: '', isWarmup: false,
  rpe: '', rest: 90, tempo: '', mode: 'reps_kg', note: '',
};

export function GuidedFlow({
  session,
  onChange,
  onClose,
}: {
  session: CoachSession;
  onChange: (s: CoachSession) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<FlowStep>('block-type');
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const flowState: FlowState = { blockKind: draft.blockKind, isWarmupSet: draft.isWarmup };

  const go = (dir: 'next' | 'prev') => {
    const s = dir === 'next' ? nextStep(step, flowState) : prevStep(step, flowState);
    if (s) setStep(s);
    else if (dir === 'prev') onClose();
  };

  /** Turns the draft into a real block, appends it, and returns to the overview. */
  const commitBlock = () => {
    if (draft.blockKind === 'cond') {
      const cb = newCondBlock();
      onChange({ ...session, blocks: [...session.blocks, cb] });
    } else if (draft.blockKind === 'metcon') {
      onChange({ ...session, blocks: [...session.blocks, { ...newTextBlock(), body: draft.note }] });
    } else {
      const target = draft.isWarmup ? 'W' + draft.reps : draft.reps;
      const sets = Array.from({ length: draft.sets }, () => ({ t: target, rpe: draft.isWarmup ? '' : draft.rpe }));
      const ex = { ...newEx(), name: draft.movementName, sets, rest: draft.rest, tempo: draft.tempo, mode: draft.mode };
      const block = draft.blockKind === 'warmup' ? newWarmupBlock() : newBlock();
      block.exercises = [ex];
      onChange({ ...session, blocks: [...session.blocks, block] });
    }
    setDraft(EMPTY_DRAFT);
    setStep('review');
  };

  const letters = sessionLetters({ id: session.id, date: '', status: 'completed', blocks: session.blocks });

  if (step === 'review') {
    return (
      <ReviewScreen
        session={session}
        letters={letters}
        onAddBlock={() => setStep('block-type')}
        onDuplicate={(bi, ei) => {
          const b = session.blocks[bi];
          if (isCond(b) || isText(b)) return;
          const blocks = [...session.blocks];
          blocks[bi] = { ...b, exercises: duplicateExercise(blockExercises(b), ei) };
          onChange({ ...session, blocks });
        }}
        onChainToggle={(bi, ei) => {
          const b = session.blocks[bi];
          if (isCond(b) || isText(b)) return;
          const exs = blockExercises(b).map((e, i) => (i === ei ? { ...e, ssNext: !e.ssNext } : e));
          const blocks = [...session.blocks];
          blocks[bi] = { ...b, exercises: exs };
          onChange({ ...session, blocks });
        }}
        onPublish={() => setStep('publish' as FlowStep)}
        onClose={onClose}
      />
    );
  }

  if (step === ('publish' as FlowStep)) return <PublishStep sess={session} />;

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center gap-1 border-b border-line px-2 py-1">
        <button onClick={() => go('prev')} aria-label="back" className={GHOST}>
          ‹ Back
        </button>
        <span className="num text-3 text-dim">
          {session.name || 'Session'} · {stepsFor(flowState).indexOf(step) + 1} of {stepsFor(flowState).length}
        </span>
      </header>
      <div className="flex-1">
        {step === 'block-type' ? (
          <BlockTypeStep onPick={(kind) => { setDraft((d) => ({ ...d, blockKind: kind })); go('next'); }} />
        ) : step === 'movement' ? (
          <MovementStep current={draft.movementName} onPick={(name) => { setDraft((d) => ({ ...d, movementName: name })); go('next'); }} />
        ) : step === 'sets' ? (
          <SetsStep count={draft.sets} onChange={(n) => setDraft((d) => ({ ...d, sets: n }))} />
        ) : step === 'reps' ? (
          <RepsStep
            value={draft.reps}
            isWarmup={draft.isWarmup}
            onChange={(v) => setDraft((d) => ({ ...d, reps: v }))}
            onWarmupToggle={(v) => setDraft((d) => ({ ...d, isWarmup: v }))}
          />
        ) : step === 'rpe' ? (
          <RpeStep value={draft.rpe} onChange={(v) => setDraft((d) => ({ ...d, rpe: v }))} />
        ) : step === 'more' ? (
          <MoreStep
            rest={draft.rest} tempo={draft.tempo} mode={draft.mode} note={draft.note}
            onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
            onDone={commitBlock}
          />
        ) : null}
      </div>
      {step !== 'sets' && step !== 'reps' && step !== 'rpe' ? null : (
        <footer className="flex justify-end gap-1 border-t border-line p-1">
          <button onClick={() => go('next')} className={GHOST}>Next ›</button>
        </footer>
      )}
    </div>
  );
}

/** The session overview reached at the end of the flow — the same block/exercise
 *  list and superset seam Editor.tsx had, just as this flow's landing screen. */
function ReviewScreen({
  session, letters, onAddBlock, onDuplicate, onChainToggle, onPublish, onClose,
}: {
  session: CoachSession;
  letters: Record<number, string[]>;
  onAddBlock: () => void;
  onDuplicate: (blockIndex: number, exIndex: number) => void;
  onChainToggle: (blockIndex: number, exIndex: number) => void;
  onPublish: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex min-h-full flex-col gap-2 p-3">
      <header className="flex items-center gap-1">
        <button onClick={onClose} className={GHOST}>‹ Done for now</button>
        <h1 className="ml-1 text-7 font-[800]">{session.name || 'Session'}</h1>
      </header>
      {session.blocks.map((b, bi) => (
        <section key={b.id} className="rounded-md border border-line p-2">
          <div className={'text-3 font-[750] uppercase tracking-[.12em] text-gold2'}>{b.heading || 'Block'}</div>
          {isCond(b) || isText(b) ? null : (
            <ul className="mt-1 flex flex-col gap-1">
              {blockExercises(b).map((ex, ei) => (
                <li key={ex.id} className="flex items-center gap-1">
                  <Ltr>{letters[bi]?.[ei] ?? '?'}</Ltr>
                  <span className="min-w-0 flex-1 truncate text-4">{ex.name || 'Exercise'}</span>
                  <button onClick={() => onDuplicate(bi, ei)} className={GHOST}>Duplicate</button>
                  <button onClick={() => onChainToggle(bi, ei)} className={GHOST}>{ex.ssNext ? 'Split' : 'Chain'}</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
      <button onClick={onAddBlock} className={GHOST}>＋ Add another block</button>
      <button onClick={onPublish} className={GHOST + ' mt-auto'}>Continue to publish ›</button>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @hybrid/coach typecheck`
Expected: PASS. If it doesn't, the likeliest cause is a mismatch between this task's assumed `Ltr`/`GHOST` exports from `../ui` and what that file actually exports — check `apps/coach/src/ui.tsx`'s export list and adjust the import.

- [ ] **Step 3: Commit**

```bash
git add apps/coach/src/builder/GuidedFlow.tsx
git commit -m "Coach: GuidedFlow orchestrator and review screen"
```

---

### Task 8: Wire into App.tsx

**Files:**
- Modify: `apps/coach/src/App.tsx`

**Interfaces:**
- Consumes: `WeekGrid` (Task 3), `GuidedFlow` (Task 7).
- Produces: nothing further downstream — this is the integration point.

Per this plan's file-structure decision: **Plan view drops the narrow day-list `<aside>` and the grid spans the full width where the aside+editor combination used to be.** Home view (`Dashboard`) keeps its current 3-column shell unchanged — this redesign does not touch Home.

- [ ] **Step 1: Replace the `Shell` component's grid/view logic**

In `apps/coach/src/App.tsx`, replace the `Shell` function's body (currently rendering a fixed 3-column grid with `Rail` / `TopBar` / `<aside>` day list / `<main>`) so that when `view === 'plan'`, the layout is just `Rail` + `TopBar` + a full-width area holding either `WeekGrid` or `GuidedFlow`:

```tsx
function Shell() {
  const { lib, day, setDay, select, addWeek } = useLib();
  const prog = lib.programs[lib.sel.p];
  const week = prog.weeks[lib.sel.w];
  const [view, setView] = useState<'home' | 'plan'>('home');
  const [editingDay, setEditingDay] = useState<number | null>(null);
  const written = week.days.filter(Boolean).length;

  if (view === 'plan') {
    return (
      <div className="grid h-full min-w-[1080px] grid-cols-[80px_minmax(0,1fr)] grid-rows-[64px_minmax(0,1fr)]">
        <Rail view={view} onView={setView} week={lib.sel.w} weeks={prog.weeks.length} written={written} onSelect={(w) => select({ w })} onCreate={addWeek} />
        <TopBar programme={prog.name} />
        <main className="col-span-2 min-h-0 overflow-y-auto">
          {editingDay != null && week.days[editingDay] ? (
            <GuidedFlow
              session={week.days[editingDay]!}
              onChange={(s) => { select({ d: editingDay }); setDay(s); }}
              onClose={() => setEditingDay(null)}
            />
          ) : (
            <WeekGrid
              onEdit={(i) => setEditingDay(i)}
              onCreate={(i, s) => { select({ d: i }); setDay(s); setEditingDay(i); }}
            />
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="grid h-full min-w-[1080px] grid-cols-[80px_320px_minmax(0,1fr)] grid-rows-[64px_minmax(0,1fr)]">
      <Rail view={view} onView={setView} week={lib.sel.w} weeks={prog.weeks.length} written={written} onSelect={(w) => select({ w })} onCreate={addWeek} />
      <TopBar programme={prog.name} />
      <aside className="flex min-h-0 flex-col border-r border-line bg-panel3">
        <div className="flex shrink-0 items-baseline gap-1 border-b border-line px-2 py-1">
          <h2 className={MICRO}>Week</h2>
          <span className="num text-7 leading-none font-[800] text-gold2">{lib.sel.w + 1}</span>
          <span className="num ml-auto text-2 text-muted">{written} of 7 written</span>
        </div>
        <ol className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-1">
          {week.days.map((s, i) => (
            <DayRow key={i} index={i} sess={s} on={i === lib.sel.d} onClick={() => select({ d: i })} />
          ))}
        </ol>
        <AccountPanel />
      </aside>
      <main className="min-h-0 overflow-y-auto">
        <Dashboard />
      </main>
    </div>
  );
}
```

Add the two new imports (`WeekGrid` from `./builder/WeekGrid`, `GuidedFlow` from `./builder/GuidedFlow`) alongside the existing ones, and remove `Editor`, `newSession`, `RestDay`'s call site, and the `publishing`/`setPublishing` state that only `Editor` used (check whether `RestDay` is still referenced anywhere else before deleting its definition — it currently is only used from the old Plan `<main>` branch this step removes).

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @hybrid/coach typecheck`
Expected: FAIL initially on unused imports/now-dead `RestDay`/`preview`/`DayRow` if they're no longer referenced from this file's Plan-view branch — `DayRow` is still used by the Home-view `<aside>` above, so keep it; `RestDay` and the old `preview` function are dead once Plan view no longer renders them — remove both and their now-unused imports.

- [ ] **Step 3: Fix and re-typecheck**

Run: `pnpm --filter @hybrid/coach typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/coach/src/App.tsx
git commit -m "Coach: wire WeekGrid and GuidedFlow into the Plan view"
```

---

### Task 9: Delete the dead dense editor

**Files:**
- Delete: `apps/coach/src/Editor.tsx`
- Delete: `apps/coach/src/editor/ExerciseCard.tsx`
- Delete: `apps/coach/src/editor/ConditioningCard.tsx`
- Delete: `apps/coach/src/editor/TextBlockCard.tsx`
- Delete: `apps/coach/src/editor/SessionGlance.tsx`

`apps/coach/src/editor/MovementPicker.tsx` is NOT deleted — `MovementStep.tsx` (Task 4) imports it directly and it stays exactly as it is.

- [ ] **Step 1: Delete the five files**

```bash
rm apps/coach/src/Editor.tsx apps/coach/src/editor/ExerciseCard.tsx apps/coach/src/editor/ConditioningCard.tsx apps/coach/src/editor/TextBlockCard.tsx apps/coach/src/editor/SessionGlance.tsx
```

- [ ] **Step 2: Grep for anything still referencing them**

```bash
grep -rn "from './Editor'\|from '../Editor'\|ExerciseCard\|ConditioningCard\|TextBlockCard\|SessionGlance" apps/coach/src apps/coach/test
```

Expected: no output. If anything remains, it's a stray import to remove.

- [ ] **Step 3: Typecheck and run the coach test suite**

Run: `pnpm --filter @hybrid/coach typecheck && pnpm --filter @hybrid/coach test`
Expected: PASS. `apps/coach/test/model.test.ts` and `dashboard.test.ts` don't reference any deleted file (they test `model.ts` and `Dashboard.tsx`, both untouched by this plan), so they should be unaffected.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Coach: delete the dense editor and its now-dead subcomponents"
```

---

### Task 10: End-to-end react-smoke scenario

**Files:**
- Modify: `checks/react-smoke.mjs`

**Interfaces:**
- Consumes: nothing new — drives the built coach app in a real browser, same as every other check in this file.

The existing coach-builder assertions (`"coach builder mounts"`, `"a session can be authored and validates against the emit contract"`, `"a logger-owned field in the coach library cannot reach an athlete"`, `"the superset seam chains two cards into one unit"`) were written against the old dense editor's DOM (`aria-label="session name"`, `input[aria-label="target for set 1"]`, `button:has-text("Add a session")`, etc.) and no longer match anything after Task 9's deletion. Replace them with one flow that exercises the new grid → guided flow → publish path end to end.

- [ ] **Step 1: Replace the coach-app section of `checks/react-smoke.mjs`**

Read the current four coach-builder `await t(...)` blocks (search for `/* ---------- coach app ---------- */`) and replace them with:

```js
await t('coach builder mounts on the grid', async () => {
  await page.goto(base + '/coach/', { waitUntil: 'networkidle' });
  await page.waitForSelector('text=THE Hybrid System');
  await page.click('button[aria-label="Plan"]');
  await page.waitForSelector('text=Week 1');
  const txt = await page.textContent('body');
  assert(/Day 1/.test(txt), 'day rows missing from the grid');
  assert(/Create a session/.test(txt), 'empty-cell action missing');
});

await t('creating a session opens the guided flow, and a lift can be authored end to end', async () => {
  await page.click('button:has-text("Create a session")');
  await page.waitForSelector('text=What are we doing?');
  await page.click('button:has-text("Lift")');
  await page.waitForSelector('text=Choose a movement');
  await page.click('button:has-text("Back Squat")');
  await page.waitForSelector('text=How many sets?');
  await page.click('button:has-text("Next")');
  await page.waitForSelector('text=How many reps?');
  await page.click('button:has-text("8")');
  await page.click('button:has-text("Next")');
  await page.waitForSelector('text=How hard should it feel?');
  await page.click('button:has-text("RPE 8")');
  await page.click('button:has-text("Next")');
  await page.waitForSelector('text=Anything else?');
  await page.click('button:has-text("Done")');
  const txt = await page.textContent('body');
  assert(/Back Squat/.test(txt), 'authored exercise missing from the review screen');
});

await t('a warm-up set skips the RPE step', async () => {
  await page.click('button:has-text("＋ Add another block")');
  await page.click('button:has-text("Lift")');
  await page.click('button:has-text("Back Squat")');
  await page.click('button:has-text("Next")');
  await page.waitForSelector('text=How many reps?');
  await page.click('input[type="checkbox"]');
  await page.click('button:has-text("5")');
  await page.click('button:has-text("Next")');
  const txt = await page.textContent('body');
  assert(!/How hard should it feel\?/.test(txt), 'a warm-up set should skip straight past the RPE step');
});

await t('publish reachable, and validates against the emit contract signed out', async () => {
  await page.click('button:has-text("Continue to publish")');
  await page.waitForSelector('text=Ready to send');
  await page.click('button:has-text("Validate & publish")');
  await page.waitForSelector('text=ready to send');
  const txt = await page.textContent('body');
  assert(!/Could not validate/.test(txt), 'emit contract rejected a valid session: ' + txt.slice(0, 300));
});
```

- [ ] **Step 2: Run the smoke check**

Run: `pnpm run build:site && node checks/react-smoke.mjs`
Expected: initially likely FAIL on some selector mismatch — the exact button text/copy in the real rendered app may differ slightly from what Tasks 3–7 wrote (e.g. `RpeStep`'s chip reads `"RPE 8"` — confirm the real accessible text matches what's asserted). Fix the check's selectors to match the actual DOM, not the other way around.

- [ ] **Step 3: Re-run until green**

Run: `node checks/react-smoke.mjs`
Expected: PASS — all coach-app checks, plus every pre-existing athlete-app check still green (this task must not touch the athlete-app assertions above the `/* ---------- coach app ---------- */` marker).

- [ ] **Step 4: Commit**

```bash
git add checks/react-smoke.mjs
git commit -m "checks: replace coach-builder smoke assertions with the guided-flow path"
```

---

### Task 11: Full verification and push

**Files:** none (verification only)

- [ ] **Step 1: Run every test suite**

Run: `pnpm run test`
Expected: PASS — `packages/engine` (untouched by this plan), `apps/coach` (new `grid.test.ts`, `flowSteps.test.ts`, existing `model.test.ts`/`dashboard.test.ts`), `apps/mobile` (untouched).

- [ ] **Step 2: Run the full verify chain**

Run: `pnpm run verify`
Expected: PASS — typecheck, test, `build:site`, `check:csp`, `smoke` (Task 10's rewritten scenario plus every untouched athlete-app assertion), `smoke:deploy`.

- [ ] **Step 3: Run the checks `verify` doesn't cover**

```bash
node checks/contrast.mjs
node checks/web-touch.mjs
node checks/docs.mjs
```

Expected: all PASS. `docs.mjs` in particular catches a stale README reference to `Editor.tsx` or any of the deleted subcomponents, if one exists.

- [ ] **Step 4: Grep for stragglers**

```bash
grep -rn "sessionToWorkout\|ExerciseCard\|ConditioningCard\|TextBlockCard\|SessionGlance\|from './Editor'" apps/coach/src apps/coach/test
```

Expected: no output.

- [ ] **Step 5: Commit and push**

```bash
git push origin main
```

- [ ] **Step 6: Confirm CI and OTA**

Poll `GET /repos/reflectprotect123-max/THE-HYBRID-ENGINE1/actions/runs` for each pushed commit's SHA. Confirm CI reaches `completed`/`success`. This plan touches no `packages/engine` files, so `mobile-ota.yml` should not need to fire for these commits — if it does anyway, confirm whether its `Publish EAS Update` step ran or was skipped, and that either outcome is expected given what actually changed.
