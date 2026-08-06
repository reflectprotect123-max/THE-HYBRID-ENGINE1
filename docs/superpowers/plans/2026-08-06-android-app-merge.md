# Android App Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the two Android apps into one install (`com.hybridengine.app`) containing both disciplines as two sealed worlds with a Settings switch, while the sync layer carries both kinds of data safely.

**Architecture:** A build with `EXPO_PUBLIC_HYBRID_PRODUCT` **unset** becomes the merged app (that is what the existing strength `preview`/`production` EAS profiles already produce, so existing installs update in place). Builds with the variable set stay legacy single-product — needed for the conditioning farewell release. In merged mode: sync is unfiltered in both directions, a runtime discipline store scopes what screens *see* via `restrictToProduct`, and `ThemeProvider` re-points at the active discipline so the existing runtime themes signal the world.

**Tech Stack:** Expo/React Native, NativeWind theme vars, Vitest (engine/web) + **Jest (mobile — globals injected, no runner imports)**, `@hybrid/engine` (`restrictToProduct`, `mergeEngines`, ecosystem namespace), Supabase `app_state` + ecosystem contract.

**Spec:** `docs/superpowers/specs/2026-08-06-android-app-merge-design.md`

## Global Constraints

- The database is never filtered on write. Reads scope; writes, Coordinator and whole-athlete-state see everything. (Spec §2; 5 Aug C1/C2 lessons.)
- Push stays additive and unfiltered — the post-C1 state must not regress. (Spec §4.)
- The discipline preference is NOT a field on `EngineDB` — it must never enter a sync merge. (Spec §2.)
- No visual change beyond the Settings switch row. (Spec §3, §8.)
- No confirmation dialog on switch — switching destroys nothing. (Spec §3.)
- `app.config.js`'s `isConditioning` branch and the `conditioning-*` EAS profiles are KEPT until the farewell release has shipped (Task 9 is gated). (Spec §5, §6.)
- Run from repo root: `pnpm run typecheck`, `pnpm --filter @hybrid/mobile test`, `pnpm --filter @hybrid/web test`, `pnpm --filter @hybrid/engine test`, `pnpm run check:ecosystem` must all pass at every commit.

---

### Task 1: Web corrective — dashboard shows both disciplines again

The web slice (`24c2a39`) scoped the dashboard's reads; the dashboard must show both. Revert the store scoping, keep the pure helpers and their tests (they port to mobile), keep the `vite.config.ts` manifest fix.

**Files:**
- Modify: `apps/web/src/store/db.tsx`
- Keep unchanged: `apps/web/src/discipline.ts`, `apps/web/test/discipline.test.ts`, `apps/web/vite.config.ts`

**Interfaces:**
- Produces: `DbCtx` back at its pre-scoping shape — `workouts: db.workouts`, `sessions: db.sessions`, `activeSession` unscoped, no `discipline`, no `foreignActiveSession`.

- [ ] **Step 1: Revert the scoping edits in `apps/web/src/store/db.tsx`**

Remove these (added by `24c2a39`):
- the imports of `restrictToProduct`, `ProductId`, `splitActiveSession`, `useDiscipline`
- the `discipline` / `foreignActiveSession` members and their doc comments from `DbCtx`
- the `const discipline = useDiscipline();` line

Restore the value memo to:

```tsx
  const value = useMemo<DbCtx>(() => {
    const activeSession = db.sessions.find((s) => s.status === 'active') || null;
    const core = db.core || ensureSharedCore(db).core!;
    // …(facts/athleteState/weeklyPlan block unchanged)…
    return {
      db,
      update,
      updateSession,
      saveFailed,
      dataRecovered,
      whoop,
      setWhoop,
      hr: { profile: db.settings.profile, whoop },
      activeSession,
      workouts: db.workouts,
      sessions: db.sessions,
      settings: db.settings,
      athleteState,
      weeklyPlan,
    };
  }, [db, update, updateSession, saveFailed, dataRecovered, whoop]);
```

- [ ] **Step 2: Verify**

Run: `pnpm run typecheck && pnpm --filter @hybrid/web test`
Expected: typecheck clean; 12 files / 85 tests pass (`discipline.test.ts` tests only pure helpers, so it still passes).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/store/db.tsx
git commit -m "fix(web): dashboard shows both disciplines again

