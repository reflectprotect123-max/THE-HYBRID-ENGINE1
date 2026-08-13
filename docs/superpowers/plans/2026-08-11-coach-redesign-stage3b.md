# Coach Redesign Stage 3b — Programs Implementation Plan

> **COMPLETE — shipped 13 August 2026.** Gates green: `pnpm run typecheck`,
> `pnpm run test` (636 tests), `node checks/lane-contract.mjs`, and
> `node checks/screens.mjs` at 420px.
>
> Tasks 1 and 2 were ALREADY DONE when this stage was picked up —
> `program-body.ts`, `ProgramTemplate.sessions`, the repository read and the
> six `sessions: []` fixtures all shipped earlier. Tasks 3-5 are this stage.
>
> Four things this plan could not have known, all decided against the tree
> rather than against the plan:
>
> - **The Programs TAB no longer existed.** The owner deleted it on 11 August,
>   after this plan was written. It is back as `.lib-tabs` inside
>   `/coach/library`, with Calendar as the default — that is the half a coach
>   opens the Library for day to day.
> - **The plan's central warning had already come true.** It says deleting a
>   sidebar and taking the only assign path with it "is the exact defect Stage
>   1 shipped with roster approve/decline". `saveAssignmentDraft` had ZERO
>   callers for two days. `CoachLibrary.test.tsx` now drives the real screen
>   and asserts the real write, rather than trusting a grep.
> - **The stylesheet says detail VIEW, not inline expansion.** `.lib-days`,
>   `.lib-ex-list` and `#lib-detail-view[hidden]` describe a separate view, so
>   a row opens one. The plan's tests pass either way; the stylesheet is the
>   spec, as it has been every stage.
> - **Two `CoachLibrary` tests pinned the deletion this stage partly
>   reverses.** They are rewritten, not deleted: the calendar is still what
>   opens, and the sidebar configurator still does not come back.
>
> Task 5's `Starting point` heading does not exist in the built table, exactly
> as step 1 anticipated. `Programs` was used instead and is documented in
> `checks/screens.mjs` as a TAB LABEL — chrome that would pass dishonestly, so
> `ProgramsTab.test.tsx` carries the real proof by driving the panel directly.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make a program contain real sessions, and turn the Programs tab into a table the coach browses and assigns from — with no database migration.

**Architecture:** `program_template_versions.body` is already jsonb documented as holding "sessions per week, weeks, progression model, blocks", and `listProgramTemplates` already selects and reads it. Phase 1 adds a pure reader for the sessions the body may carry, a contract field to hold them, and a redesigned tab. The recommender is removed; the assign controls move from a sidebar into the expanded row.

**Tech Stack:** React 19 + react-router-dom 7, TypeScript, Vitest + @testing-library/react, Supabase (read only — no schema change).

Spec: `docs/superpowers/specs/2026-08-11-stage3b-programs-design.md`

## Global Constraints

- **No migration.** Phase 1 touches contract, repository and UI only. Nothing in `supabase/migrations/` changes. If a task appears to need a schema change, stop and report — that is phase 2, and applying it is an owner action with a rollback plan.
- **A program with no sessions says so.** "No sessions recorded for this program yet" — never an invented week, never a blank panel that reads as a rendering bug. Every existing program is in exactly this state until phase 2, and it must not look broken.
- **Assignment must survive.** `prepareAssignment` (`CoachLibrary.tsx:52`) is the ONLY program-assignment path in the app. It needs three inputs currently in the sidebar: client, preferred start date, preferred weekdays. Deleting a sidebar and taking the only assign path with it is the exact defect Stage 1 shipped with roster approve/decline.
- **Assignment PROPOSES.** `saveAssignmentDraft` writes state `ready-for-coordinator`. Preferred days and start dates are inputs; the Coordinator resolves the week. The existing message already says so and must not be weakened.
- **Never relabel a coach's own choice as the system's.** `CoachLibrary.tsx:49` currently falls back to a recommender while the panel is hardcoded to "ARC recommends", so picking a program yourself makes the app credit ARC with your choice. The recommender goes.
- **Every value from real data; absent data stated, never faked.**
- **Behind `ClientDetailGate`**, as every coach route is.
- **Tests are colocated.** `src/foo.ts` ↔ `src/foo.test.ts`. Never under `test/`.
- Before every commit: `pnpm --filter @hybrid/web exec tsc --noEmit -p .`, `pnpm --filter @hybrid/web exec vitest run`, and `node checks/coach-contract.mjs` must all pass.

