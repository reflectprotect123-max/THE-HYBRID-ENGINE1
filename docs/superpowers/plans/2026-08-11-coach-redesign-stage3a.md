# Coach Redesign Stage 3a — Library Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the coach Library's spine — a tagged exercise catalogue, the Calendar month view, and a two-mode day builder with the mockup's full block/picker/set editor, which the guided wizard now finishes into.

**Architecture:** The mockup's stylesheet already ships (Stage 1 ported it whole, including 43 `lib-`, 36 `cal-`, 142 `cb-` rules), so every task writes JSX against existing class names and adds no CSS. Pure logic — month-grid maths, catalogue derivation, set-column rules — lives in `packages/` with its own tests, never in JSX. The day builder is one component with two modes rather than two components.

**Tech Stack:** React 19 + react-router-dom 7, TypeScript, Vitest + @testing-library/react, plain CSS (mockup-sourced, already present), Vite.

## Reference

The approved mockup:
`/root/.claude/projects/-home-user-THE-HYBRID-ENGINE1/d30b5cca-0c7a-5866-8a26-5d3b78a831cf/tool-results/artifact-d7069c12-1786398549-c8fe.html`

It is large — never read it whole. Extract sections:

```bash
awk '/id="view-library"/,/id="view-settings"/' <path>   # markup: tabs, calendar, day builder
sed -n '1758,1800p' <path>                              # the catalogue + column constants
sed -n '1875,1935p' <path>                              # the block/picker markup the script builds
```

**Read the relevant block before writing each screen.** Do not reproduce it from memory or from this plan's excerpts alone.

Spec: `docs/superpowers/specs/2026-08-11-stage3a-library-spine-design.md` — note its **Amendment** section, which reverses the spec's original "reuse the shared editor" instruction.

## Global Constraints

- **The mockup is the visual specification.** Class names and structure are copied from it, not reinvented. Where this plan and the mockup disagree, the mockup wins and the discrepancy is reported.
- **The CSS already exists.** `apps/web/src/coach/coach-redesign.css` carries every `lib-`, `cal-`, `cb-` rule. Do not add CSS. If a class appears to be missing, grep before writing one — and report it rather than inventing a style.
- **Every value comes from real data.** The mockup's eight seeded exercises, its "August 2026", its "Tuesday, August 11" are placeholders. No hardcoded athlete or catalogue data ships.
- **Absent data is stated, never faked.** A program with no sessions, a day with nothing on it, a movement with no tags — each says so. None renders as a blank that reads like a bug.
- **Publish PROPOSES.** It calls `repository.publishWorkoutDraft`, which routes through the same Coordinator-placement path as assigning a template. The Coordinator remains the only writer of a weekly plan.
- **A date in this UI is a PREFERENCE, not a placement.** `CoachAuthoring` already labels its day toggles "PREFERRED DAYS · INPUT, NOT PLACEMENT" and states "preferences are not resolved calendar positions". The Calendar and day builder must not contradict their sibling screen.
- **Tags are coach-assigned, never guessed.** The movement LIST derives from `knownMovements(db.workouts, db.sessions)`; the TAGS come from a coach-owned store. An untagged movement is untagged — it is not inferred from the block it appeared in.
- **Every coach route stays behind `ClientDetailGate` without `layer3Ready`** unless it has a real layer-3 backend.
- **Tests are colocated.** `src/foo.ts` is tested by `src/foo.test.ts` in the same directory. Never under `test/`.
- **A tab appears only when it has something behind it.** Stage 1 shipped three routes nobody could reach; a tab opening onto nothing is the same defect.
- Before every commit: `pnpm --filter @hybrid/web exec tsc --noEmit -p .`, `pnpm --filter @hybrid/web exec vitest run`, and `node checks/coach-contract.mjs` must all pass.

## File Structure

| File | Responsibility |
|---|---|
| `packages/engine/src/catalogue.ts` (create) | Derive the tagged movement catalogue from workouts, sessions and a tag store |
| `packages/engine/src/catalogue.test.ts` (create) | Colocated tests for the above |
| `packages/engine/src/month.ts` (create) | Pure month-grid maths for the Calendar |
| `packages/engine/src/month.test.ts` (create) | Colocated tests for the above |
| `packages/engine/src/setColumns.ts` (create) | The two-measure column model and its lock rule |
| `packages/engine/src/setColumns.test.ts` (create) | Colocated tests for the above |
| `apps/web/src/coach/library/CalendarMonth.tsx` + `.test.tsx` | The month grid, its toolbar, empty and filled day cells |
| `apps/web/src/coach/library/DayBuilder.tsx` + `.test.tsx` | The day builder shell: heading, status, instructions, publish/save |
| `apps/web/src/coach/library/BlockEditor.tsx` + `.test.tsx` | One block: collapse, category, remove, its body |
| `apps/web/src/coach/library/ExercisePicker.tsx` + `.test.tsx` | Search, filter chips with counts, results, new-exercise action |
| `apps/web/src/coach/library/SetRows.tsx` + `.test.tsx` | Set rows and the two configurable measure columns |
| `apps/web/src/coach/CoachLibrary.tsx` (modify) | Tab shell: Programs + Calendar |
| `apps/web/src/screens/guided/GuidedBuilder.tsx` (modify) | End the wizard at the day builder, not the Planner |
| `apps/web/src/coach/index.tsx` (modify) | Route the day builder |
| `checks/screens.mjs` (modify) | Library at 420px with a content assertion |

Nine tasks. The three `packages/engine` modules come first because every screen consumes them, and each is pure and independently testable.

---

### Task 1: The tagged movement catalogue

**Files:**
- Create: `packages/engine/src/catalogue.ts`
- Test: `packages/engine/src/catalogue.test.ts`

**Interfaces:**
- Consumes: `blockExercises(b)` from `packages/engine/src/session.ts`.

**CORRECTED during execution.** The plan first said to build on `knownMovements`. Do not. It lives in `./session` (not `./movements`) and it filters to `isLiftMode(e.mode)` — `reps_kg` and `amrap` only — because its job is to stop one LIFT being spelled two ways, where `exLogFor`, `detectPRs` and `bestE1rmByLift` all key on the name. The picker must offer conditioning movements too; the mockup's own seed tags "Row Erg" as Conditioning. So `knownMovements` keeps its lift-only contract untouched, and the catalogue derives beside it — copying only its de-duplication rule (case-insensitive, freshest spelling wins), because two lists disagreeing about "Back Squat" versus "back squat" is worse than either alone.
- Produces:
  ```ts
  export interface CatalogueEntry { name: string; tags: string[]; uses: number }
  export interface TagCount { tag: string; count: number }
  export const CATALOGUE_TAGS: readonly string[];
  export function buildCatalogue(
    workouts: Workout[],
    sessions: Session[],
    tagsByMovement: Record<string, string[]> | undefined,
  ): CatalogueEntry[];
  export function tagCounts(entries: CatalogueEntry[]): TagCount[];
  export function filterCatalogue(
    entries: CatalogueEntry[],
    query: string,
    activeTags: string[],
  ): CatalogueEntry[];
  ```
  Tasks 4 and 6 consume all of these.

