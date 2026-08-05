# Mobile Sync Product Partition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A conditioning-build phone syncs (pulls + pushes) only conditioning-kind workouts/sessions; a strength-build phone syncs only strength-kind. Web is untouched and keeps seeing/programming both.

**Architecture:** One new pure function, `restrictToProduct(db, domain)`, in `packages/engine/src/session.ts`, filters `workouts`/`sessions` by the existing `kind` field. It is wired into exactly two call sites in `apps/mobile/src/cloud/sync.tsx` — the push path and the pull path — leaving `packages/engine`'s merge/tombstone logic, `apps/web`, and the disabled ecosystem domain-snapshot layer entirely untouched.

**Tech Stack:** TypeScript, vitest (engine unit tests), Expo/React Native (mobile), Supabase (sync backend, unchanged), EAS (manual verification builds).

## Global Constraints

- `restrictToProduct` touches ONLY `db.workouts` and `db.sessions`. `settings`, `core`, `ecosystem` pass through unchanged on its return value (spec: "Non-goals").
- A workout/session with no `kind` set must sync as strength (`isCondWorkout` already treats no-kind as not-conditioning; `restrictToProduct` must preserve that, not introduce a new default).
- `apps/web` and `apps/web/src/cloud/sync.tsx` are not modified by this plan.
- `ECOSYSTEM_SYNC_ENABLED`, `buildProductSyncNamespace`, `applyProductSyncNamespace`, and the `athlete_core`/`athlete_domain_snapshots`/`athlete_weekly_plans` tables are not modified by this plan.
- Deletion in this codebase is tombstone-only (`Settings.deletedIds`) — never inferred from a record's absence. Every task below relies on this and must not add any code path that treats "missing from the filtered local set" as a delete signal.

---

### Task 1: `restrictToProduct` in the engine, with unit tests

**Files:**
- Modify: `packages/engine/src/session.ts` (add function after `isCondWorkout`, currently ending at line 563)
- Test: `packages/engine/test/db.test.ts` (add a new `describe` block after the existing `describe('isCondWorkout reads the stored kind, not block contents', ...)` block, which ends at line 464)

**Interfaces:**
- Produces: `restrictToProduct(db: EngineDB, domain: 'strength' | 'conditioning'): EngineDB` — exported from `packages/engine/src/session.ts`, re-exported by `packages/engine/src/index.ts`'s existing `export * from './session'` (no index.ts change needed). Consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

Open `packages/engine/test/db.test.ts`. Its existing import line is:

```ts
import { isCondWorkout } from '../src/session';
```

Change it to also bring in the new function:

```ts
import { isCondWorkout, restrictToProduct } from '../src/session';
```

Then add this block directly after the existing `describe('isCondWorkout reads the stored kind, not block contents', ...)` block (after its closing `});`):

```ts
describe('restrictToProduct keeps only one domain\'s workouts and sessions', () => {
  const db: EngineDB = {
    workouts: [
      { id: 'w-strength', kind: 'strength', blocks: [] },
      { id: 'w-cond', kind: 'conditioning', blocks: [] },
      { id: 'w-kindless', blocks: [] },
    ],
    sessions: [
      { id: 's-strength', date: '2026-08-05', status: 'completed', kind: 'strength', blocks: [] },
      { id: 's-cond', date: '2026-08-05', status: 'completed', kind: 'conditioning', blocks: [] },
      { id: 's-kindless', date: '2026-08-05', status: 'completed', blocks: [] },
    ],
    settings: { theme: 'dark' } as EngineDB['settings'],
    core: { schemaVersion: 1 } as EngineDB['core'],
  };

  it('keeps strength and kind-less workouts/sessions for domain: strength, drops conditioning', () => {
    const out = restrictToProduct(db, 'strength');
    expect(out.workouts.map((w) => w.id).sort()).toEqual(['w-kindless', 'w-strength']);
    expect(out.sessions.map((s) => s.id).sort()).toEqual(['s-kindless', 's-strength']);
  });

  it('keeps only conditioning workouts/sessions for domain: conditioning, drops strength and kind-less', () => {
    const out = restrictToProduct(db, 'conditioning');
    expect(out.workouts.map((w) => w.id)).toEqual(['w-cond']);
    expect(out.sessions.map((s) => s.id)).toEqual(['s-cond']);
  });

  it('passes settings and core through untouched', () => {
    const out = restrictToProduct(db, 'conditioning');
    expect(out.settings).toBe(db.settings);
    expect(out.core).toBe(db.core);
  });
});
```