## File Structure

| File | Responsibility |
|---|---|
| `apps/web/src/coach/program-body.ts` (create) | Pure reader: the sessions a version body carries |
| `apps/web/src/coach/program-body.test.ts` (create) | Colocated tests for the above |
| `apps/web/src/coach/contracts.ts` (modify) | `ProgramTemplate` gains `sessions` |
| `apps/web/src/cloud/coach-repository.ts` (modify:218-243) | Read sessions from the body it already fetches |
| `apps/web/src/coach/mock-fixtures.ts` (modify) | Fixtures gain the field |
| `apps/web/src/coach/ProgramsTab.tsx` + `.test.tsx` (create) | The table, the expanded row, the assign controls |
| `apps/web/src/coach/CoachLibrary.tsx` (modify) | Mount `ProgramsTab`; delete the sidebar and the recommender |
| `checks/screens.mjs` (modify) | Assert the Programs tab's own content at 420px |

Five tasks. The reader comes first because both the repository and the tab consume it, and it is pure.

---

### Task 1: The version-body session reader

**Files:**
- Create: `apps/web/src/coach/program-body.ts`
- Test: `apps/web/src/coach/program-body.test.ts`

**Interfaces:**
- Consumes: `Workout` from `@hybrid/engine` — `contracts.ts` already imports it, so this is not a new dependency.
- Produces:
  ```ts
  export function sessionsFromBody(body: unknown): Workout[];
  ```
  Tasks 2 and 3 consume it.

The body is coach-written, unconstrained jsonb (`arc-athlete-sync.ts:385` says so). It may be absent, malformed, or carry sessions in the engine's `Workout` shape. This reader is the one place that decides what counts, and it never throws — a bad body yields no sessions, because a Library that crashes on one malformed template is worse than one that shows it empty.

- [x] **Step 1: Write the failing test**

Create `apps/web/src/coach/program-body.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sessionsFromBody } from './program-body';

/*
 * `program_template_versions.body` is unconstrained, coach-written jsonb — see
 * the migration's own comment and arc-athlete-sync.ts:385. So this reader is
 * defensive by contract, not by superstition: a Library that throws on one
 * malformed template shows the coach nothing at all, which is strictly worse
 * than showing that template as empty.
 */
describe('sessionsFromBody', () => {
  it('reads sessions in the engine Workout shape', () => {
    const out = sessionsFromBody({
      sessions: [
        { id: 'w1', name: 'Day 1 · Squat', blocks: [] },
        { id: 'w2', name: 'Day 2 · Press', blocks: [] },
      ],
    });
    expect(out.map((s) => s.name)).toEqual(['Day 1 · Squat', 'Day 2 · Press']);
  });

  it('returns nothing for a body that carries no sessions', () => {
    expect(sessionsFromBody({ sessionsPerWeek: 3, weeks: 8 })).toEqual([]);
  });

  it('returns nothing rather than throwing for a malformed body', () => {
    expect(sessionsFromBody(undefined)).toEqual([]);
    expect(sessionsFromBody(null)).toEqual([]);
    expect(sessionsFromBody('not an object')).toEqual([]);
    expect(sessionsFromBody({ sessions: 'not an array' })).toEqual([]);
  });

  it('drops entries that are not usable sessions, keeping the ones that are', () => {
    const out = sessionsFromBody({
      sessions: [null, { name: 'no id' }, { id: 'w1', name: 'Real', blocks: [] }, 42],
    });
    expect(out.map((s) => s.id)).toEqual(['w1']);
  });

  it('tolerates a session with no blocks rather than dropping it', () => {
    const out = sessionsFromBody({ sessions: [{ id: 'w1', name: 'Shell' }] });
    expect(out).toHaveLength(1);
    expect(out[0].blocks).toEqual([]);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/program-body.test.ts`