Reverts the store-level discipline scoping — web is the unfiltered
dashboard; the runtime scoping belongs on mobile (see the Android app
merge spec). Keeps discipline.ts pure helpers and the manifest fix."
```

---

### Task 2: Mobile discipline store

Port `apps/web/src/discipline.ts` to mobile, backed by the mobile store's own `storage`.

**Files:**
- Create: `apps/mobile/src/discipline.ts`
- Test: `apps/mobile/test/discipline.test.ts`

**Interfaces:**
- Consumes: `storage` from `apps/mobile/src/store/storage` (same `getItem/setItem/removeItem` shape as web's `webStorage`); `ProductId` from `@hybrid/product-scope`.
- Produces: `useDiscipline(): ProductId`, `setDiscipline(next: ProductId): void`, `currentDiscipline(): ProductId`, `disciplineOf(kind: string | undefined): ProductId`, `splitActiveSession<T extends {kind?: string}>(live, discipline): { activeSession: T | null; foreignActiveSession: T | null }`, `__resetDisciplineForTest(): void`. Storage key: `'hybrid-active-discipline-v1'`. Fresh install default: `'strength'` (spec §2).

- [ ] **Step 1: Write the failing test** — `apps/mobile/test/discipline.test.ts`

```ts
// Jest injects describe/it/expect/beforeEach as globals — no runner import.
import {
  __resetDisciplineForTest,
  currentDiscipline,
  disciplineOf,
  setDiscipline,
  splitActiveSession,
} from '../src/discipline';

beforeEach(() => __resetDisciplineForTest());

describe('discipline store', () => {
  it('defaults a fresh install to strength', () => {
    expect(currentDiscipline()).toBe('strength');
  });

  it('remembers a switch', () => {
    setDiscipline('conditioning');
    expect(currentDiscipline()).toBe('conditioning');
  });
});

describe('disciplineOf', () => {
  it('defaults absent/unknown kind to strength, never guesses conditioning', () => {
    expect(disciplineOf('conditioning')).toBe('conditioning');
    expect(disciplineOf(undefined)).toBe('strength');
    expect(disciplineOf('anything-else')).toBe('strength');
  });
});