Note `EngineDB` must already be imported in this test file as a type — check the top of `packages/engine/test/db.test.ts`; if it is not imported, add `import type { EngineDB } from '../src/types';` alongside the existing imports.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @hybrid/engine test -- db.test.ts`
Expected: FAIL — `restrictToProduct` is not exported from `../src/session`.

- [ ] **Step 3: Write the implementation**

In `packages/engine/src/session.ts`, add this function immediately after `isCondWorkout` (after its closing `}` at line 563):

```ts
/** Narrows an EngineDB to one product's own workouts and sessions — the sync
 *  boundary between the strength and conditioning mobile builds. A workout or
 *  session with no `kind` set is not conditioning (matches `isCondWorkout`'s
 *  existing default), so it stays on the strength side. `settings`, `core`,
 *  and `ecosystem` are shared across both products and pass through
 *  unchanged — see docs/superpowers/specs/2026-08-05-mobile-sync-product-partition-design.md. */
export function restrictToProduct(db: EngineDB, domain: 'strength' | 'conditioning'): EngineDB {
  const conditioning = domain === 'conditioning';
  return {
    ...db,
    workouts: db.workouts.filter((w) => isCondWorkout(w) === conditioning),
    sessions: db.sessions.filter((s) => (s.kind === 'conditioning') === conditioning),
  };
}
```

Add `EngineDB` to the `import type { ... } from './types';` block at the top of `packages/engine/src/session.ts` (it currently imports `AnySet, Block, CondBlock, Exercise, ExerciseHistoryEntry, LoggedSet, ModeKey, PlannedSet, PrRecord, Session, StrengthBlock, Workout, TextBlock` — add `EngineDB` alphabetically after `ExerciseHistoryEntry`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @hybrid/engine test -- db.test.ts`
Expected: PASS, all three new tests plus every pre-existing test in the file.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/session.ts packages/engine/test/db.test.ts
git commit -m "engine: add restrictToProduct for per-product sync partitioning"
```

---

### Task 2: Merge-safety regression test

Proves the specific safety claim the design spec makes: filtering the *local* side before a pull/push round-trip can never make the *other* product's remote records disappear, because deletion is tombstone-only. This is a pure-function test against the existing, unmodified `applyPull`/`buildPushState` — it does not touch `apps/mobile`.

**Files:**
- Test: `packages/engine/test/cloud.test.ts` (uses its existing `wk()`/`sess()` helpers, defined near the top of the file)

**Interfaces:**
- Consumes: `restrictToProduct` from Task 1, `applyPull`/`buildPushState` from `../src/cloud` (already imported in this file).

- [ ] **Step 1: Write the failing test**

Add `restrictToProduct` to this file's existing import line:

```ts
import { applyPull, buildPushState } from '../src/cloud';
```

becomes:

```ts
import { applyPull, buildPushState } from '../src/cloud';
import { restrictToProduct } from '../src/session';
```

Then add this block at the end of the file:

```ts
describe('restrictToProduct + pull/push round-trip', () => {
  it('a conditioning-filtered pull keeps the strength record out of the merge, but a strength device still has it after its own pull', () => {
    const remote: EngineDB = {
      workouts: [wk('w-strength', { kind: 'strength' }), wk('w-cond', { kind: 'conditioning' })],
      sessions: [],
      settings: {},
    };
    const conditioningLocal: EngineDB = { workouts: [], sessions: [], settings: {} };
    const conditioningResult = applyPull(
      restrictToProduct(conditioningLocal, 'conditioning'),
      restrictToProduct(remote, 'conditioning'),
    );
    expect(conditioningResult.db.workouts.map((w) => w.id)).toEqual(['w-cond']);

    const strengthLocal: EngineDB = { workouts: [], sessions: [], settings: {} };
    const strengthResult = applyPull(
      restrictToProduct(strengthLocal, 'strength'),
      restrictToProduct(remote, 'strength'),
    );
    expect(strengthResult.db.workouts.map((w) => w.id)).toEqual(['w-strength']);
  });

  it('a conditioning push filtered from a local db that also holds a leftover strength workout does not erase that workout from the pushed state', () => {
    const local: EngineDB = {
      workouts: [wk('w-strength', { kind: 'strength' }), wk('w-cond', { kind: 'conditioning' })],
      sessions: [],
      settings: {},
    };
    const existingRemoteState = {
      hybridEngine: { workouts: [wk('w-strength', { kind: 'strength' })], sessions: [], settings: {} },
    };
    const pushed = buildPushState(restrictToProduct(local, 'conditioning'), existingRemoteState) as {
      hybridEngine: EngineDB;
    };
    expect(pushed.hybridEngine.workouts.map((w) => w.id).sort()).toEqual(['w-cond', 'w-strength']);
  });
});
```

Confirm `EngineDB` is imported as a type in this file already (`import type { EngineDB, Session, Workout } from '../src/types';` per the existing header) — it is, per the file's current imports.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hybrid/engine test -- cloud.test.ts`
Expected: FAIL — `restrictToProduct` not found (this task can be done before or after Task 1's commit lands, but must run after Task 1's code exists; if Task 1 is already committed this step should instead just confirm the new tests exist and are about to be run for the first time, so treat "FAIL because assertions haven't been checked yet" as satisfied by proceeding straight to Step 3 in that case).