Expected: FAIL — cannot resolve `./program-body`.

- [x] **Step 3: Implement**

Create `apps/web/src/coach/program-body.ts`:

```ts
import type { Workout } from '@hybrid/engine';

/**
 * The sessions a program version's body carries.
 *
 * `program_template_versions.body` is jsonb the migration documents as "the
 * engine-shaped body: sessions per week, weeks, progression model, blocks",
 * and `arc-athlete-sync.ts` records that it is "unconstrained, coach-written".
 * So this is the one place that decides what counts as a session, and it never
 * throws: a Library that crashes on a single malformed template shows the
 * coach nothing, which is worse than showing that one program as empty.
 *
 * A session needs an id to be addressable and a name to be nameable. Missing
 * blocks are an empty session, not a broken one — a named shell is a real
 * thing a coach creates before filling it.
 */
export function sessionsFromBody(body: unknown): Workout[] {
  if (!body || typeof body !== 'object') return [];
  const raw = (body as { sessions?: unknown }).sessions;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .filter((s) => typeof s.id === 'string' && s.id.length > 0)
    .map((s) => ({
      ...(s as unknown as Workout),
      blocks: Array.isArray(s.blocks) ? (s.blocks as Workout['blocks']) : [],
    }));
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/program-body.test.ts`
Expected: PASS, 5 tests.

- [x] **Step 5: Commit**

```bash
git add apps/web/src/coach/program-body.ts apps/web/src/coach/program-body.test.ts
git commit -m "Read a program version body's sessions in one defensive place

The body is unconstrained coach-written jsonb. A Library that throws on
one malformed template shows the coach nothing, which is worse than
showing that template as empty."
```

---

### Task 2: The contract and the repository

**Files:**
- Modify: `apps/web/src/coach/contracts.ts` (the `ProgramTemplate` interface, around line 58)
- Modify: `apps/web/src/cloud/coach-repository.ts` (the `listProgramTemplates` mapping, lines 218-243)
- Modify: `apps/web/src/coach/mock-fixtures.ts` (`PROGRAM_TEMPLATE_FIXTURES`)

**Interfaces:**
- Consumes: `sessionsFromBody` (Task 1).
- Produces: `ProgramTemplate.sessions: readonly Workout[]`. Task 3 renders it.

`ProgramTemplate` gains one field. Reusing the engine's `Workout` rather than a parallel shape is deliberate: `coach_workout_drafts.body` already stores "the real Workout shape (name, blocks, days, dates, folderIds) from packages/engine/src/types.ts", and a second shape for the same idea is how two screens start disagreeing about what a block is.

**The fixtures deliberately get `sessions: []`.** Every real program is in that state until phase 2, so the fixtures must exercise the honest empty state rather than a happy path that does not exist yet.

- [x] **Step 1: Add the contract field**

In `apps/web/src/coach/contracts.ts`, inside `ProgramTemplate`, after `progression`:

```ts
  /**
   * The program's own sessions, read from its latest version body.
   *
   * Empty until phase 2 gives a program a way to hold more than one editable
   * draft — `coach_workout_drafts` carries `unique (template_id)` today. An
   * empty list is an honest "not recorded", never a rendering failure.
   */
  sessions: readonly Workout[];
```

- [x] **Step 2: Run typecheck to see every site that must change**

Run: `pnpm --filter @hybrid/web exec tsc --noEmit -p .`
Expected: FAIL — `sessions` missing from the repository mapping and from `PROGRAM_TEMPLATE_FIXTURES`. That list is the work.

- [x] **Step 3: Read the sessions in the repository**

