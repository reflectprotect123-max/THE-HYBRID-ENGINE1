# ARC Coach Mobile-Responsive Layouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `ArcCoachFrame`, `CoachCommandCenter`, `CoachLibrary`, and `CoachAuthoring` (all in `apps/web/src/coach/`) usable at real phone widths (375–430px), while leaving desktop (1440px) pixel-identical.

**Architecture:** Pure Tailwind CSS extension — no new app, no `apps/mobile`/Expo involvement, no viewport-detection JS hook. Every screen keeps ONE render tree; phone behavior comes from responsive utility classes (`sm:` = 640px breakpoint) plus one small piece of local React state in `ArcCoachFrame` for the collapsible-rail open/close toggle.

**Tech Stack:** React 19, Tailwind CSS (existing `apps/web` setup, no new dependencies), Vitest + Testing Library (existing `apps/web` test setup), `react-router-dom`.

## Global Constraints

- Desktop (≥1024px / existing `lg:`/`xl:` breakpoints) must render identically to today — every change is additive below `sm` (640px), or is a pure a11y/touch-target fix that also happens to be invisible at desktop size (e.g. `min-h-11` on a button that was already ≥44px tall on desktop).
- All new/changed interactive touch targets get `min-h-11` (44px), per `tokens.css`'s existing `pointer: coarse` rule.
- Tests are colocated (`Foo.tsx` → `Foo.test.tsx`, same directory), extending existing test files rather than creating new ones, except where noted.
- No bottom navigation. No new color tokens or fonts. No changes to `apps/mobile`.
- Spec: `docs/superpowers/specs/2026-08-09-arc-coach-mobile-responsive-design.md`.
- **Deviation from spec, discovered while planning (see Task 4):** the spec called for a `useIsPhone()` hook and a structural two-render-tree split for `CoachAuthoring`, based on it being "a dense 22KB desktop editor with simultaneous side-by-side panels." Direct inspection shows `SelfCoachAuthoringView` already collapses to one column below `xl` (same pattern as the other two screens), and `RosterAuthoringView` is already a single linear stack. The only real problems are undersized touch targets (`min-h-6` day-of-week toggles, unpadded selects) — a CSS-only fix, same category as `CoachCommandCenter`/`CoachLibrary`. No hook, no second render tree. This plan implements the corrected, simpler scope.

---

### Task 1: `ArcCoachFrame` — collapsible rail (spine + drawer)

**Files:**
- Modify: `apps/web/src/coach/ArcCoachFrame.tsx`
- Test: `apps/web/src/coach/ArcCoachFrame.test.tsx` (existing file, extend)

**Interfaces:**
- Consumes: nothing new — same `useDb`, `useProgressionLedger`, `useCoachWorkspace` already imported.
- Produces: nothing consumed by other tasks — this task is self-contained.

- [ ] **Step 1: Write the failing test**

Add `fireEvent` to the existing import line and add a new `it` block. In `apps/web/src/coach/ArcCoachFrame.test.tsx`:

```tsx
// change this existing import line:
import { act, screen } from '@testing-library/react';
// to:
import { act, fireEvent, screen } from '@testing-library/react';
```

```tsx
  it('the mobile nav trigger opens the rail drawer, and a nav link closes it', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [rosterClient({ source: 'roster-summary' })];
    await renderFrame(repo, '/coach');
    const trigger = screen.getByRole('button', { name: /open coach navigation/i });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('link', { name: /library/i }));
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/ArcCoachFrame.test.tsx -t "mobile nav trigger"`
Expected: FAIL — `Unable to find an accessible element with the role "button" and name /open coach navigation/i`

- [ ] **Step 3: Implement the drawer**

In `apps/web/src/coach/ArcCoachFrame.tsx`, add `useState` to the React import, add the trigger + backdrop, and change the `<aside>` to an off-canvas drawer below `sm`:

```tsx
import { useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
```

Replace the return statement's opening (`<div className="mx-auto grid ...">` through the `<aside ...>` opening tag) with:

```tsx
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="mx-auto grid min-h-screen max-w-[1440px] bg-bg text-text lg:grid-cols-[208px_minmax(0,1fr)]">
      <div className="flex items-center gap-2 border-b border-line2 bg-panel3 px-2 py-2 sm:hidden">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open coach navigation"
          aria-expanded={drawerOpen}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-line2 bg-panel"
        >
          <span className="h-4 w-1 rounded-full bg-gold" aria-hidden="true" />
        </button>
        <p className="text-sm font-semibold">Coach workspace</p>
      </div>
      {drawerOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 sm:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-[240px] -translate-x-full overflow-y-auto border-r border-line2 bg-panel3 px-2 py-2 transition-transform duration-200 sm:static sm:z-auto sm:w-auto sm:translate-x-0 sm:border-b sm:transition-none lg:border-b-0 lg:border-r lg:px-2.5 lg:py-3 ${drawerOpen ? 'translate-x-0' : ''}`}
      >
```

And close the drawer whenever a nav link is used — add `onClick` to the `<nav>` wrapping the three `ArcNavLink`s:

```tsx
        <nav
          className="mt-2 flex gap-0.5 overflow-x-auto pb-0.5 text-xs lg:mt-5 lg:grid lg:overflow-visible"
          aria-label="ARC primary navigation"
          onClick={() => setDrawerOpen(false)}
        >
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/ArcCoachFrame.test.tsx`
Expected: PASS (all tests in the file, including the 6 pre-existing ones — this confirms the change didn't break the disclosure-banner logic)

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @hybrid/web exec tsc -p tsconfig.json --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/coach/ArcCoachFrame.tsx apps/web/src/coach/ArcCoachFrame.test.tsx
git commit -m "ARC coach: collapsible rail (spine + drawer) below 640px"
```

---

### Task 2: `CoachCommandCenter` — decision queue first, touch targets

**Files:**
- Modify: `apps/web/src/coach/CoachCommandCenter.tsx`
- Test: `apps/web/src/coach/CoachCommandCenter.test.tsx` (existing file, extend)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing consumed by other tasks.

- [ ] **Step 1: Write the failing test**

The file already has an async `renderCommandCenter(repository)` helper (returns the RTL render result, including `container`) used by all its existing tests. Add this `it` block to `apps/web/src/coach/CoachCommandCenter.test.tsx`, inside the existing `describe('CoachCommandCenter', ...)` block:

```tsx
  it('marks the decision queue to render first on phone width, via order utilities', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [rosterClient({ source: 'engine-local', id: 'engine-local' })];
    const { container } = await renderCommandCenter(repo);
    const queueSection = container.querySelector('section[aria-labelledby="priority-title"]');
    const overviewSection = container.querySelector('section[aria-labelledby="client-overview-title"]');
    expect(queueSection).toHaveClass('order-first', 'sm:order-none');
    expect(overviewSection).not.toHaveClass('order-first');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/CoachCommandCenter.test.tsx -t "decision queue to render first"`
Expected: FAIL — `expect(element).toHaveClass("order-first")` fails, class not present

- [ ] **Step 3: Implement the reorder + touch targets**

In `apps/web/src/coach/CoachCommandCenter.tsx`:

1. Change the content column from `space-y-5` (block layout, `order` has no effect) to a flex column so `order` utilities work:

```tsx
        <div className="min-w-0 flex flex-col gap-5">
```

(replaces `<div className="min-w-0 space-y-5">`)

2. Add order classes to the "Coach queue" section (the one with `aria-labelledby="priority-title"`):

```tsx
          <section aria-labelledby="priority-title" className="order-first sm:order-none">
```

3. Bump touch targets — change these three `min-h-*`/unset heights to `min-h-11`:
   - The client-select chip button (`className="flex min-h-10 shrink-0 items-center gap-1.5 ..."`) → `min-h-11`
   - The "All clients" toggle (`className="min-h-10 shrink-0 rounded-md ..."`) → `min-h-11`
   - The per-client detail nav pills inside `<nav>` at the `client-overview-title` section (`className="min-h-8 shrink-0 rounded-md ..."`, appears 4 times for Week/Decisions/Nutrition/Inspect details, plus the `aria-current="page"` Summary span) → `min-h-11`

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/CoachCommandCenter.test.tsx`
Expected: PASS (all tests, including pre-existing ones)

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @hybrid/web exec tsc -p tsconfig.json --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/coach/CoachCommandCenter.tsx apps/web/src/coach/CoachCommandCenter.test.tsx
git commit -m "ARC coach: Command Center decision queue first on phone, 44px targets"
```