- [ ] **Step 3: Run test to verify it passes**

Run: `pnpm --filter @hybrid/engine test -- cloud.test.ts`
Expected: PASS, all new tests plus every pre-existing test in the file. No implementation step is needed here — this task only exercises Task 1's function against Task-1-unmodified `cloud.ts`.

- [ ] **Step 4: Commit**

```bash
git add packages/engine/test/cloud.test.ts
git commit -m "engine: regression test — product-filtered sync round-trip can't lose the other product's data"
```

---

### Task 3: Wire `restrictToProduct` into mobile sync

**Files:**
- Modify: `apps/mobile/src/cloud/sync.tsx:6-12` (import), `:149` (push), `:184` (pull)

**Interfaces:**
- Consumes: `restrictToProduct` from `@hybrid/engine` (Task 1), `PRODUCT_ID` already imported from `../product` in this file.

- [ ] **Step 1: Add the import**

In `apps/mobile/src/cloud/sync.tsx`, the existing `@hybrid/engine` import block is:

```ts
import {
  applyPull,
  buildProductSyncNamespace,
  buildPushState,
  cloudFp,
  sanitizeDB,
  type EngineDB,
} from '@hybrid/engine';
```

Add `restrictToProduct` alphabetically:

```ts
import {
  applyPull,
  buildProductSyncNamespace,
  buildPushState,
  cloudFp,
  restrictToProduct,
  sanitizeDB,
  type EngineDB,
} from '@hybrid/engine';
```

- [ ] **Step 2: Filter the push path**

Find this line inside `pushNow` (currently line 149):

```ts
      const state = buildPushState(source, existing);
```

Replace it with:

```ts
      const state = buildPushState(restrictToProduct(source, PRODUCT_ID), existing);
```

`source` at this point already carries whatever the `ECOSYSTEM_SYNC_ENABLED` branch above it set on `core`/`ecosystem` — `restrictToProduct` passes those through unchanged, so this ordering is safe regardless of that flag's state.