In `apps/web/src/cloud/coach-repository.ts`, import the reader and add one line to the mapped object, beside `progression`:

```ts
import { sessionsFromBody } from '../coach/program-body';
```

```ts
        sessions: sessionsFromBody(body),
```

The `body` local already exists on line 223 — do not re-fetch or re-reduce it.

- [x] **Step 4: Give the fixtures the field**

In `apps/web/src/coach/mock-fixtures.ts`, add `sessions: []` to each of the six entries in `PROGRAM_TEMPLATE_FIXTURES`, keeping them on one line each as the file already does.

- [x] **Step 5: Verify**

```bash
pnpm --filter @hybrid/web exec tsc --noEmit -p .
pnpm --filter @hybrid/web exec vitest run
node checks/coach-contract.mjs
```
Expected: all clean.

- [x] **Step 6: Commit**

```bash
git add apps/web/src/coach/contracts.ts apps/web/src/cloud/coach-repository.ts apps/web/src/coach/mock-fixtures.ts
git commit -m "Carry a program's real sessions on ProgramTemplate

The repository already fetched program_template_versions(version, body)
and read sessionsPerWeek, weeks and summary out of it. It never read
sessions only because the contract had no field for them. No migration.

Fixtures get an empty list on purpose: every real program is in that
state until phase 2, so they exercise the honest empty state rather than
a happy path that does not exist yet."
```

---

### Task 3: The Programs table

**Files:**
- Create: `apps/web/src/coach/ProgramsTab.tsx`
- Test: `apps/web/src/coach/ProgramsTab.test.tsx`

**Interfaces:**
- Consumes: `ProgramTemplate` (Task 2), including its `sessions`.
- Produces:
  ```tsx
  export function ProgramsTab(props: {
    templates: readonly ProgramTemplate[];
    loading: boolean;
    error: string;
    onAssign: (template: ProgramTemplate, clientId: string, startDate: string, weekdays: number[]) => void;
    clients: readonly { id: string; name: string }[];
  }): JSX.Element;
  ```
  Task 4 supplies `onAssign`.

The table shows every program: name, category, level, dose (`sessionsPerWeek` × `weeks`), and draft status. The training-system filter (strength / conditioning) stays — it is a genuine filter. Selecting a row expands it to show that program's real sessions and its progression stages.

**No recommender, and no "ARC recommends" anywhere.** The coach picks; the screen says they picked.

- [x] **Step 1: Write the failing test**

