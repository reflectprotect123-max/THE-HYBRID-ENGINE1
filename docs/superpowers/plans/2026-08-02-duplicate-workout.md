# Duplicate Workout — implementation plan

Design doc: `docs/superpowers/specs/2026-08-02-duplicate-workout-design.md`

## Global Constraints

- No engine contract change — `Workout` already supports everything a duplicate needs.
- Route the new action to **Planner** (`/planner/:id` web, `nav.navigate('Planner', {id})` mobile), never to GuidedBuilder — GuidedBuilder is append-only and cannot be opened pre-populated with existing content (confirmed by survey).
- Fresh `uid()` at every level that carries one: the workout, each block, each exercise. Mirrors `duplicateExercise`'s own precedent (`session.ts:113-121`) and `freshSessionBlocks`'s id-refresh traversal (`session.ts` ~413-436) — read both before writing Task 1's function.
- `days`/`dates` cleared on the clone (don't inherit the original's scheduled slot). `_rev`/`sample` cleared. `updatedAt` refreshed to `Date.now()`. Name gets a " copy" suffix so two cards aren't visually identical in the collapsed Library list.
- No existing test coverage of Library's Edit/Delete/day-chip actions exists in either app (confirmed by survey) — this is new test ground, nothing legacy to preserve.

---

### Task 1: `duplicateWorkout` — engine function + tests

**Files:**
- Modify: `packages/engine/src/session.ts`
- Test: `packages/engine/test/session.test.ts`

- [ ] **Step 1: Read `duplicateExercise` (session.ts:96-121) and `freshSessionBlocks` (session.ts ~413-436) first.** Confirm the exact current `Block`/`StrengthBlock`/`CondBlock`/`TextBlock` discriminants (`kind: undefined | 'conditioning' | 'text'`) against `packages/engine/src/types.ts` before writing the switch below — the sketch here is illustrative, adjust to match the real current shapes exactly.

- [ ] **Step 2: Add `duplicateWorkout`** near `duplicateExercise` in `session.ts`, with a doc comment in the same voice as the file's existing ones (why ids are refreshed end-to-end, why scheduling fields are cleared):

```typescript
/**
 * Clone a Workout as a new, independent, unscheduled record.
 *
 * Every level that carries an id gets a fresh one — the workout itself,
 * each block, each exercise — mirroring duplicateExercise's own reasoning:
 * a shared id would let an edit to the copy reach back into the original
 * (directly, or via a sync-layer merge keyed on that id). Sets are copied
 * by value for the same reason.
 *
 * `days`/`dates` are cleared, not copied: inheriting the original's
 * scheduled slot would silently double-book that weekday until the
 * athlete manually reassigns it. `_rev` is sync bookkeeping specific to
 * the original record. `updatedAt` is refreshed like any new record.
 */
export function duplicateWorkout<S extends AnySet>(w: Workout<S>): Workout<S> {
  const blocks: Block<S>[] = w.blocks.map((b) => {
    if (b.kind === 'text') return { ...b, id: uid(), done: false };
    if (b.kind === 'conditioning') return { ...b, id: uid(), condResult: undefined };
    return {
      ...b,
      id: uid(),
      exercises: b.exercises.map((ex) => ({ ...ex, id: uid(), sets: ex.sets.map((s) => ({ ...s })) })),
    };
  });
  return {
    ...w,
    id: uid(),
    name: (w.name || 'Session') + ' copy',
    blocks,
    days: undefined,
    dates: undefined,
    updatedAt: Date.now(),
    _rev: undefined,
    sample: undefined,
  };
}
```