- [ ] **Step 3: Filter the pull path**

Find this line inside `reconcile` (currently line 184):

```ts
      const { db: mergedDb, needsPush: legacyNeedsPush } = applyPull(dbRef.current, remote);
```

Replace it with:

```ts
      const { db: mergedDb, needsPush: legacyNeedsPush } = applyPull(
        restrictToProduct(dbRef.current, PRODUCT_ID),
        remote ? restrictToProduct(remote, PRODUCT_ID) : null,
      );
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @hybrid/mobile typecheck`
Expected: no errors.

- [ ] **Step 5: Run the mobile test suite**

Run: `pnpm --filter @hybrid/mobile test`
Expected: PASS — no existing test exercises `sync.tsx` directly (it has no test file today), so this confirms nothing else broke.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/cloud/sync.tsx
git commit -m "mobile: partition sync by product — each build only pulls/pushes its own kind"
```

---

### Task 4: Full verification, push, manual device check (not skippable)

This task closes the loop the previous three cannot: proving the isolation on real devices against real Supabase state, and confirming `apps/web` is genuinely unaffected. Do not report this plan complete without it.

**Files:** none (verification only)

- [ ] **Step 1: Run the full engine and mobile suites one more time from a clean state**

```bash
pnpm --filter @hybrid/engine test
pnpm --filter @hybrid/mobile typecheck
pnpm --filter @hybrid/mobile test
```

Expected: PASS across all three.

- [ ] **Step 2: Confirm web is untouched**

```bash
git diff --stat main -- apps/web
```

Expected: empty output (no changes under `apps/web`).

- [ ] **Step 3: Push the branch**

```bash
git push -u origin <branch-name>
```

- [ ] **Step 4: Dispatch conditioning-preview and strength-preview EAS builds on this branch**

Use the `mobile-eas.yml` workflow (`workflow_dispatch`) with `profile: conditioning-preview` and, separately, `profile: preview` (strength), both targeting this branch, both with `wait: true`. Retrieve both real install URLs from the run logs — do not fabricate them.

- [ ] **Step 5: Manual cross-check (requires the user's phone, or two phones, signed into the same account)**

1. Install the conditioning-preview build and the strength-preview build, both signed into the same account.
2. On the conditioning build: log one conditioning session, let it sync.
3. On the strength build: log one strength session, let it sync.
4. On the conditioning build: confirm Library/History shows only the conditioning session — the strength one from step 3 must not appear.
5. On the strength build: confirm Library/History shows only the strength session — the conditioning one from step 2 must not appear.
6. Open `apps/web` (either branded build, no change needed for this check) signed into the same account: confirm **both** sessions from steps 2 and 3 are visible there.

Report the real outcome of steps 4-6 — if either mobile build shows the wrong session, this is a bug in Task 3's wiring or Task 1's filter predicate and must be fixed before calling this done, not noted as a known gap.

- [ ] **Step 6: Report results**

Summarize to the user: test/typecheck results, the two real install URLs, and the real outcome of the manual cross-check (step 5).

---

## Self-Review

- **Spec coverage:** "conditioning syncs only conditioning, strength only strength" → Task 3. "Kind-less syncs as strength" → Task 1's predicate + test. "Prune already-installed phones' wrong-kind data on next sync" → Task 3 Step 3 filters `dbRef.current` itself, which is what makes this automatic on every reconcile. "Web unaffected" → no web files touched anywhere in this plan (verified explicitly in Task 4 Step 2). "Deletion safety" → Task 2's regression test. "Manual verification required" → Task 4, marked not skippable.
- **Placeholder scan:** none found — every step has real code or a real command.
- **Type consistency:** `restrictToProduct(db: EngineDB, domain: 'strength' | 'conditioning'): EngineDB` is the exact signature used identically in Tasks 1, 2, and 3.