Create `apps/web/src/coach/ProgramsTab.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ProgramTemplate } from './contracts';
import { ProgramsTab } from './ProgramsTab';

const base = {
  category: 'Full body',
  level: 'developing',
  weeks: 8,
  summary: 'Three balanced sessions.',
  progression: { kind: 'strength', stages: ['Volume base', 'Rep quality'], increaseAuthority: 'coach-approval-only' },
  status: 'published',
  source: 'coach-template',
} as const;

const templates = [
  { ...base, id: 'p1', domain: 'strength', name: 'Build · Full Body', sessionsPerWeek: 3, sessions: [] },
  {
    ...base,
    id: 'p2',
    domain: 'strength',
    name: 'Foundation',
    sessionsPerWeek: 2,
    sessions: [
      { id: 'w1', name: 'Day 1 · Squat', blocks: [] },
      { id: 'w2', name: 'Day 2 · Press', blocks: [] },
    ],
  },
  { ...base, id: 'p3', domain: 'conditioning', name: 'Run · Steady', sessionsPerWeek: 2, sessions: [] },
] as unknown as ProgramTemplate[];

const clients = [{ id: 'c1', name: 'Alex Morgan' }];

function renderTab(over: Partial<Parameters<typeof ProgramsTab>[0]> = {}) {
  const props = { templates, loading: false, error: '', onAssign: vi.fn(), clients, ...over };
  render(<ProgramsTab {...props} />);
  return props;
}

describe('ProgramsTab', () => {
  it('lists the programs for the selected training system', () => {
    renderTab();
    expect(screen.getByText('Build · Full Body')).toBeInTheDocument();
    expect(screen.queryByText('Run · Steady')).not.toBeInTheDocument();
  });

  it('switches training system', () => {
    renderTab();
    fireEvent.click(screen.getByRole('tab', { name: /conditioning/i }));
    expect(screen.getByText('Run · Steady')).toBeInTheDocument();
    expect(screen.queryByText('Build · Full Body')).not.toBeInTheDocument();
  });

  it('shows each row its dose and level', () => {
    renderTab();
    expect(screen.getByText(/3× · 8 weeks/)).toBeInTheDocument();
  });

  /*
   * The screen must never credit ARC with a choice the coach made. Before this
   * stage, CoachLibrary fell back to a recommender while the panel was
   * hardcoded to "ARC recommends", so picking a program yourself made the app
   * claim it had recommended your own pick.
   */
  it('never claims to have recommended anything', () => {
    renderTab();
    expect(screen.queryByText(/ARC recommends/i)).not.toBeInTheDocument();
  });

  it('expands a row to show that program its real sessions', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Foundation/ }));
    expect(screen.getByText('Day 1 · Squat')).toBeInTheDocument();
    expect(screen.getByText('Day 2 · Press')).toBeInTheDocument();
  });

  it('says so when a program records no sessions, rather than showing a blank', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Build · Full Body/ }));
    expect(screen.getByText(/no sessions recorded for this program yet/i)).toBeInTheDocument();
  });

  it('shows the progression stages on the expanded row', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Build · Full Body/ }));
    expect(screen.getByText('Volume base')).toBeInTheDocument();
  });

  it('keeps rows collapsed until chosen', () => {
    renderTab();
    expect(screen.queryByText(/no sessions recorded/i)).not.toBeInTheDocument();
  });

  it('distinguishes a load failure from an empty library', () => {
    renderTab({ templates: [], error: 'The Library could not be loaded.' });
    expect(screen.getByRole('alert')).toHaveTextContent(/could not be loaded/i);
    expect(screen.queryByText(/no .* programs published yet/i)).not.toBeInTheDocument();
  });

  it('says an empty library is empty', () => {
    renderTab({ templates: [] });
    expect(screen.getByText(/no strength programs published yet/i)).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/ProgramsTab.test.tsx`
Expected: FAIL — cannot resolve `./ProgramsTab`.

- [x] **Step 3: Implement**

Create `apps/web/src/coach/ProgramsTab.tsx`. Follow the classes already used by `CoachLibrary`'s current table (read lines 109-146 before writing) so this looks like the same screen it replaces. Each row is a `<button>` whose accessible name includes the program name, so a test and a screen-reader user address it the same way.

The two empty states are distinct and both required: a load failure renders `role="alert"` with the error and the note "This is a connection problem, not an empty Library."; a genuinely empty list says "No {domain} programs published yet." Rendering one for both is the defect `CoachLibrary` was already fixed for once — do not reintroduce it.

Assign controls are Task 4; leave the expanded row without them for now.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/ProgramsTab.test.tsx`
Expected: PASS, 10 tests.

- [x] **Step 5: Commit**

```bash
git add apps/web/src/coach/ProgramsTab.tsx apps/web/src/coach/ProgramsTab.test.tsx
git commit -m "Add the Programs table, with no recommender

The coach picks and the screen says they picked. The old panel fell back
to a recommender while its label was hardcoded to 'ARC recommends', so
choosing a program yourself made the app credit ARC with your choice.