`CATALOGUE_TAGS` is the mockup's `FILTER_TAGS`, verbatim: `['Bodyweight', 'Barbell', 'Warm-up', 'Band', 'Conditioning']`.

A movement with no entry in `tagsByMovement` has `tags: []`. It is never inferred from context — the constraint above is the whole point of this task.

- [ ] **Step 1: Write the failing test**

Create `packages/engine/src/catalogue.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildCatalogue, filterCatalogue, tagCounts, CATALOGUE_TAGS } from './catalogue';
import type { Session, Workout } from './types';

/*
 * The catalogue DERIVES its movement list from what the athlete actually has —
 * authored workouts and logged sessions, via `knownMovements` — and takes its
 * tags from a coach-owned store. It never invents a tag from context: a
 * movement that appeared in a conditioning block is not thereby "Conditioning",
 * because that is a guess wearing the costume of a fact.
 */
function w(id: string, movement: string): Workout {
  return {
    id,
    name: id,
    updatedAt: 1,
    blocks: [{ id: `${id}-b`, exercises: [{ id: `${id}-e`, name: movement, sets: [] }] }],
  } as unknown as Workout;
}

describe('buildCatalogue', () => {
  it('lists every movement the athlete actually has, once each', () => {
    const out = buildCatalogue([w('a', 'Back Squat'), w('b', 'Back Squat'), w('c', 'Row Erg')], [], undefined);
    expect(out.map((e) => e.name).sort()).toEqual(['Back Squat', 'Row Erg']);
  });

  it('counts how often a movement is used', () => {
    const out = buildCatalogue([w('a', 'Back Squat'), w('b', 'Back Squat')], [], undefined);
    expect(out.find((e) => e.name === 'Back Squat')?.uses).toBe(2);
  });

  it('takes tags from the store, and leaves an unlisted movement untagged', () => {
    const out = buildCatalogue([w('a', 'Back Squat'), w('b', 'Row Erg')], [], { 'Back Squat': ['Barbell'] });
    expect(out.find((e) => e.name === 'Back Squat')?.tags).toEqual(['Barbell']);
    expect(out.find((e) => e.name === 'Row Erg')?.tags).toEqual([]);
  });

  it('returns nothing for an athlete with no workouts and no sessions', () => {
    expect(buildCatalogue([], [], undefined)).toEqual([]);
  });
});

describe('tagCounts', () => {
  it('counts each tag across the catalogue and reports zero for unused ones', () => {
    const entries = buildCatalogue([w('a', 'Back Squat'), w('b', 'Pull-Up')], [], {
      'Back Squat': ['Barbell'],
      'Pull-Up': ['Bodyweight', 'Band'],
    });
    const counts = tagCounts(entries);
    expect(counts.find((c) => c.tag === 'Barbell')?.count).toBe(1);
    expect(counts.find((c) => c.tag === 'Bodyweight')?.count).toBe(1);
    expect(counts.find((c) => c.tag === 'Warm-up')?.count).toBe(0);
    expect(counts.map((c) => c.tag)).toEqual([...CATALOGUE_TAGS]);
  });
});

describe('filterCatalogue', () => {
  const entries = buildCatalogue([w('a', 'Back Squat'), w('b', 'Pull-Up'), w('c', 'Row Erg')], [], {
    'Back Squat': ['Barbell'],
    'Pull-Up': ['Bodyweight'],
  });

  it('matches a search regardless of case', () => {
    expect(filterCatalogue(entries, 'squat', []).map((e) => e.name)).toEqual(['Back Squat']);
  });

  it('filters to movements carrying ANY active tag', () => {
    expect(filterCatalogue(entries, '', ['Bodyweight']).map((e) => e.name)).toEqual(['Pull-Up']);
  });

  it('applies search and tags together', () => {
    expect(filterCatalogue(entries, 'u', ['Bodyweight']).map((e) => e.name)).toEqual(['Pull-Up']);
  });

  it('returns everything when nothing is asked for', () => {
    expect(filterCatalogue(entries, '', []).length).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hybrid/engine exec vitest run src/catalogue.test.ts`
Expected: FAIL — `buildCatalogue` is not exported from `./catalogue`.

- [ ] **Step 3: Implement**

Create `packages/engine/src/catalogue.ts`. Read `knownMovements` in this package first and call it rather than re-deriving; it already handles both workouts and logged sessions.

```ts
import { knownMovements } from './movements';
import type { Session, Workout } from './types';

/** The filter tags the coach bench offers, from the approved mockup's FILTER_TAGS. */
export const CATALOGUE_TAGS = ['Bodyweight', 'Barbell', 'Warm-up', 'Band', 'Conditioning'] as const;

export interface CatalogueEntry { name: string; tags: string[]; uses: number }
export interface TagCount { tag: string; count: number }

/**
 * The movement list is DERIVED; the tags are DECLARED.
 *
 * Deriving a tag from context — calling a movement "Conditioning" because it
 * once appeared in a conditioning block — would put a guess in a field a coach
 * reads as a fact, and would then filter on it. An untagged movement stays
 * untagged until someone says otherwise.
 */
export function buildCatalogue(
  workouts: Workout[],
  sessions: Session[],
  tagsByMovement: Record<string, string[]> | undefined,
): CatalogueEntry[] {
  const names = knownMovements(workouts, sessions);
  const uses = new Map<string, number>();
  for (const w of workouts) {
    for (const b of w.blocks ?? []) {
      for (const e of (b as { exercises?: { name?: string }[] }).exercises ?? []) {
        if (e?.name) uses.set(e.name, (uses.get(e.name) ?? 0) + 1);
      }
    }
  }
  return names.map((name) => ({
    name,
    tags: tagsByMovement?.[name] ?? [],
    uses: uses.get(name) ?? 0,
  }));
}

export function tagCounts(entries: CatalogueEntry[]): TagCount[] {
  return CATALOGUE_TAGS.map((tag) => ({
    tag,
    count: entries.filter((e) => e.tags.includes(tag)).length,
  }));
}

export function filterCatalogue(entries: CatalogueEntry[], query: string, activeTags: string[]): CatalogueEntry[] {
  const q = query.trim().toLowerCase();
  return entries.filter((e) => {
    if (q && !e.name.toLowerCase().includes(q)) return false;
    if (activeTags.length && !activeTags.some((t) => e.tags.includes(t))) return false;
    return true;
  });
}
```

Traverse via `blockExercises(b)` — a block's exercises are not always on `.exercises`, and that helper is the one the rest of the engine uses.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hybrid/engine exec vitest run src/catalogue.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Export from the package index**