describe('splitActiveSession', () => {
  const cond = { id: 'c1', kind: 'conditioning' } as const;
  it('routes a foreign live session to foreignActiveSession, never to null', () => {
    expect(splitActiveSession(cond, 'strength')).toEqual({
      activeSession: null,
      foreignActiveSession: cond,
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @hybrid/mobile test -- discipline`
Expected: FAIL — module `../src/discipline` not found.

- [ ] **Step 3: Implement `apps/mobile/src/discipline.ts`**

Copy `apps/web/src/discipline.ts` with three changes: import `{ storage } from './store/storage'` instead of using `localStorage`; the fresh-install default is the literal `'strength'` (mobile's merged build has no `VITE_HYBRID_PRODUCT`; do NOT import `PRODUCT_ID` here — that would couple the view preference to the legacy build flag); keep `useSyncExternalStore` (React Native supports it).

```ts
import { useSyncExternalStore } from 'react';
import type { ProductId } from '@hybrid/product-scope';
import { storage } from './store/storage';

/** Which world the athlete is in. View preference — NOT EngineDB data. */
const KEY = 'hybrid-active-discipline-v1';

let active: ProductId = load();
const listeners = new Set<() => void>();

function load(): ProductId {
  try {
    const raw = storage.getItem(KEY);
    if (raw === 'strength' || raw === 'conditioning') return raw;
  } catch {
    /* unreadable storage — fall through */
  }
  return 'strength';
}

export function useDiscipline(): ProductId {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => active,
    () => 'strength',
  );
}

export function setDiscipline(next: ProductId): void {
  if (next === active) return;
  active = next;
  try {
    storage.setItem(KEY, next);
  } catch {
    /* storage failed — the switch still holds for this run */
  }
  listeners.forEach((l) => l());
}

export function currentDiscipline(): ProductId {
  return active;
}

export function disciplineOf(kind: string | undefined): ProductId {
  return kind === 'conditioning' ? 'conditioning' : 'strength';
}

export function splitActiveSession<T extends { kind?: string }>(
  live: T | null | undefined,
  discipline: ProductId,
): { activeSession: T | null; foreignActiveSession: T | null } {
  if (!live) return { activeSession: null, foreignActiveSession: null };
  return disciplineOf(live.kind) === discipline
    ? { activeSession: live, foreignActiveSession: null }
    : { activeSession: null, foreignActiveSession: live };
}

export function __resetDisciplineForTest(): void {
  try {
    storage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  active = load();
  listeners.clear();
}
```

If `apps/mobile/test` mocks `storage` for other suites, follow the same mock pattern here; if `storage.getItem` is async on mobile, mirror how `store/db.tsx`'s `loadDB(storage, LS_KEY)` consumes it — `loadDB` treats it synchronously, so the interface is synchronous.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @hybrid/mobile test -- discipline`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/discipline.ts apps/mobile/test/discipline.test.ts
git commit -m "feat(mobile): runtime discipline store, ported from web"
```

---

### Task 3: Merged-mode flag in `product.ts`

An unset `EXPO_PUBLIC_HYBRID_PRODUCT` now means "merged app", not "strength". Set values keep their legacy single-product meaning for the farewell build.

**Files:**
- Modify: `apps/mobile/src/product.ts`
- Test: `apps/mobile/test/sync.test.tsx` (the existing `it('reads its product from the environment')`)

**Interfaces:**
- Produces: `IS_MERGED: boolean` (true when the env var is unset); `PRODUCT_ID: ProductId` (unchanged meaning for legacy builds; `'strength'` in merged builds — only legacy code paths may consult it); `PRODUCT` unchanged.

- [ ] **Step 1: Write the env test first — NEW FILE**

**Execution correction (found during Task 2):** mobile tests run on **Jest with
injected globals**, not Vitest — never import from `'vitest'` in
`apps/mobile/test`. And `src/product.ts` reads the env var ONCE at module
eval (`sync.test.tsx:83-93` documents this and binds `'strength'` file-wide),
so per-value tests need `jest.isolateModules`, in their own file.

Create `apps/mobile/test/product.test.ts`:

```ts
// Jest injects describe/it/expect as globals; product.ts reads the env var
// once at module eval, so each case re-evaluates it in an isolated registry.
const PREVIOUS = process.env.EXPO_PUBLIC_HYBRID_PRODUCT;
afterEach(() => {
  if (PREVIOUS === undefined) delete process.env.EXPO_PUBLIC_HYBRID_PRODUCT;
  else process.env.EXPO_PUBLIC_HYBRID_PRODUCT = PREVIOUS;
});

it('treats an unset product as the merged app', () => {
  delete process.env.EXPO_PUBLIC_HYBRID_PRODUCT;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { IS_MERGED, PRODUCT_ID } = require('../src/product');
    expect(IS_MERGED).toBe(true);
    expect(PRODUCT_ID).toBe('strength');
  });
});

it('treats a set product as a legacy single-product build', () => {
  process.env.EXPO_PUBLIC_HYBRID_PRODUCT = 'conditioning';
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { IS_MERGED, PRODUCT_ID } = require('../src/product');
    expect(IS_MERGED).toBe(false);
    expect(PRODUCT_ID).toBe('conditioning');
  });
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `pnpm --filter @hybrid/mobile test -- sync`
Expected: FAIL — `IS_MERGED` is not exported.

- [ ] **Step 3: Implement**

In `apps/mobile/src/product.ts`, after the existing validation block, replace the final two lines and update the doc comment's first paragraph:

```ts
/**
 * Unset now means the MERGED app (both worlds in one install) — which is what
 * the existing strength `preview`/`production` EAS profiles produce, so the
 * strength app updates in place into the merged app. A SET value builds a
 * legacy single-product app; that path exists for the conditioning farewell
 * release and dies with it. A defined-but-wrong value still fails loudly.
 */
export const IS_MERGED = raw === undefined || raw === '';
export const PRODUCT_ID: ProductId = raw === 'conditioning' ? 'conditioning' : 'strength';
export const PRODUCT = productDefinition(PRODUCT_ID);
```

(`raw === ''` because `vi.stubEnv` and some CI layers coerce unset to empty string; an empty string was already rejected by nothing and fell to strength before, so this is not a behavior change for real builds.) Note: the existing validation `if` must keep rejecting other garbage — leave it untouched.

- [ ] **Step 4: Run to verify all pass**

Run: `pnpm --filter @hybrid/mobile test && pnpm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/product.ts apps/mobile/test/product.test.ts
git commit -m "feat(mobile): unset product env now means the merged app"
```

---

### Task 4: Engine — merged ecosystem namespace

The merged app must populate BOTH domain partitions of the ecosystem namespace, composed from the existing single-domain builder so contract rules hold.

**Files:**
- Modify: `packages/engine/src/ecosystem.ts`
- Test: `packages/engine/test/ecosystem-merged.test.ts` (new)

**Interfaces:**
- Consumes: `buildProductSyncNamespace(db, domain, writer, now)` (existing, `packages/engine/src/ecosystem.ts:62`).
- Produces: `buildMergedSyncNamespace(db: EngineDB, writer: string, now?: number): EcosystemSyncNamespace` — both partitions populated, identical to what each single-domain call would have produced.

- [ ] **Step 1: Write the failing test** — `packages/engine/test/ecosystem-merged.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { buildMergedSyncNamespace, buildProductSyncNamespace, emptyDB } from '../src';
import type { EngineDB, Session } from '../src';

function mixedDb(): EngineDB {
  const db = emptyDB();
  db.sessions = [
    { id: 's1', kind: 'strength', status: 'completed', completedAt: 1, date: '2026-08-01' },
    { id: 'c1', kind: 'conditioning', status: 'completed', completedAt: 2, date: '2026-08-02' },
  ] as unknown as Session[];
  return db;
}

describe('buildMergedSyncNamespace', () => {
  it('populates both domain partitions', () => {
    const ns = buildMergedSyncNamespace(mixedDb(), 'hybrid:mobile', 1000);
    expect(ns.partitions.strength).toBeDefined();
    expect(ns.partitions.conditioning).toBeDefined();
  });

  it('each partition matches what the single-domain builder produces', () => {
    const db = mixedDb();
    const merged = buildMergedSyncNamespace(db, 'hybrid:mobile', 1000);
    const strengthOnly = buildProductSyncNamespace(db, 'strength', 'hybrid:mobile', 1000);
    expect(merged.partitions.strength).toEqual(strengthOnly.partitions.strength);
    const afterStrength = { ...db, core: strengthOnly.core, ecosystem: strengthOnly };
    const condOnly = buildProductSyncNamespace(afterStrength, 'conditioning', 'hybrid:mobile', 1000);
    expect(merged.partitions.conditioning).toEqual(condOnly.partitions.conditioning);
  });
});
```

Adjust the fixture's `Session` fields to whatever the existing ecosystem tests in `packages/engine/test/` use for minimal sessions — copy their fixture helper if one exists rather than inventing a second one.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @hybrid/engine test -- ecosystem-merged`
Expected: FAIL — `buildMergedSyncNamespace` is not exported.

- [ ] **Step 3: Implement** — append to `packages/engine/src/ecosystem.ts`

```ts
/**
 * Namespace for the MERGED mobile app: both domain partitions populated by
 * composing the single-domain builder, so every contract rule that holds for
 * one domain holds for both. Order (strength, then conditioning) is
 * arbitrary but fixed; the second call receives the first call's core and
 * namespace so bookkeeping is threaded, not forked.
 */
export function buildMergedSyncNamespace(
  db: EngineDB,
  writer: string,
  now = Date.now(),
): EcosystemSyncNamespace {
  const first = buildProductSyncNamespace(db, 'strength', writer, now);
  const threaded = { ...db, core: first.core, ecosystem: first };
  return buildProductSyncNamespace(threaded, 'conditioning', writer, now);
}
```

Export it from `packages/engine/src/index.ts` alongside `buildProductSyncNamespace` (same export list).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @hybrid/engine test && pnpm run check:ecosystem && pnpm run typecheck`
Expected: PASS — including all pre-existing engine tests (585).

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/ecosystem.ts packages/engine/src/index.ts packages/engine/test/ecosystem-merged.test.ts
git commit -m "feat(engine): merged-app ecosystem namespace covering both domains"
```

---

### Task 5: Sync un-partition for the merged app

The load-bearing task. In merged mode: no local narrowing, writer `hybrid:mobile`, both ecosystem partitions. Legacy builds keep today's behavior bit-for-bit.

**Files:**
- Modify: `apps/mobile/src/cloud/sync.tsx`
- Test: `apps/mobile/test/sync.test.tsx`

**Interfaces:**
- Consumes: `IS_MERGED`, `PRODUCT_ID` from `../product`; `buildMergedSyncNamespace` from `@hybrid/engine` (Task 4).
- Produces: no API change — `SyncProvider` behavior forks internally on `IS_MERGED`.

- [ ] **Step 1: Write the failing merged-mode tests first — NEW FILE**

**Execution correction:** `sync.test.tsx` binds
`process.env.EXPO_PUBLIC_HYBRID_PRODUCT = 'strength'` at module scope
(line 93) BEFORE importing the modules under test, because `product.ts`
reads it once at eval. Merged-mode tests therefore live in a NEW file,
`apps/mobile/test/sync-merged.test.tsx`, which `delete`s the env var at
module scope instead. To avoid duplicating the fake Supabase client and
`seed`/`mount`/`settle` helpers, first extract them from `sync.test.tsx`
into `apps/mobile/test/syncHarness.tsx` (a pure move — export
`mockClient`, `mockRow`, `mockPushes`, `seed`, `mount`, `settle`,
`pushedWorkoutIds`, `syncApi`, `dbApi`, and the `jest.mock` setup helper;
`sync.test.tsx` then imports them and must stay green before any new test
is added). Jest runs each file in its own module registry, so the two
files get independent env bindings.

```ts
// sync-merged.test.tsx, at module scope, BEFORE importing the harness:
delete process.env.EXPO_PUBLIC_HYBRID_PRODUCT;

describe('merged app (EXPO_PUBLIC_HYBRID_PRODUCT unset)', () => {

  it('keeps BOTH kinds on device after a reconcile', async () => {
    // Arrange: local db with one strength session; remote app_state with one
    // conditioning session (use the file's existing fixture builders).
    // Act: run reconcile via the existing harness.
    // Assert: the store now holds both sessions — nothing was pruned.
  });

  it('upgrade path: a device previously narrowed to strength recovers conditioning from the server', async () => {
    // Arrange: local db = strength-only (what a partitioned install left on
    // disk); remote = legacy mixed blob with both kinds.
    // Act: reconcile.
    // Assert: both kinds present locally afterward; remote unchanged in kinds.
  });

  it('writes as hybrid:mobile and populates both ecosystem partitions when ecosystem sync is on', async () => {
    // Arrange: enable the ECOSYSTEM_SYNC_ENABLED path the way existing tests
    // do (env flag), spy on the upsert payload.
    // Assert: pushed namespace has partitions.strength AND
    // partitions.conditioning, and writer === 'hybrid:mobile'.
  });

  it('still does not clobber a set logged while the post-pull push is in flight', async () => {
    // Clone the existing in-flight test body, but with IS_MERGED true and a
    // conditioning set logged during the await window. Assert it survives —
    // in merged mode the 5 Aug residual (other-product record authored
    // mid-push pruned before reaching the server) must be GONE, because
    // nothing is pruned at all.
  });
});
```

These skeletons name the behavior; fill bodies by copying the arrange/act/assert mechanics of the two existing partition tests in the same file (`pushes both products unfiltered…`, `does not clobber a set…`) — same fake client, same fixtures, different expectations. The point of writing them first is that all four FAIL against today's partitioned code.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @hybrid/mobile test -- sync`
Expected: the 4 new tests FAIL (device narrowed to one kind; writer is `strength:mobile`); the 3 existing tests still PASS.

- [ ] **Step 3: Implement in `apps/mobile/src/cloud/sync.tsx`**

Four changes, each conditioned on `IS_MERGED`:

```tsx
import { IS_MERGED, PRODUCT_ID } from '../product';
import { buildMergedSyncNamespace } from '@hybrid/engine'; // add to the existing engine import list

// line ~91 — writer identity:
const ECOSYSTEM_WRITER = IS_MERGED ? 'hybrid:mobile' : `${PRODUCT_ID}:mobile`;

// in applyMerged (~line 136) — the fold no longer narrows in merged mode:
const merged0 = sanitizeDB(mergeEngines(draft, next));
const folded = IS_MERGED ? merged0 : restrictToProduct(merged0, PRODUCT_ID);

// in pushNow (~line 176) — namespace covers both partitions in merged mode:
const namespace = IS_MERGED
  ? buildMergedSyncNamespace(source, ECOSYSTEM_WRITER)
  : buildProductSyncNamespace(source, PRODUCT_ID, ECOSYSTEM_WRITER);

// in reconcile (~line 243) — no local narrowing in merged mode:
const local = IS_MERGED ? merged : restrictToProduct(merged, PRODUCT_ID);
```

Then update the two big comments truthfully (spec §4): in `applyMerged`'s comment, add that in merged mode the fold is un-narrowed so nothing is ever pruned; in `reconcile`'s comment, note that the documented residual ("an OTHER-product record authored during the push's await window") **only exists in legacy single-product builds** — in merged mode nothing is pruned, so the residual is gone. Do not delete the legacy explanation; scope it.

- [ ] **Step 4: Run the full mobile suite**

Run: `pnpm --filter @hybrid/mobile test && pnpm run typecheck`
Expected: all PASS — 4 new merged tests, 3 existing (legacy) tests, 127 pre-existing others (the suite is Jest — see Task 3's correction).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/cloud/sync.tsx apps/mobile/test/sync.test.tsx apps/mobile/test/sync-merged.test.tsx apps/mobile/test/syncHarness.tsx
git commit -m "feat(mobile): merged app syncs both kinds, writer hybrid:mobile

Legacy single-product builds keep the partitioned path bit-for-bit for
the conditioning farewell release. In merged mode nothing is pruned, so
the 5 Aug in-flight-push residual no longer exists; comments scoped
accordingly."
```

---

### Task 6: Store scoping by discipline (merged mode only)

Screens see only the active world. Same contract as the web slice had — scoped reads, whole-db writes, foreign live session surfaced.

**Files:**
- Modify: `apps/mobile/src/store/db.tsx`
- Test: `apps/mobile/test/store-discipline.test.ts` (new)

**Interfaces:**
- Consumes: `useDiscipline`, `splitActiveSession` (Task 2); `restrictToProduct` from `@hybrid/engine`; `IS_MERGED` (Task 3).
- Produces: `DbCtx` gains `discipline: ProductId` and `foreignActiveSession: Session | null`; `workouts`/`sessions`/`activeSession` are discipline-scoped **when `IS_MERGED`**, unchanged in legacy builds. `db`, `update`, `updateSession` untouched.

- [ ] **Step 1: Write the failing test** — `apps/mobile/test/store-discipline.test.ts`

Pure-logic test of the derivation (no renderer), mirroring `apps/web/test/discipline.test.ts`'s last block:

```ts
// Jest injects describe/it/expect as globals — no runner import.
import { restrictToProduct, type EngineDB, type Session } from '@hybrid/engine';
import { splitActiveSession } from '../src/discipline';

describe('merged-mode store derivation', () => {
  const db = {
    workouts: [],
    sessions: [
      { id: 's1', kind: 'strength', status: 'active' },
      { id: 'c1', kind: 'conditioning', status: 'completed', completedAt: 1 },
    ],
  } as unknown as EngineDB;

  it('scopes reads without touching the source db', () => {
    const view = restrictToProduct(db, 'conditioning');
    expect(view.sessions.map((s) => s.id)).toEqual(['c1']);
    expect(db.sessions.map((s) => s.id)).toEqual(['s1', 'c1']);
  });

  it('surfaces a foreign live session instead of losing it', () => {
    const live = db.sessions.find((s) => (s as Session).status === 'active') as Session;
    const { activeSession, foreignActiveSession } = splitActiveSession(live, 'conditioning');
    expect(activeSession).toBeNull();
    expect(foreignActiveSession?.id).toBe('s1');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @hybrid/mobile test -- store-discipline` (Jest — no vitest imports)
Expected: FAIL only if Task 2 is incomplete; if it passes immediately, that is fine — the real change is Step 3, and this test pins the contract it must preserve.

- [ ] **Step 3: Implement in `apps/mobile/src/store/db.tsx`**

In the context value memo (around line 203, where `activeSession` is derived):

```tsx
import { restrictToProduct } from '@hybrid/engine'; // add to existing engine import
import { splitActiveSession, useDiscipline } from '../discipline';
import { IS_MERGED } from '../product';
import type { ProductId } from '@hybrid/product-scope';

// inside DbProvider, before the memo:
const discipline = useDiscipline();

// inside the memo:
const live = db.sessions.find((s) => s.status === 'active') || null;
const { activeSession, foreignActiveSession } = IS_MERGED
  ? splitActiveSession(live, discipline)
  : { activeSession: live, foreignActiveSession: null };
const scoped = IS_MERGED ? restrictToProduct(db, discipline) : db;
// …and in the returned object:
//   discipline, activeSession, foreignActiveSession,
//   workouts: scoped.workouts, sessions: scoped.sessions,
// add `discipline` to the memo's dependency array.
```

Extend the `DbCtx` interface with `discipline: ProductId;` and `foreignActiveSession: Session | null;`, with a comment carrying the write rule verbatim: *reads are scoped; `db`, writes, Coordinator and whole-athlete-state stay whole — a filtered view must never become the thing written back or merged (5 Aug C1/C2).*

- [ ] **Step 4: Run the mobile suite + typecheck**

Run: `pnpm --filter @hybrid/mobile test && pnpm run typecheck`
Expected: PASS. Screens compile unchanged — they read `workouts`/`sessions`/`activeSession` from context and now get the scoped view in merged builds.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/store/db.tsx apps/mobile/test/store-discipline.test.ts
git commit -m "feat(mobile): merged builds scope reads to the active discipline"
```

---

### Task 7: Runtime theme + the Settings switch row

The world announces itself through the existing runtime themes; the only new UI is one Settings row.

**Files:**
- Modify: `apps/mobile/src/App.tsx` (ThemeProvider wiring)
- Modify: `apps/mobile/src/screens/Settings.tsx` (switch row)

**Interfaces:**
- Consumes: `useDiscipline`, `setDiscipline` (Task 2); `IS_MERGED` (Task 3); `ThemeProvider` from `@hybrid/design` (`packages/design/src/theme.ts:25`, takes `productId: ProductId`); `resolvePalette` for the destination accent dot; the `Tap` component Settings already uses.
- Produces: merged app themes by active discipline; Settings shows "Switch to Conditioning →" / "Switch to Strength →" with destination accent dot. Legacy builds: no row, theme fixed by `PRODUCT_ID` as today.

- [ ] **Step 1: Re-point the theme in `App.tsx`**

`App.tsx:155` currently reads `<ThemeProvider productId={PRODUCT_ID}>`. `useDiscipline` must be called INSIDE a component. Wrap:

```tsx
import { useDiscipline } from './discipline';
import { IS_MERGED, PRODUCT_ID } from './product';

function ThemedRoot({ children }: { children: React.ReactNode }) {
  const discipline = useDiscipline();
  return (
    <ThemeProvider productId={IS_MERGED ? discipline : PRODUCT_ID}>
      {children}
    </ThemeProvider>
  );
}
```

Replace the `<ThemeProvider productId={PRODUCT_ID}>` usage with `<ThemedRoot>`. The `themeVars` memo at line ~198 already recomputes when the palette changes, so the switch repaints the whole app with no further wiring. Also check `tabBarAccessibilityLabel: PRODUCT.name` (line 115): in merged builds label it by world — `IS_MERGED ? (discipline === 'conditioning' ? 'THE Conditioning System' : 'THE Strength System') : PRODUCT.name` — hoisting `discipline` availability the same way if that code sits outside `ThemedRoot`; if that requires restructuring beyond a few lines, leave the label as `PRODUCT.name` and note it in the commit body as a known cosmetic follow-up.

- [ ] **Step 2: Add the switch row to `Settings.tsx`**

Follow the screen's existing `Tap` row idiom (e.g. line 200's `bg-gold` action row). Place it in its own small section near the top of Settings, gated on `IS_MERGED`:

```tsx
import { setDiscipline, useDiscipline } from '../discipline';
import { IS_MERGED } from '../product';
import { resolvePalette } from '@hybrid/design';

// inside the component:
const discipline = useDiscipline();
const other = discipline === 'strength' ? 'conditioning' : 'strength';
const otherAccent = resolvePalette(other).gold; // each palette's accent slot

// in the JSX, only when IS_MERGED:
{IS_MERGED && (
  <Tap
    box={{ h: 48 }}
    onPress={() => setDiscipline(other)}
    accessibilityLabel={`Switch to ${other === 'conditioning' ? 'Conditioning' : 'Strength'}`}
    className="mt-1.5 flex-row items-center justify-between rounded-md border border-line2 bg-panel2 px-2 py-1.5"
  >
    <Text className="text-text">
      Switch to {other === 'conditioning' ? 'Conditioning' : 'Strength'} →
    </Text>
    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: otherAccent }} />
  </Tap>
)}
```

Match the file's actual `Text`/`View` imports and className conventions (read neighboring rows and copy them — do not introduce new spacing values). No confirmation dialog (Global Constraints). The theme change itself is the arrival feedback.

- [ ] **Step 3: Verify**

Run: `pnpm run typecheck && pnpm --filter @hybrid/mobile test`
Expected: PASS. Then, if the environment allows, `pnpm --filter @hybrid/mobile exec expo export` (or the repo's documented mobile build check from `docs/ANDROID_BUILD.md`) to prove the app bundles.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/App.tsx apps/mobile/src/screens/Settings.tsx
git commit -m "feat(mobile): world switch in Settings; theme follows the active discipline"
```

---

### Task 8: Conditioning farewell content

The legacy conditioning build gets its send-off: a prominent card that force-syncs and points at the merged app. Small, but it gates all cleanup.

**Files:**
- Modify: `apps/mobile/src/screens/Home.tsx`

**Interfaces:**
- Consumes: `IS_MERGED`, `PRODUCT_ID` (Task 3); the sync context's `syncNow`/`busy`/`syncedAt` (whatever `apps/mobile/src/cloud/sync.tsx` exposes — read its provider value and use the real names); Home's existing card components.
- Produces: on `!IS_MERGED && PRODUCT_ID === 'conditioning'` only, a card at the top of Home: title "This app is moving", body "Strength & Conditioning are becoming one app. Sync now to make sure everything is safe, then install the update from the Play Store.", a "Sync now" action wired to the real sync call, and a "Last synced" line from the provider's timestamp.

- [ ] **Step 1: Implement the card**

Gate: `{!IS_MERGED && PRODUCT_ID === 'conditioning' && ( …card… )}` at the top of Home's scroll content, using the same card/`Tap` primitives the screen already uses. Wire "Sync now" to the provider's sync function and disable it while busy, exactly as Settings' existing "Sync now" row does (Settings.tsx line ~376 shows the pattern — copy it).

- [ ] **Step 2: Verify**

Run: `pnpm run typecheck && pnpm --filter @hybrid/mobile test`
Expected: PASS (the card renders only under the legacy-conditioning gate; no test change required, but if Home has render tests, add the gate case there following the file's pattern).

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/screens/Home.tsx
git commit -m "feat(mobile): farewell card for the legacy conditioning build"
```

---

### Task 9: ⛔ GATED — build-profile and config cleanup

**Do NOT execute in the same pass.** Preconditions (spec §5–6): the farewell conditioning release (built from Task 8's code with the `conditioning-production` profile) has SHIPPED, and the user confirms it has had time in the field. Until then the legacy path must keep building.

When the user gives the word:

- [ ] Remove `conditioning-preview` / `conditioning-production` from `apps/mobile/eas.json`.
- [ ] Remove the `isConditioning` branch from `apps/mobile/app.config.js` (name/slug/scheme/package/updates/eas overrides), leaving the merged identity.
- [ ] Update CI workflows that reference per-product mobile builds.
- [ ] Decide whether `IS_MERGED`/legacy branches in `product.ts`, `sync.tsx`, `db.tsx`, `Home.tsx` are then dead code; if so remove them in a dedicated commit with the sync tests re-run.
- [ ] Commit: `chore(mobile): retire the standalone conditioning app`

---

### Task 10: Docs + handoff + full gate

**Files:**
- Modify: `handoff.md` (new checkpoint section), `docs/ANDROID_BUILD.md` (unset-env = merged app), `README.md` (mention the merged app where the two Android apps are described, if they are)

- [ ] **Step 1: Update docs**

`docs/ANDROID_BUILD.md`: wherever it documents `EXPO_PUBLIC_HYBRID_PRODUCT` unset meaning the strength build, state the new meaning (unset = merged app; set = legacy farewell path, scheduled for removal in Task 9). `handoff.md`: add to the 6 Aug checkpoint (or a new dated one): merge implemented through Task 8, Task 9 explicitly gated on the farewell release, real-device checks outstanding if they are.

- [ ] **Step 2: Full verification gate**

Run, from repo root, and read the output of each:

```bash
pnpm run typecheck
pnpm run test
pnpm run check:ecosystem
node checks/docs.mjs
```

Expected: all green. Then the **real-device gate (spec §9) — manual, user-run**: EAS `preview` build → install over an existing strength install → data intact, strength world renders; switch → conditioning world themes correctly; log one session in each world → both sync; sign into a conditioning-account → its data appears. The plan is not "done" until the user reports this pass.

- [ ] **Step 3: Commit**

```bash
git add handoff.md docs/ANDROID_BUILD.md README.md
git commit -m "docs: record the Android merge state and the gated cleanup"
```

---

## Self-review (done at authoring time)

- **Spec coverage:** §1→Tasks 3/9, §2→Tasks 2/6, §3→Task 7, §4→Tasks 4/5, §5→Task 8, §6→Task 9 (gated), §7→Task 1, §9→Task 10. §8 (out of scope) — no task touches those areas.
- **Placeholders:** Task 5 Step 1 gives named skeletons and points at the two existing tests whose mechanics they copy — deliberate, since the harness's fixture helpers must be reused, not re-invented; every other code step is complete.
- **Type consistency:** `IS_MERGED` (Task 3) consumed in 5/6/7/8; `buildMergedSyncNamespace(db, writer, now?)` defined in 4, consumed in 5; discipline exports defined in 2, consumed in 6/7. Names match.