A program with no sessions says so. Every program is in that state until
phase 2, so the empty state is the common case, not the edge."
```

---

### Task 4: Assignment moves into the expanded row

**Files:**
- Modify: `apps/web/src/coach/ProgramsTab.tsx` — client, start date, preferred weekdays, and the action
- Modify: `apps/web/src/coach/ProgramsTab.test.tsx` — add the cases below
- Modify: `apps/web/src/coach/CoachLibrary.tsx` — mount `ProgramsTab`, delete the sidebar and the recommender, keep `prepareAssignment`

**Interfaces:**
- Consumes: `ProgramsTab` (Task 3).
- Produces: nothing new; `prepareAssignment` keeps its existing signature and semantics.

**This is the task the spec singles out.** `prepareAssignment` is the only program-assignment path in the app. It writes an assignment draft with `state: 'ready-for-coordinator'` and reports "Preferred days are inputs; the Coordinator still resolves the week." All of that is preserved exactly; only where the inputs live changes.

- [x] **Step 1: Write the failing tests**

Add to `apps/web/src/coach/ProgramsTab.test.tsx`:

```tsx
describe('ProgramsTab — assigning', () => {
  it('assigns the expanded program to a chosen client', () => {
    const props = renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Build · Full Body/ }));
    fireEvent.change(screen.getByLabelText(/assign to/i), { target: { value: 'c1' } });
    fireEvent.change(screen.getByLabelText(/preferred start/i), { target: { value: '2026-08-17' } });
    fireEvent.click(screen.getByRole('button', { name: /^Mon$/ }));
    fireEvent.click(screen.getByRole('button', { name: /prepare assignment/i }));

    expect(props.onAssign).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p1' }),
      'c1',
      '2026-08-17',
      expect.arrayContaining([1]),
    );
  });

  it('refuses to assign with no preferred day, and says why', () => {
    const props = renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Build · Full Body/ }));
    fireEvent.change(screen.getByLabelText(/assign to/i), { target: { value: 'c1' } });
    fireEvent.click(screen.getByRole('button', { name: /prepare assignment/i }));
    expect(props.onAssign).not.toHaveBeenCalled();
    expect(screen.getByText(/choose at least one preferred training day/i)).toBeInTheDocument();
  });

  /*
   * The Coordinator owns placement. Preferred days are an INPUT — the existing
   * screen said so and the replacement must keep saying so, or the coach
   * reasonably reads the day they picked as the day it will happen.
   */
  it('says preferred days are inputs, not placements', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Build · Full Body/ }));
    expect(screen.getByText(/not resolved calendar positions/i)).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/ProgramsTab.test.tsx`
Expected: FAIL — no assign controls in the expanded row.

- [x] **Step 3: Add the controls**

In `ProgramsTab.tsx`'s expanded row, add: an `Assign to` `<select>` over `clients`, a `Preferred start` date input defaulting to today, the seven weekday toggles (`WEEKDAYS` already exists in `CoachLibrary.tsx` — move it into a shared spot or copy the array, but do not invent different labels), the note "Preferences are not resolved calendar positions.", and a `Prepare assignment` button that calls `onAssign` only when at least one weekday is chosen.

- [x] **Step 4: Mount it and delete the sidebar**

In `CoachLibrary.tsx`: render `<ProgramsTab ... onAssign={...} />` in the `programs` tab, wiring `onAssign` to the existing `prepareAssignment` body. Delete the sidebar `<aside>`, the `Choice` controls, `recommended`, `selectedId`/`selected`, and the "ARC recommends" panel. Keep the success and error messages.

- [x] **Step 5: Verify the assign path end to end**

This is the guard, not a formality. Run the whole web suite and confirm `CoachLibrary`'s existing assignment tests still pass:

```bash
pnpm --filter @hybrid/web exec vitest run src/coach/
pnpm --filter @hybrid/web exec tsc --noEmit -p .
node checks/coach-contract.mjs
```

Then confirm by grep that exactly one assignment path still exists and it is reachable:

```bash
grep -rn "saveAssignmentDraft" apps/web/src --include=*.tsx --include=*.ts | grep -v test
```

Expected: the repository definitions, and exactly one caller. If the caller is gone, stop — the sidebar took the only assign path with it, which is the defect this task exists to prevent.

- [x] **Step 6: Commit**

```bash
git add apps/web/src/coach/ProgramsTab.tsx apps/web/src/coach/ProgramsTab.test.tsx apps/web/src/coach/CoachLibrary.tsx
git commit -m "Move assignment into the expanded program row