- [ ] **Step 3: Add tests to `packages/engine/test/session.test.ts`**, in a new `describe('duplicateWorkout', ...)` block near the existing `describe('duplicateExercise', ...)` (lines 82-117), matching that block's own conventions (plain-English `it()` sentences, fresh-id assertions via `.not.toBe(...)`, deep-copy-independence assertions by mutating the copy and checking the original). Cover at minimum:
  - Fresh workout id, different from the original.
  - Fresh block ids and fresh exercise ids, all different from the originals.
  - Mutating a set on the copy does not affect the original (deep-copy check, mirrors `duplicateExercise`'s own "copies sets by value" test).
  - `days`/`dates` are cleared on the copy even when the original had them set.
  - Name gets a " copy" suffix; a workout with no name at all still produces a sensible name (`'Session copy'`).
  - A `CondBlock` carrying a `condResult` has it stripped on the copy (a template shouldn't inherit another session's logged result).
  - `_rev` is cleared even if present on the original.

- [ ] **Step 4: Run the engine test suite.** `pnpm --filter @hybrid/engine test`. Expected: all pass, existing count + however many rows Step 3 added.

- [ ] **Step 5: Typecheck.** `pnpm --filter @hybrid/engine typecheck`. Expected: exit 0.

- [ ] **Step 6: Commit.**
```bash
git add packages/engine/src/session.ts packages/engine/test/session.test.ts
git commit -m "engine: duplicateWorkout — clone a workout with fresh ids, cleared schedule"
```

(No change needed to `packages/engine/src/index.ts` — `session.ts` is already re-exported wholesale via `export * from './session';`, confirmed by survey.)

---

### Task 2: Web Library — Duplicate button

**Files:**
- Modify: `apps/web/src/screens/Library.tsx`
- Test: `checks/react-smoke.mjs`

**Interfaces:**
- Consumes: `duplicateWorkout` from Task 1.

- [ ] **Step 1: Add the import.** Alongside the existing `@hybrid/engine` named imports (lines 3-17, `uid` at line 12), add `duplicateWorkout` in the same alphabetical spot this file's import block already follows.

- [ ] **Step 2: Add the handler.** Near `addWorkout()` (lines 69-75):
```typescript
function duplicate(w: Workout) {
  const copy = duplicateWorkout(w);
  update((draft) => {
    draft.workouts.push(copy);
  });
  nav(`/planner/${copy.id}`);
}
```

- [ ] **Step 3: Add the button.** In the Card row's action area (lines 183-207, inside the `open === w.id ? (...)` block, alongside the existing Edit/Delete buttons), add a Duplicate button between them:
```tsx
<Button size="sm" onClick={() => duplicate(w)}>
  Duplicate
</Button>
```
Read the file first to confirm the exact current JSX structure and styling conventions (the Edit button uses `variant="brass"`, Delete uses conditional danger styling — Duplicate should look like a plain secondary action, closest to Delete's unarmed appearance, not brass).

- [ ] **Step 4: Typecheck.** `pnpm --filter @hybrid/web typecheck`. Expected: exit 0.

- [ ] **Step 5: Add a react-smoke scenario.** In `checks/react-smoke.mjs`, near the existing Library-focused tests (search for `'the Library creates a session and opens the guided builder'`, ~line 702):
```javascript
await t('Duplicate clones a workout and lands on Planner with independent content', async () => {
  // Seed a workout with a known name and at least one exercise via
  // localStorage (mirror the seeding pattern used by nearby tests), then:
  // 1. Navigate to Library, expand the card, click "Duplicate".
  // 2. Assert the URL becomes /planner/<new-id> (different from the original's id).
  // 3. Assert the Planner shows a name ending in " copy".
  // 4. Edit a field on the clone, navigate back to Library, expand the
  //    ORIGINAL workout's card, and assert its data is unchanged.
});
```
Read the file's existing Library/Planner navigation patterns (`page.click('button:has-text(...)')`, `page.waitForURL(...)`, `page.waitForSelector('text=...')`) before writing the exact steps — mirror the established style rather than inventing new helpers.

- [ ] **Step 6: Rebuild and run smoke.** `pnpm run build:site && pnpm run smoke`. Expected: exit 0, including the new scenario.

- [ ] **Step 7: Run full verification.** `pnpm run verify`. Expected: exit 0.

- [ ] **Step 8: Commit.**
```bash
git add apps/web/src/screens/Library.tsx checks/react-smoke.mjs
git commit -m "web: Duplicate button on Library workout cards"
```

---

### Task 3: Mobile Library — Duplicate button

**Files:**
- Modify: `apps/mobile/src/screens/Library.tsx`
- Test: `apps/mobile/test/screens.test.tsx`

**Interfaces:**
- Consumes: `duplicateWorkout` from Task 1.

- [ ] **Step 1: Add the import.** Alongside the existing `@hybrid/engine` named imports (lines 5-19, `uid` at line 14).

- [ ] **Step 2: Add the handler**, near `add()` (lines 65-71):
```typescript
const duplicate = (w: Workout) => {
  const copy = duplicateWorkout(w);
  update((d) => {
    d.workouts.push(copy);
  });
  nav.navigate('Planner', { id: copy.id });
};
```

- [ ] **Step 3: Add the button.** In the expanded card's action area (lines 193-200, alongside the existing Edit `Btn`):
```tsx
<Btn variant="ghost" className="mt-1.5" onPress={() => duplicate(w)}>
  Duplicate
</Btn>
```
Read the file first to confirm current exact JSX/spacing — match whatever layout convention the Edit button already uses (row vs stacked).

- [ ] **Step 4: Typecheck.** `pnpm --filter @hybrid/mobile typecheck`. Expected: exit 0.

- [ ] **Step 5: Add an RNTL test to `apps/mobile/test/screens.test.tsx`**, in the existing `describe('Library', ...)` block (lines 152-179). Follow the established targeting convention from that file (accessibility labels like `getByLabelText('delete Lower')` for the delete control) — add a matching `accessibilityLabel`/`label` prop to the new Duplicate button if the `Btn` component supports one (check `apps/mobile/src/ui.tsx`), then assert: pressing Duplicate on a named workout results in navigation to `'Planner'` with a `id` different from the original (mock/spy on `nav.navigate` per however nearby tests already handle navigation assertions — read the file for the established pattern rather than inventing one).

- [ ] **Step 6: Run tests.** `pnpm --filter @hybrid/mobile test -- screens.test.tsx`, then `pnpm --filter @hybrid/mobile test` (full suite). Expected: all pass, existing count + 1.

- [ ] **Step 7: Commit.**
```bash
git add apps/mobile/src/screens/Library.tsx apps/mobile/test/screens.test.tsx
git commit -m "mobile: Duplicate button on Library workout cards"
```

---

### Task 4: Full verification, push, and handoff

**Files:** `handoff.md` only.

- [ ] **Step 1: Run `pnpm run verify`** from the repo root. Expected: exit 0 across everything.

- [ ] **Step 2: Update `handoff.md`.** Add a dated entry: what shipped (`duplicateWorkout` engine function, Duplicate button on Library cards in both apps, routes to Planner not GuidedBuilder), the design decisions (fresh ids end-to-end, `days`/`dates` cleared, name suffix). Real commit SHAs and test counts from your own `pnpm run verify` run.

- [ ] **Step 3: Commit and push the branch** (NOT `main`):
```bash
git add handoff.md
git commit -m "docs: handoff — duplicate workout shipped"
git push -u origin duplicate-workout
```