---

### Task 3: `CoachLibrary` — touch targets

**Files:**
- Modify: `apps/web/src/coach/CoachLibrary.tsx`
- Test: `apps/web/src/coach/CoachLibrary.test.tsx` (existing file, extend)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing consumed by other tasks.

Grids in this file already collapse correctly below `sm` (the template-row grid and the two-column shell both use unprefixed `grid` as their mobile-first base with `sm:`/`xl:` overrides for wider screens) — the only real gap is touch-target sizing on the filter/day-picker buttons.

- [ ] **Step 1: Write the failing test**

The file already has an async `renderLibrary(repository)` helper (returns the RTL render result, including `container`) used by its existing tests. Add this `it` block to `apps/web/src/coach/CoachLibrary.test.tsx`, inside the existing `describe('CoachLibrary', ...)` block:

```tsx
  it('sizes the domain-filter and weekday-picker buttons to a 44px touch target', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    const { container } = await renderLibrary(repo);
    const dayButtons = container.querySelectorAll('fieldset button[aria-pressed]');
    expect(dayButtons.length).toBeGreaterThan(0);
    dayButtons.forEach((button) => expect(button).toHaveClass('min-h-11'));
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/CoachLibrary.test.tsx -t "44px touch target"`
Expected: FAIL — buttons currently have `min-h-8`, not `min-h-11`

- [ ] **Step 3: Implement touch-target bumps**