`packages/engine/src/index.ts` uses `export * from './...'` per module. Add `export * from './catalogue';` beside its neighbours.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/catalogue.ts packages/engine/src/catalogue.test.ts packages/engine/src/index.ts
git commit -m "Derive a tagged movement catalogue from real usage

The list comes from knownMovements — what the athlete has actually
authored and logged. The tags come from a coach-owned store. A tag is
never inferred from the block a movement appeared in: that is a guess in
a field the picker then filters on."
```

---

### Task 2: Month-grid maths

**Files:**
- Create: `packages/engine/src/month.ts`
- Test: `packages/engine/src/month.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface MonthCell { date: string; inMonth: boolean; dayOfMonth: number }
  export function monthGrid(year: number, month1to12: number): MonthCell[];
  export function calendarMonthLabel(year: number, month1to12: number): string;
  export function shiftMonth(year: number, month1to12: number, delta: number): { year: number; month: number };
  ```
  Task 5 consumes all three.

The grid is Monday-first, matching the mockup's `Mon Tue Wed Thu Fri Sat Sun` header row. `date` is `YYYY-MM-DD`. Leading and trailing cells from the neighbouring months are included with `inMonth: false` — the mockup renders them dimmed.

All maths is UTC. `mondayOf` in `@hybrid/coordinator-adapter` already establishes UTC week handling in this system; a local-time grid would shift a day for a coach in the wrong timezone.

- [ ] **Step 1: Write the failing test**

Create `packages/engine/src/month.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { monthGrid, monthLabel, shiftMonth } from './month';

/*
 * UTC throughout. A local-time month grid puts a coach in UTC-7 on the wrong
 * day for the first seven hours of every day, which is the kind of bug that
 * only ever reproduces for the person who cannot debug it.
 */
describe('monthGrid', () => {
  it('starts on Monday and covers whole weeks', () => {
    const cells = monthGrid(2026, 8);
    expect(cells.length % 7).toBe(0);
    expect(new Date(`${cells[0].date}T00:00:00Z`).getUTCDay()).toBe(1);
  });

  it('marks days outside the month', () => {
    const cells = monthGrid(2026, 8);
    // 1 August 2026 is a Saturday, so the grid opens with July days.
    expect(cells[0].inMonth).toBe(false);
    expect(cells.find((c) => c.date === '2026-08-01')?.inMonth).toBe(true);
  });

  it('contains every day of the month exactly once', () => {
    const inMonth = monthGrid(2026, 8).filter((c) => c.inMonth);
    expect(inMonth.length).toBe(31);
    expect(new Set(inMonth.map((c) => c.date)).size).toBe(31);
  });

  it('handles a February in a leap year', () => {
    expect(monthGrid(2028, 2).filter((c) => c.inMonth).length).toBe(29);
  });
});

describe('shiftMonth', () => {
  it('rolls forward across a year boundary', () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
  });

  it('rolls backward across a year boundary', () => {
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
  });
});