Everything about one program in one place: its week, and the decision
about giving it to someone.

prepareAssignment keeps its semantics exactly — an assignment draft in
state ready-for-coordinator, with preferred days and a preferred start
that the Coordinator resolves. Only where the inputs live changes. It is
the only assignment path in the app, so the task verifies it end to end
rather than trusting the sidebar's removal."
```

---

### Task 5: The phone check and the close-out

**Files:**
- Modify: `checks/screens.mjs` — strengthen the Library shot's content assertion
- Modify: `CLAUDE.md` — the coach-workspace boundary, if the covered routes changed

**Interfaces:** none.

Stage 3a added `['17-coach-library', '/coach/library', [/Programs/i, /Calendar/i]]`. Those are tab labels — chrome that renders whether or not the Programs panel works. This task makes the assertion prove the panel itself mounted.

- [x] **Step 1: Strengthen the assertion**

In `checks/screens.mjs`, change the Library entry's patterns to include something only the Programs table renders — its column heading or the training-system filter:

```js
  ['17-coach-library', '/coach/library', [/Programs/i, /Calendar/i, /Starting point/i]],
```

Confirm `Starting point` is what the built table actually renders; if the implementation used a different heading, use that one and say so. An assertion on text that is not there fails honestly; an assertion on chrome passes dishonestly.

- [x] **Step 2: Run the check**

```bash
pnpm run build
node checks/screens.mjs
```
Expected: 17 of 17, no overflow, exit 0.

- [x] **Step 3: Verify the whole tree**

```bash
pnpm run typecheck
pnpm run test
node checks/coach-contract.mjs
pnpm run check:ecosystem
node checks/docs.mjs
```
Expected: all clean.

- [x] **Step 4: Commit**

```bash
git add checks/screens.mjs CLAUDE.md
git commit -m "Assert the Programs panel itself at phone width

The Library shot asserted its tab labels, which render whether or not the
panel behind them works. It now asserts content only the table draws."
```

---

## Self-Review

**1. Spec coverage.**

| Spec requirement | Task |
|---|---|
| `ProgramTemplate` gains sessions, read from the latest version body | 1, 2 |
| Repository reads sessions from the body it already fetches | 2 |
| No migration in phase 1 | Global constraint; nothing under `supabase/` is touched |
| Table of every program: name, category, level, dose, draft status | 3 |
| Training-system filter stays | 3 |
| Sidebar configurator goes | 4 |
| "ARC recommends" false claim removed | 3 (asserted absent) |
| Expanding a row shows real sessions | 3 |
| A program with no sessions says so | 3 |
| Assign controls sit with the expanded row | 4 |
| `prepareAssignment` survives, semantics unchanged | 4 (with an explicit end-to-end guard) |
| Preferred days are inputs, not placements | 4 (asserted) |
| Reader is pure with its own tests | 1 |
| Programs at 420px with a content assertion | 5 |

Phase 2 — relaxing `unique (template_id)` so a program can hold several session drafts — is explicitly out of this plan, per the spec.

**2. Placeholder scan.** No "TBD", no "handle edge cases". Every code step carries real code or names the exact file, lines and existing patterns to follow.

**3. Type consistency.** `sessionsFromBody(body: unknown): Workout[]` is defined in Task 1 and consumed by name in Task 2. `ProgramTemplate.sessions: readonly Workout[]` is added in Task 2 and rendered in Task 3. `ProgramsTab`'s `onAssign(template, clientId, startDate, weekdays)` is declared in Task 3 and called with that exact argument order in Task 4's tests.

**One risk worth naming.** Task 3's fixtures give `sessions: []` to the row the expansion test uses for the empty state, and a populated list to the other — so both branches are covered by construction. If an implementer "fixes" the empty fixture to make a test greener, the empty-state case stops being tested and the most common real state in production loses its only guard.