In `apps/web/src/coach/CoachLibrary.tsx`, change `min-h-8` to `min-h-11` in three places:
- The weekday picker buttons inside the `<fieldset>` (`Preferred training days`)
- The domain filter buttons (`Choice` function's button, used for Training system / Experience / Sessions each week)
- The strength/conditioning toggle group buttons (`role="group"` labeled "Filter Library by training system")

All three currently read `className={\`min-h-8 rounded-md border ...\`}` (or similar with `min-h-8`) — replace `min-h-8` with `min-h-11` in each template string.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/CoachLibrary.test.tsx`
Expected: PASS (all tests)

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @hybrid/web exec tsc -p tsconfig.json --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/coach/CoachLibrary.tsx apps/web/src/coach/CoachLibrary.test.tsx
git commit -m "ARC coach: Library filter/day-picker buttons to 44px touch targets"
```

---

### Task 4: `CoachAuthoring` — touch targets (both views)

**Files:**
- Modify: `apps/web/src/coach/CoachAuthoring.tsx`
- Test: `apps/web/src/coach/CoachAuthoring.test.tsx` (existing file, extend)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing consumed by other tasks.

`CoachAuthoring()` dispatches between `RosterAuthoringView` (roster clients) and `SelfCoachAuthoringView` (the signed-in demo athlete). Both already collapse to single-column layouts below their existing `xl:`/`lg:` breakpoints. Both have the same undersized control: a 7-day-of-week picker built from `min-h-6` labels (`grid grid-cols-7 gap-0.5`), plus `SelfCoachAuthoringView`'s `ProposalCard` has three cramped `<select>`/`<input>` controls in a `grid-cols-3` row with no vertical padding.

- [ ] **Step 1: Write the failing test**

The existing file only covers `RosterAuthoringView` (via the `CLIENT`/`renderAuthoring` fixtures already defined at the top of the file) and has no self-coach-view coverage at all. `CoachAuthoring()` falls through to `SelfCoachAuthoringView` whenever `selectedClient` is null (see the file's own comment on `renderAuthoring`, lines 24-32) — so an empty `repo.clients = []` is enough to reach it. Add both tests to `apps/web/src/coach/CoachAuthoring.test.tsx`, inside the existing `describe('CoachAuthoring (roster)', ...)` block for the first, and a new `describe` for the second:

```tsx
  it('sizes weekday-picker labels to a 44px touch target in the roster view', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [CLIENT];
    repo.workoutDrafts = [draftFixture()];
    const { container } = await renderAuthoring(repo);

    const dayLabels = container.querySelectorAll('fieldset .grid-cols-7 label');
    expect(dayLabels.length).toBeGreaterThan(0);
    dayLabels.forEach((label) => expect(label).toHaveClass('min-h-11'));
  });
```

(That one goes inside the existing `describe('CoachAuthoring (roster)', ...)` block, alongside the three tests already there.)

```tsx
describe('CoachAuthoring (self-coach)', () => {
  it('sizes weekday-picker labels to a 44px touch target', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [];
    const { container } = await renderAuthoring(repo);

    const dayLabels = container.querySelectorAll('fieldset .grid-cols-7 label');
    expect(dayLabels.length).toBeGreaterThan(0);
    dayLabels.forEach((label) => expect(label).toHaveClass('min-h-11'));
  });
});
```

(That one is a new top-level `describe` block, added after the existing `describe('CoachAuthoring (roster)', ...)` block closes.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/CoachAuthoring.test.tsx -t "44px touch target"`
Expected: FAIL — labels currently have `min-h-6`, not `min-h-11`

- [ ] **Step 3: Implement touch-target bumps**

In `apps/web/src/coach/CoachAuthoring.tsx`, change `min-h-6` to `min-h-11` in both weekday-picker `<label>` elements:
- `RosterAuthoringView`'s draft weekday picker (around line 128: `className={\`grid min-h-6 place-items-center rounded border text-[11px] ...\`}`)
- `ProposalCard`'s `DAYS` weekday picker (around line 408: same pattern)

Also widen `ProposalCard`'s three-column select/input row so each control has real tap height — change:

```tsx
      <div className="mt-1 grid grid-cols-3 gap-1">
```

to:

```tsx
      <div className="mt-1 grid grid-cols-3 gap-1.5">
```

and add `py-2` (up from `py-0.5`) to each of the three `<select>`/`<input>` elements inside it, so their rendered height clears 44px:

```tsx
          <select className="mt-0.5 w-full rounded border border-line2 bg-panel3 px-0.5 py-2 text-xs normal-case tracking-normal text-text" ...>
```

(apply `py-2` to all three: Priority `<select>`, Effort `<select>`, and the Minutes `<input>`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/CoachAuthoring.test.tsx`
Expected: PASS (all tests)

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @hybrid/web exec tsc -p tsconfig.json --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/coach/CoachAuthoring.tsx apps/web/src/coach/CoachAuthoring.test.tsx
git commit -m "ARC coach: Authoring weekday-picker and proposal-row touch targets"
```

---

### Task 5: Full verification and build check

**Files:** none modified — verification only.

**Interfaces:**
- Consumes: the completed state of Tasks 1–4.
- Produces: nothing (terminal task).

- [ ] **Step 1: Run the full web test suite**

Run: `pnpm --filter @hybrid/web test`
Expected: all test files pass, including the 4 files touched in Tasks 1–4 and every pre-existing test (233+ tests from the last full run this session, plus the new ones added here)

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @hybrid/web exec tsc -p tsconfig.json --noEmit`
Expected: no errors

- [ ] **Step 3: Run the ecosystem check**

Run: `pnpm run check:ecosystem`
Expected: `All ecosystem-contract static checks passed.` (unaffected by this work, run per CLAUDE.md's Safe Workflow)

- [ ] **Step 4: Build both product profiles and confirm they still succeed**

Run:
```bash
pnpm --filter @hybrid/web build:strength
pnpm --filter @hybrid/web build:conditioning
```
Expected: both build cleanly, no new warnings beyond the pre-existing chunk-size warning.

- [ ] **Step 5: Clean up build output**

```bash
rm -rf apps/web/dist-strength apps/web/dist-conditioning
```

- [ ] **Step 6: Push**

```bash
git push -u origin claude/handoff-md-review-z00wqf
```