describe('monthLabel', () => {
  it('names the month and year', () => {
    expect(monthLabel(2026, 8)).toBe('August 2026');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hybrid/engine exec vitest run src/month.test.ts`
Expected: FAIL — `monthGrid` is not exported from `./month`.

- [ ] **Step 3: Implement**

Create `packages/engine/src/month.ts`:

```ts
export interface MonthCell { date: string; inMonth: boolean; dayOfMonth: number }

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Monday-first, whole weeks, UTC. Neighbouring-month days are included and flagged. */
export function monthGrid(year: number, month1to12: number): MonthCell[] {
  const first = new Date(Date.UTC(year, month1to12 - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Monday = 0
  const start = new Date(first);
  start.setUTCDate(start.getUTCDate() - lead);

  const cells: MonthCell[] = [];
  const cursor = new Date(start);
  do {
    for (let i = 0; i < 7; i += 1) {
      cells.push({
        date: iso(cursor),
        inMonth: cursor.getUTCMonth() === month1to12 - 1 && cursor.getUTCFullYear() === year,
        dayOfMonth: cursor.getUTCDate(),
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  } while (cursor.getUTCMonth() === month1to12 - 1 && cursor.getUTCFullYear() === year);

  return cells;
}

export function calendarMonthLabel(year: number, month1to12: number): string {
  return `${MONTHS[month1to12 - 1]} ${year}`;
}

export function shiftMonth(year: number, month1to12: number, delta: number): { year: number; month: number } {
  const d = new Date(Date.UTC(year, month1to12 - 1 + delta, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hybrid/engine exec vitest run src/month.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Export and commit**

Add `export * from './month';` to `packages/engine/src/index.ts`.

```bash
git add packages/engine/src/month.ts packages/engine/src/month.test.ts packages/engine/src/index.ts
git commit -m "Add pure Monday-first month-grid maths in UTC

The Calendar needs a grid; a component does not need date arithmetic
inside it. UTC because a local-time grid silently shifts a day for any
coach west of Greenwich."
```

---

### Task 3: The two-measure set column model

**Files:**
- Create: `packages/engine/src/setColumns.ts`
- Test: `packages/engine/src/setColumns.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ColumnType { value: string; label: string; placeholder: string }
  export const COLUMN_TYPES: readonly ColumnType[];
  export function availableSecondColumns(first: string): ColumnType[];
  export function isColumnPairValid(first: string, second: string): boolean;
  ```
  Task 7 consumes all of these.

`COLUMN_TYPES` is the mockup's list, verbatim — six entries, `value`/`label`/`placeholder` exactly as drawn:

```
reps         Reps                    reps
reps_range   Reps (min–max)          e.g. 8-10
weight_kg    Weight (kg)             kg
weight_pct   Weight (% of e1RM)      % e1RM
seconds      Seconds                 sec
meters       Meters                  m
```

Note `Reps (min–max)` uses an EN DASH (–), and `e.g. 8-10` a hyphen. Copy them exactly; the mockup is the specification for copy as well as layout.

The rule, in the mockup's words: "picking the same thing for both would be a real logging mistake, so the second column greys out and locks until the two differ again."

- [ ] **Step 1: Write the failing test**

Create `packages/engine/src/setColumns.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { COLUMN_TYPES, availableSecondColumns, isColumnPairValid } from './setColumns';

/*
 * A set row measures two things. Measuring the same thing twice is not a
 * layout problem — it is a logging mistake that produces a set claiming
 * "8 reps and 8 reps", so the pair is constrained here, in one tested place,
 * rather than by whichever component happens to render the second dropdown.
 */
describe('COLUMN_TYPES', () => {
  it('is the mockup list, in order', () => {
    expect(COLUMN_TYPES.map((c) => c.value)).toEqual([
      'reps', 'reps_range', 'weight_kg', 'weight_pct', 'seconds', 'meters',
    ]);
  });

  it('keeps the mockup labels and placeholders verbatim', () => {
    expect(COLUMN_TYPES[1].label).toBe('Reps (min–max)');
    expect(COLUMN_TYPES[1].placeholder).toBe('e.g. 8-10');
    expect(COLUMN_TYPES[3].label).toBe('Weight (% of e1RM)');
  });
});

describe('availableSecondColumns', () => {
  it('excludes whatever the first column already measures', () => {
    const values = availableSecondColumns('reps').map((c) => c.value);
    expect(values).not.toContain('reps');
    expect(values).toContain('weight_kg');
    expect(values.length).toBe(COLUMN_TYPES.length - 1);
  });

  it('offers everything when the first column is unset', () => {
    expect(availableSecondColumns('').length).toBe(COLUMN_TYPES.length);
  });
});

describe('isColumnPairValid', () => {
  it('rejects a pair measuring the same thing', () => {
    expect(isColumnPairValid('reps', 'reps')).toBe(false);
  });

  it('accepts a pair measuring different things', () => {
    expect(isColumnPairValid('reps', 'weight_kg')).toBe(true);
  });

  it('accepts an incomplete pair — an unset column is not a duplicate', () => {
    expect(isColumnPairValid('reps', '')).toBe(true);
    expect(isColumnPairValid('', '')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hybrid/engine exec vitest run src/setColumns.test.ts`
Expected: FAIL — `COLUMN_TYPES` is not exported from `./setColumns`.

- [ ] **Step 3: Implement**

Create `packages/engine/src/setColumns.ts`:

```ts
export interface ColumnType { value: string; label: string; placeholder: string }

/**
 * The six things a set column can measure, from the approved mockup's
 * COLUMN_TYPES. The engine already stores two values per set — `LoggedSet`'s
 * `aVal` ("primary recorded value — kg for reps_kg, seconds for seconds") and
 * `aVal2` ("secondary recorded value — reps, when the mode has two") — so this
 * is a vocabulary for a model that exists, not a new one.
 */
export const COLUMN_TYPES: readonly ColumnType[] = [
  { value: 'reps', label: 'Reps', placeholder: 'reps' },
  { value: 'reps_range', label: 'Reps (min–max)', placeholder: 'e.g. 8-10' },
  { value: 'weight_kg', label: 'Weight (kg)', placeholder: 'kg' },
  { value: 'weight_pct', label: 'Weight (% of e1RM)', placeholder: '% e1RM' },
  { value: 'seconds', label: 'Seconds', placeholder: 'sec' },
  { value: 'meters', label: 'Meters', placeholder: 'm' },
] as const;

/** What the second column may still measure once the first has chosen. */
export function availableSecondColumns(first: string): ColumnType[] {
  return COLUMN_TYPES.filter((c) => c.value !== first || first === '');
}

/** An unset column is incomplete, not invalid — only a genuine duplicate fails. */
export function isColumnPairValid(first: string, second: string): boolean {
  if (!first || !second) return true;
  return first !== second;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hybrid/engine exec vitest run src/setColumns.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Export and commit**

Add `export * from './setColumns';` to `packages/engine/src/index.ts`.

```bash
git add packages/engine/src/setColumns.ts packages/engine/src/setColumns.test.ts packages/engine/src/index.ts
git commit -m "Constrain a set row's two measure columns in one tested place

Measuring the same thing twice produces a set claiming '8 reps and 8
reps'. The rule belongs beside the vocabulary, not in whichever component
renders the second dropdown."
```

---

### Task 4: The exercise picker

**Files:**
- Create: `apps/web/src/coach/library/ExercisePicker.tsx`
- Test: `apps/web/src/coach/library/ExercisePicker.test.tsx`

**Interfaces:**
- Consumes: `buildCatalogue`, `filterCatalogue`, `tagCounts`, `CATALOGUE_TAGS`, `CatalogueEntry` from `@hybrid/engine` (Task 1).
- Produces:
  ```tsx
  export function ExercisePicker(props: {
    entries: CatalogueEntry[];
    onPick: (name: string) => void;
    onNewExercise: (name: string) => void;
    onDone: () => void;
  }): JSX.Element;
  ```
  Task 6 mounts this.

**Read the mockup first**: `sed -n '1890,1905p' <artifact>` for the picker's structure. Classes, in order: `cb-picker`, `cb-picker-search`, `cb-picker-count` (containing `cb-count-n` and `cb-clear-filters`), `cb-picker-filters` (of `cb-filter-chip` labels each wrapping a checkbox and a `span.n` count), `cb-picker-list`, `cb-picker-actions` (with `cb-new-circuit`, `cb-new-exercise`, `cb-picker-done`).

`+ New circuit` is **not** wired in this stage — Circuit has no definition in this system (see `2026-08-11-stage3c-sessions-exercises-design.md`). Render the button per the mockup and leave it disabled with a title explaining it is not yet available. Do not silently render a dead button.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/coach/library/ExercisePicker.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { CatalogueEntry } from '@hybrid/engine';
import { ExercisePicker } from './ExercisePicker';

const entries: CatalogueEntry[] = [
  { name: 'Back Squat', tags: ['Barbell'], uses: 3 },
  { name: 'Pull-Up', tags: ['Bodyweight', 'Band'], uses: 1 },
  { name: 'Row Erg', tags: ['Conditioning'], uses: 0 },
];

function renderPicker(over: Partial<Parameters<typeof ExercisePicker>[0]> = {}) {
  const props = { entries, onPick: vi.fn(), onNewExercise: vi.fn(), onDone: vi.fn(), ...over };
  render(<ExercisePicker {...props} />);
  return props;
}

describe('ExercisePicker', () => {
  it('lists every movement and says how many are shown', () => {
    renderPicker();
    expect(screen.getByText('Back Squat')).toBeInTheDocument();
    expect(screen.getByText('Row Erg')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('narrows the list as you search, and updates the count', () => {
    renderPicker();
    fireEvent.change(screen.getByPlaceholderText(/search the exercise library/i), { target: { value: 'squat' } });
    expect(screen.getByText('Back Squat')).toBeInTheDocument();
    expect(screen.queryByText('Row Erg')).not.toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('filters by tag, and shows each tag with its real count', () => {
    renderPicker();
    expect(screen.getByLabelText(/Bodyweight/i)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Bodyweight/i));
    expect(screen.getByText('Pull-Up')).toBeInTheDocument();
    expect(screen.queryByText('Back Squat')).not.toBeInTheDocument();
  });

  it('clears filters back to the whole list', () => {
    renderPicker();
    fireEvent.click(screen.getByLabelText(/Bodyweight/i));
    fireEvent.click(screen.getByRole('button', { name: /clear filters/i }));
    expect(screen.getByText('Back Squat')).toBeInTheDocument();
  });

  it('reports the movement you pick', () => {
    const props = renderPicker();
    fireEvent.click(screen.getByText('Back Squat'));
    expect(props.onPick).toHaveBeenCalledWith('Back Squat');
  });

  it('says so when a search matches nothing, rather than showing an empty box', () => {
    renderPicker();
    fireEvent.change(screen.getByPlaceholderText(/search the exercise library/i), { target: { value: 'zzzz' } });
    expect(screen.getByText(/no movements match/i)).toBeInTheDocument();
  });

  it('tells an athlete with no movements yet why the list is empty', () => {
    renderPicker({ entries: [] });
    expect(screen.getByText(/no movements in your library yet/i)).toBeInTheDocument();
  });

  it('offers New circuit but disables it, because circuits are not defined yet', () => {
    renderPicker();
    expect(screen.getByRole('button', { name: /new circuit/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/library/ExercisePicker.test.tsx`
Expected: FAIL — cannot resolve `./ExercisePicker`.

- [ ] **Step 3: Implement**

Create `apps/web/src/coach/library/ExercisePicker.tsx`, using the mockup's classes. `filterCatalogue` and `tagCounts` do the work; this component holds only the query and the active tags as state, and renders. No filtering logic inline — it is tested in `packages/engine`.

Both empty states are required and distinct: "No movements match this search." when a filter excluded everything, and "No movements in your library yet — they appear here as you author sessions." when the catalogue itself is empty. Rendering the same message for both would tell an athlete with an empty library that their search was bad.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/library/ExercisePicker.test.tsx`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/coach/library/ExercisePicker.tsx apps/web/src/coach/library/ExercisePicker.test.tsx
git commit -m "Add the exercise picker: search, real tag counts, honest empty states

Two different empty states, deliberately: a search that matched nothing
is not the same fact as a library with nothing in it, and showing one
message for both tells a new athlete their search was wrong."
```

---

### Task 5: The Calendar month view

**Files:**
- Create: `apps/web/src/coach/library/CalendarMonth.tsx`
- Test: `apps/web/src/coach/library/CalendarMonth.test.tsx`

**Interfaces:**
- Consumes: `monthGrid`, `calendarMonthLabel`, `shiftMonth`, `MonthCell` from `@hybrid/engine` (Task 2).
- Produces:
  ```tsx
  export interface CalendarDay { date: string; title: string; published: boolean }
  export function CalendarMonth(props: {
    days: CalendarDay[];
    year: number;
    month: number;
    onMonthChange: (year: number, month: number) => void;
    onCreate: (date: string) => void;
    onAddFromLibrary: (date: string) => void;
    onOpen: (date: string) => void;
  }): JSX.Element;
  ```
  Task 8 mounts this.

**Read the mockup first**: `awk '/id="cal-month-view"/,/id="cal-session-builder"/' <artifact>`. Classes: `cal-toolbar`, `cal-nav`, `lib-icon-btn`, `cal-month`, `cal-grid-scroll`, `cal-grid`, `cal-dow`, `cal-cell` (with `dim` and `empty` modifiers), `cal-date`, `cal-hover`, `cal-hover-link`, `cal-session-card`, `cal-session-title`, `cal-unpublished`.

**Do not render the mockup's `Message team` or `Publish all` toolbar buttons.** The spec cuts both, with reasons.

**The empty-day actions must work by tap, not only hover.** The mockup exposes them on `:hover`; hover does not exist on a phone, and `/coach` is a supported phone surface. Make the cell itself a button that reveals the two actions on click, keeping `cal-hover` for the desktop affordance. A test asserts this.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/coach/library/CalendarMonth.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CalendarMonth, type CalendarDay } from './CalendarMonth';

const days: CalendarDay[] = [{ date: '2026-08-11', title: 'Hinge/Press', published: false }];

function renderCal(over: Partial<Parameters<typeof CalendarMonth>[0]> = {}) {
  const props = {
    days, year: 2026, month: 8,
    onMonthChange: vi.fn(), onCreate: vi.fn(), onAddFromLibrary: vi.fn(), onOpen: vi.fn(),
    ...over,
  };
  render(<CalendarMonth {...props} />);
  return props;
}

describe('CalendarMonth', () => {
  it('names the month and lays out Monday first', () => {
    renderCal();
    expect(screen.getByText('August 2026')).toBeInTheDocument();
    const dows = screen.getAllByText(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/);
    expect(dows[0]).toHaveTextContent('Mon');
  });

  it('moves months in both directions', () => {
    const props = renderCal();
    fireEvent.click(screen.getByRole('button', { name: /next month/i }));
    expect(props.onMonthChange).toHaveBeenCalledWith(2026, 9);
    fireEvent.click(screen.getByRole('button', { name: /previous month/i }));
    expect(props.onMonthChange).toHaveBeenCalledWith(2026, 7);
  });

  it('shows what is on a filled day, and opens it', () => {
    const props = renderCal();
    fireEvent.click(screen.getByText('Hinge/Press'));
    expect(props.onOpen).toHaveBeenCalledWith('2026-08-11');
  });

  it('marks an unpublished day as unpublished', () => {
    renderCal();
    expect(screen.getByText(/unpublished/i)).toBeInTheDocument();
  });

  /*
   * The mockup reveals these on :hover. A phone has no hover, and /coach is a
   * supported phone surface as of Stage 1 — so this asserts the CLICK path,
   * which is the one a desktop reviewer never exercises.
   */
  it('reveals Create session and Add from library on an empty day by TAP', () => {
    const props = renderCal();
    fireEvent.click(screen.getByRole('button', { name: /12 August 2026/i }));
    fireEvent.click(screen.getByRole('button', { name: /create session/i }));
    expect(props.onCreate).toHaveBeenCalledWith('2026-08-12');
  });

  it('offers Add from library on an empty day', () => {
    const props = renderCal();
    fireEvent.click(screen.getByRole('button', { name: /12 August 2026/i }));
    fireEvent.click(screen.getByRole('button', { name: /add from library/i }));
    expect(props.onAddFromLibrary).toHaveBeenCalledWith('2026-08-12');
  });

  it('does not offer the toolbar actions the spec cut', () => {
    renderCal();
    expect(screen.queryByRole('button', { name: /message team/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /publish all/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/library/CalendarMonth.test.tsx`
Expected: FAIL — cannot resolve `./CalendarMonth`.

- [ ] **Step 3: Implement**

Create `apps/web/src/coach/library/CalendarMonth.tsx`. `monthGrid(year, month)` gives the cells; match `days` onto them by `date`. Each empty in-month cell is a `<button>` whose accessible name is the full date ("12 August 2026") so a test and a screen-reader user can both address it.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/library/CalendarMonth.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/coach/library/CalendarMonth.tsx apps/web/src/coach/library/CalendarMonth.test.tsx
git commit -m "Add the Calendar month view, tappable on a phone

The mockup reveals an empty day's actions on hover. Phones have no
hover and /coach is a supported phone surface, so the cell is a button
and the test asserts the click path."
```

---

### Task 6: The block editor

**Files:**
- Create: `apps/web/src/coach/library/BlockEditor.tsx`
- Test: `apps/web/src/coach/library/BlockEditor.test.tsx`

**Interfaces:**
- Consumes: `ExercisePicker` (Task 4), `SetRows` (Task 7 — build this task's picker integration first and mount `SetRows` in Task 7).
- Produces:
  ```tsx
  export const BLOCK_CATEGORIES: readonly string[];
  export function BlockEditor(props: {
    block: { id: string; category: string; exercises: { id: string; name: string }[] };
    entries: CatalogueEntry[];
    index: number;
    onChange: (next: BlockEditorValue) => void;
    onRemove: () => void;
  }): JSX.Element;
  ```

`BLOCK_CATEGORIES` is the mockup's list verbatim: `['Strength/Power', 'Conditioning', 'Warm-up', 'Cooldown', 'Mobility']`.

**Read the mockup first**: `sed -n '1875,1910p' <artifact>`. Classes: `cb-block`, `cb-block-head`, `cb-block-collapse` (with `aria-expanded`), `cb-block-eyebrow`, `cb-block-type` (a `rd-select`), `cb-block-remove`, `cb-block-body-wrap`, `cb-strength-body`, `cb-block-items`, `cb-picker-reveal`.

The eyebrow reads `BLOCK 01`, `BLOCK 02` — zero-padded, from the block's index, as the mockup's `relabelItems` does.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/coach/library/BlockEditor.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { CatalogueEntry } from '@hybrid/engine';
import { BlockEditor, BLOCK_CATEGORIES } from './BlockEditor';

const entries: CatalogueEntry[] = [{ name: 'Back Squat', tags: ['Barbell'], uses: 2 }];
const block = { id: 'b1', category: 'Strength/Power', exercises: [] };

function renderBlock(over: Partial<Parameters<typeof BlockEditor>[0]> = {}) {
  const props = { block, entries, index: 0, onChange: vi.fn(), onRemove: vi.fn(), ...over };
  render(<BlockEditor {...props} />);
  return props;
}

describe('BlockEditor', () => {
  it('numbers the block from its position, zero-padded', () => {
    renderBlock({ index: 2 });
    expect(screen.getByText('BLOCK 03')).toBeInTheDocument();
  });

  it('offers exactly the mockup categories', () => {
    renderBlock();
    BLOCK_CATEGORIES.forEach((c) => {
      expect(screen.getByRole('option', { name: c })).toBeInTheDocument();
    });
  });

  it('reports a category change', () => {
    const props = renderBlock();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Mobility' } });
    expect(props.onChange).toHaveBeenCalledWith(expect.objectContaining({ category: 'Mobility' }));
  });

  it('collapses and expands', () => {
    renderBlock();
    const toggle = screen.getByRole('button', { name: /collapse block/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('removes itself', () => {
    const props = renderBlock();
    fireEvent.click(screen.getByRole('button', { name: /remove block/i }));
    expect(props.onRemove).toHaveBeenCalled();
  });

  it('adds an exercise chosen from the picker', () => {
    const props = renderBlock();
    fireEvent.click(screen.getByRole('button', { name: /add exercise from library/i }));
    fireEvent.click(screen.getByText('Back Squat'));
    expect(props.onChange).toHaveBeenCalledWith(
      expect.objectContaining({ exercises: [expect.objectContaining({ name: 'Back Squat' })] }),
    );
  });

  it('keeps the picker closed until asked', () => {
    renderBlock();
    expect(screen.queryByPlaceholderText(/search the exercise library/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/library/BlockEditor.test.tsx`
Expected: FAIL — cannot resolve `./BlockEditor`.

- [ ] **Step 3: Implement**

Create `apps/web/src/coach/library/BlockEditor.tsx`, mounting `ExercisePicker` behind the `cb-picker-reveal` button.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/library/BlockEditor.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/coach/library/BlockEditor.tsx apps/web/src/coach/library/BlockEditor.test.tsx
git commit -m "Add the block editor with its exercise picker"
```

---

### Task 7: Set rows and the two measure columns

**Files:**
- Create: `apps/web/src/coach/library/SetRows.tsx`
- Test: `apps/web/src/coach/library/SetRows.test.tsx`
- Modify: `apps/web/src/coach/library/BlockEditor.tsx` — mount `SetRows` under each exercise

**Interfaces:**
- Consumes: `COLUMN_TYPES`, `availableSecondColumns`, `isColumnPairValid` from `@hybrid/engine` (Task 3).
- Produces:
  ```tsx
  export function SetRows(props: {
    sets: { id: string; a: string; b: string }[];
    columnA: string;
    columnB: string;
    onColumnChange: (which: 'a' | 'b', value: string) => void;
    onSetsChange: (sets: { id: string; a: string; b: string }[]) => void;
  }): JSX.Element;
  ```

Sets default to **3 empty rows**, matching the mockup's note and the app's existing default (`GuidedBuilder.tsx:42` uses `sets: 3`).

The lock rule is the point of this task: when the second column would duplicate the first, it is disabled and says why. `isColumnPairValid` decides; this component only renders that decision.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/coach/library/SetRows.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { SetRows } from './SetRows';

function renderSets(over: Partial<Parameters<typeof SetRows>[0]> = {}) {
  const props = {
    sets: [
      { id: 's1', a: '', b: '' },
      { id: 's2', a: '', b: '' },
      { id: 's3', a: '', b: '' },
    ],
    columnA: 'reps',
    columnB: 'weight_kg',
    onColumnChange: vi.fn(),
    onSetsChange: vi.fn(),
    ...over,
  };
  render(<SetRows {...props} />);
  return props;
}

describe('SetRows', () => {
  it('renders a row per set', () => {
    renderSets();
    expect(screen.getAllByRole('textbox').length).toBe(6); // 3 sets x 2 columns
  });

  it('uses each column type's placeholder', () => {
    renderSets();
    expect(screen.getAllByPlaceholderText('reps').length).toBe(3);
    expect(screen.getAllByPlaceholderText('kg').length).toBe(3);
  });

  it('records what you type into a set', () => {
    const props = renderSets();
    fireEvent.change(screen.getAllByPlaceholderText('reps')[0], { target: { value: '8' } });
    expect(props.onSetsChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 's1', a: '8' }),
      expect.objectContaining({ id: 's2' }),
      expect.objectContaining({ id: 's3' }),
    ]);
  });

  /*
   * The rule the mockup states in its own comment: "picking the same thing for
   * both would be a real logging mistake, so the second column greys out and
   * locks until the two differ again." A set claiming "8 reps and 8 reps" is
   * not a layout bug, it is bad data.
   */
  it('does not offer the first column measure to the second', () => {
    renderSets();
    const second = screen.getByLabelText(/second column measures/i);
    expect(within(second).queryByRole('option', { name: 'Reps' })).not.toBeInTheDocument();
  });

  it('locks the second column and says why when the pair would duplicate', () => {
    renderSets({ columnA: 'reps', columnB: 'reps' });
    expect(screen.getByLabelText(/second column measures/i)).toBeDisabled();
    expect(screen.getByText(/two columns cannot measure the same thing/i)).toBeInTheDocument();
  });

  it('adds a set', () => {
    const props = renderSets();
    fireEvent.click(screen.getByRole('button', { name: /add set/i }));
    expect(props.onSetsChange).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: 's3' })]));
    expect(props.onSetsChange.mock.calls[0][0].length).toBe(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/library/SetRows.test.tsx`
Expected: FAIL — cannot resolve `./SetRows`.

- [ ] **Step 3: Implement**

Create `apps/web/src/coach/library/SetRows.tsx`. The two column `<select>`s carry accessible names "First column measures" and "Second column measures". `availableSecondColumns(columnA)` populates the second; `isColumnPairValid` decides whether it is disabled.

- [ ] **Step 4: Mount it in the block editor**

In `BlockEditor.tsx`, render `SetRows` under each exercise in `cb-block-items`.

- [ ] **Step 5: Run both test files**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/library/`
Expected: PASS — SetRows 7, BlockEditor 7, ExercisePicker 8, CalendarMonth 7.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/coach/library/SetRows.tsx apps/web/src/coach/library/SetRows.test.tsx apps/web/src/coach/library/BlockEditor.tsx
git commit -m "Add set rows with two configurable measure columns

The second column locks when it would duplicate the first, because a set
claiming '8 reps and 8 reps' is bad data, not a layout bug. The rule
lives in @hybrid/engine; this only renders its verdict."
```

---

### Task 8: The day builder, in two modes

**Files:**
- Create: `apps/web/src/coach/library/DayBuilder.tsx`
- Test: `apps/web/src/coach/library/DayBuilder.test.tsx`
- Modify: `apps/web/src/coach/index.tsx` — add the route

**Interfaces:**
- Consumes: `BlockEditor` (Tasks 6–7), `buildCatalogue` (Task 1).
- Produces: a route at `/coach/day/:date?` rendering `DayBuilder`, behind `<ClientDetailGate tool="Session builder">` **without** `layer3Ready` — it reads the signed-in athlete's own stores.

**Read the mockup first**: `awk '/id="cal-session-builder"/,/id="lib-sessions-view"/' <artifact>`. Classes: `cb-head`, `rd-back`, `cb-head-actions`, `lib-icon-btn`, `lib-cta`, `cb-title`, `cb-meta`, `cb-status` (containing a `dot`), `cb-instructions` (a label wrapping `cal-field-label` and a `<textarea>`), `cb-blocks`, `cb-add-row`, `cb-add-btn` (`primary` and `ghost`), `cb-note`.

The two modes, from the spec:

| | Dated (from the Calendar) | Library (from the wizard) |
|---|---|---|
| Date heading + `cb-meta` | yes | no |
| `cb-status` dot | yes | no |
| Coach instructions | yes | yes |
| Blocks | yes | yes |
| Primary action | **Publish session** | **Save to library** |

**The honesty rule this task must implement.** A dated heading with a Publish button implies the session will happen that day. It will not necessarily: `publishWorkoutDraft` takes a *preferred* start date and *preferred* weekdays and routes through Coordinator placement. `CoachAuthoring` already says "preferences are not resolved calendar positions". The dated mode must state that the date is a preferred day, not a placement. A test asserts the wording is present.

The mockup's `+ Add new session` carries a note that multiple sessions per day are "next on the list — for now this day holds one". Render the button disabled with that note, exactly as the mockup does.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/coach/library/DayBuilder.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DayBuilder } from './DayBuilder';

function renderDay(over: Partial<Parameters<typeof DayBuilder>[0]> = {}) {
  const props = {
    mode: 'dated' as const,
    date: '2026-08-11',
    workoutId: 'w1',
    published: false,
    onPublish: vi.fn(),
    onSave: vi.fn(),
    onBack: vi.fn(),
    ...over,
  };
  render(<DayBuilder {...props} />);
  return props;
}

describe('DayBuilder — dated mode', () => {
  it('heads with the day and shows its published status', () => {
    renderDay();
    expect(screen.getByText(/Tuesday, August 11/i)).toBeInTheDocument();
    expect(screen.getByText(/unpublished/i)).toBeInTheDocument();
  });

  it('offers Publish session', () => {
    const props = renderDay();
    fireEvent.click(screen.getByRole('button', { name: /publish session/i }));
    expect(props.onPublish).toHaveBeenCalled();
  });

  /*
   * publishWorkoutDraft takes a PREFERRED start date and PREFERRED weekdays and
   * routes through Coordinator placement. A dated heading plus a Publish button
   * implies a placement the coach has not made, and CoachAuthoring already
   * refuses to blur this ("preferences are not resolved calendar positions").
   * The Calendar must not contradict its sibling screen.
   */
  it('says the date is a preference, not a placement', () => {
    renderDay();
    expect(screen.getByText(/preferred day/i)).toBeInTheDocument();
    expect(screen.getByText(/the Coordinator (still )?resolves/i)).toBeInTheDocument();
  });

  it('disables Add new session and says why', () => {
    renderDay();
    expect(screen.getByRole('button', { name: /add new session/i })).toBeDisabled();
    expect(screen.getByText(/for now this day holds one/i)).toBeInTheDocument();
  });
});

describe('DayBuilder — library mode', () => {
  it('shows no date, no status and no Publish', () => {
    renderDay({ mode: 'library', date: undefined });
    expect(screen.queryByText(/August 11/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/unpublished/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /publish session/i })).not.toBeInTheDocument();
  });

  it('saves to the library instead', () => {
    const props = renderDay({ mode: 'library', date: undefined });
    fireEvent.click(screen.getByRole('button', { name: /save to library/i }));
    expect(props.onSave).toHaveBeenCalled();
  });

  it('still takes coach instructions', () => {
    renderDay({ mode: 'library', date: undefined });
    expect(screen.getByLabelText(/coach instructions/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/library/DayBuilder.test.tsx`
Expected: FAIL — cannot resolve `./DayBuilder`.

- [ ] **Step 3: Implement the component**

Create `apps/web/src/coach/library/DayBuilder.tsx`. One component; `mode` decides whether the date heading, status and Publish render. Do not build two components — the blocks-and-instructions half must exist once.

- [ ] **Step 4: Register the route**

In `apps/web/src/coach/index.tsx`, inside the existing `<Route element={<ArcCoachFrame />}>` block:

```tsx
<Route path="day/:date" element={<ClientDetailGate tool="Session builder"><DayBuilder mode="dated" /></ClientDetailGate>} />
```

Read the file's existing comment about `layer3Ready` (around lines 35–44) before deciding otherwise. This route reads local stores, so it does **not** get `layer3Ready`.

- [ ] **Step 5: Run the suite and the contract check**

```bash
pnpm --filter @hybrid/web exec tsc --noEmit -p .
pnpm --filter @hybrid/web exec vitest run
node checks/coach-contract.mjs
```
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/coach/library/DayBuilder.tsx apps/web/src/coach/library/DayBuilder.test.tsx apps/web/src/coach/index.tsx
git commit -m "Add the day builder in two modes, dated and library

One screen, so the blocks-and-instructions half exists once. The dated
mode states that its date is a PREFERRED day: publishWorkoutDraft routes
through Coordinator placement, and a dated heading beside a Publish
button would otherwise imply a placement the coach never made."
```

---

### Task 9: Tab shell, wizard rewire, and the phone check

**Files:**
- Modify: `apps/web/src/coach/CoachLibrary.tsx` — mount `CalendarMonth` in the calendar tab; rename `templates` to Programs
- Modify: `apps/web/src/screens/guided/GuidedBuilder.tsx` — finish at the day builder
- Modify: `apps/web/src/coach/CoachAuthoring.tsx:284` — "Edit workout structure" opens the day builder
- Modify: `checks/screens.mjs` — the Library at 420px
- Test: `apps/web/src/coach/CoachLibrary.test.tsx` (extend the existing file)

**Interfaces:**
- Consumes: `CalendarMonth` (Task 5), `DayBuilder` route (Task 8).

`GuidedBuilder` currently computes `plannerPath` (line 74) and ends there. It ends at the day builder in library mode instead. Read the file's header comment first — it documents the handoff this task changes, and the comment must be updated to match rather than left describing the old behaviour.

**Two tabs only** — Programs and Calendar. Do not add Sessions, Exercises or Circuit; they arrive with 3b and 3c. A tab with nothing behind it is the defect Stage 1 shipped three times.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/src/coach/CoachLibrary.test.tsx`:

```tsx
describe('CoachLibrary tabs', () => {
  it('offers Programs and Calendar, and nothing that is not built yet', () => {
    renderLibrary();
    expect(screen.getByRole('tab', { name: /programs/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /calendar/i })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /sessions/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /exercises/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /circuit/i })).not.toBeInTheDocument();
  });

  it('shows the month grid on the Calendar tab', () => {
    renderLibrary();
    fireEvent.click(screen.getByRole('tab', { name: /calendar/i }));
    expect(screen.getByText(/^(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/)).toBeInTheDocument();
  });
});
```

Reuse the file's existing `renderLibrary` harness; do not write a second one.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/CoachLibrary.test.tsx`
Expected: FAIL — no Calendar month grid.

- [ ] **Step 3: Wire the tabs and the calendar**

Rename the `templates` tab to Programs in `CoachLibrary.tsx` (its panel is unchanged; 3b redesigns it) and replace `CalendarTab`'s body with `CalendarMonth`.

- [ ] **Step 4: Rewire the wizard and the edit link**

In `GuidedBuilder.tsx`, end the flow at `/coach/day/${id}` (library mode) rather than `plannerPath`, and update the header comment. In `CoachAuthoring.tsx:284`, point "Edit workout structure" at the day builder.

- [ ] **Step 5: Add the Library to the phone check**

In `checks/screens.mjs`, add the Library to `COACH_SHOTS` with a content assertion, following the existing entries exactly:

```js
['17-coach-library', '/coach/library', [/Programs/i, /Calendar/i]],
```

- [ ] **Step 6: Verify everything, including the phone check**

```bash
pnpm --filter @hybrid/web exec tsc --noEmit -p .
pnpm --filter @hybrid/web exec vitest run
node checks/coach-contract.mjs
node checks/screens.mjs
```
Expected: all clean; `screens.mjs` reports one more screen than before and exits 0.

- [ ] **Step 7: Verify both decision paths are still reachable**

The wizard rewire changes where an authoring flow ends. Confirm nothing became unreachable:

```bash
grep -rn "plannerPath" apps/web/src/screens/guided/GuidedBuilder.tsx
grep -rn "coach/day" apps/web/src --include=*.tsx | grep -v test
```

The first must show `plannerPath` is either gone or still used for the ATHLETE path. The second must show at least the route registration and the two entry points. If either looks wrong, stop and report rather than committing — Stage 1 shipped three unreachable routes because a grep proved a mount rather than a path.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/coach/CoachLibrary.tsx apps/web/src/coach/CoachLibrary.test.tsx apps/web/src/screens/guided/GuidedBuilder.tsx apps/web/src/coach/CoachAuthoring.tsx checks/screens.mjs
git commit -m "Wire the Library tabs, and end the wizard at the day builder

The guided wizard handed off to the dense Planner; it now finishes at the
day builder, which is what the 2026-07-29 builder design asked for and
never got — coach instructions and publish as the final full-screen step.

Two tabs, not five: a tab with nothing behind it is the defect Stage 1
shipped three times."
```

---

## Self-Review

**1. Spec coverage.**

| Spec requirement | Task |
|---|---|
| Two tabs now, not five | 9 |
| Calendar month grid, Mon–Sun, month nav | 2, 5 |
| Empty day: Create session / Add from library, by TAP | 5 |
| Filled day opens the day builder | 5 |
| `Message team` / `Publish all` cut | 5 (asserted absent) |
| Day builder, dated mode | 8 |
| Day builder, library mode | 8 |
| Block/picker/set editor per the mockup (amended) | 4, 6, 7 |
| Tagged exercise catalogue (moved from 3c) | 1 |
| Two-measure columns with the lock rule | 3, 7 |
| Publish proposes; date is a preference | 8 |
| Wizard ends at the day builder | 9 |
| `ClientDetailGate` without `layer3Ready` | 8 |
| Library at 420px in `checks/screens.mjs` | 9 |
| Pure month maths, not JSX logic | 2 |

No gaps.

**2. Placeholder scan.** No "TBD", no "handle edge cases", no "similar to Task N". Every code step carries real code or names the exact file, class list and mockup range to read.

**3. Type consistency.** `CatalogueEntry` is defined in Task 1 and consumed by name in Tasks 4 and 6. `COLUMN_TYPES` / `availableSecondColumns` / `isColumnPairValid` are defined in Task 3 and consumed in Task 7. `MonthCell` / `monthGrid` / `monthLabel` / `shiftMonth` are defined in Task 2 and consumed in Task 5. `CalendarDay` is defined in Task 5 and consumed in Task 9. `BLOCK_CATEGORIES` is defined and exported in Task 6, used in its own test.

**Known ordering wrinkle, deliberate:** Task 6 builds `BlockEditor` without `SetRows`, and Task 7 mounts `SetRows` into it. Task 6's tests do not assert set rows, so it passes on its own; Task 7 re-runs the whole `library/` directory to prove the integration. This keeps each task independently reviewable rather than merging two large components into one gate.
