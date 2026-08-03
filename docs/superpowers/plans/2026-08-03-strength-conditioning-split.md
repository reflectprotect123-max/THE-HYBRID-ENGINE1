# Strength / Conditioning Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every `Workout`/`Session` a stored `kind: 'strength' | 'conditioning'` field, stop inferring it from block contents, and make the "finisher tacked onto a lift day" pattern impossible to author going forward — while splitting any already-existing mixed-block workout/session into two clean siblings on load.

**Architecture:** `Workout`/`Session` gain an optional `kind` field. `isCondWorkout()` is redefined to read it instead of scanning `blocks` (same name, same signature — every existing caller is unaffected). `sanitizeDB` gains a `splitMixedWorkout`/`splitMixedSession` pass that backfills `kind` on old data and splits a mixed-block record into a strength sibling and a new conditioning sibling, idempotently (a no-op once no mixed record remains — no separate migration-version stamp needed, since this repo has no existing migration mechanism to hook into). "Never mixed again" is enforced at the two places a workout is actually authored — the Planner's block-add toolbar and the guided builder's block-type choices — on both platforms. `CondBlock` remains a valid `Block` union member; nothing about `session.ts`'s aggregation functions, History/Recap/Progress, or the Concept2 sync/matching logic changes, because none of those needed to.

**Tech Stack:** TypeScript, React (web) + React Native (mobile), Vitest (engine unit tests), Playwright (`checks/react-smoke.mjs`), Jest + RNTL (mobile component tests). No new dependencies.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-03-strength-conditioning-split-design.md` — read it, including the "Correction — scope narrowed during plan authoring" section at the end, which is the actual scope this plan implements (not the original "Screens affected"/"Scope" sections above it).
- `kind` is optional at the TypeScript level (`kind?: 'strength' | 'conditioning'`) because raw/network data may not have it yet — `sanitizeDB` is what guarantees every workout and session carries it by the time any app code reads `db.workouts`/`db.sessions`.
- `isCondWorkout(w)` keeps its exact name and signature — every existing call site (`Home.tsx`, `Library.tsx`, both platforms) needs zero changes.
- `CondBlock` stays a valid member of the `Block` union. No change to `session.ts`'s aggregation functions (`sessionVolume`, `sessionRpe`, `loggedWorkCount`, `hasLoggedWork`, `detectPRs`, `rpeGapInfo`, `freshSessionBlocks`), to `CondResult`'s storage location, to History/Recap/Progress, or to `concept2.ts`/`concept2.test.ts` — none of it is touched by this plan.
- A conditioning-kind workout may still carry more than one conditioning block (unchanged from today); a strength-kind workout may still carry multiple lift/warmup/metcon blocks (unchanged from today). The only new restriction is that a workout can never carry BOTH a conditioning block and a strength/warmup/metcon block together.
- Every task ends with its own tests passing before commit. Do not move to the next task with a red test.
- Run `pnpm run typecheck` and the relevant `pnpm --filter <pkg> test` after every task, not just at the end.

---

### Task 1: Engine — `kind` field, `isCondWorkout` redefinition, sanitizeDB split/backfill

**Files:**
- Modify: `packages/engine/src/types.ts` (`Workout` interface, `Session` interface)
- Modify: `packages/engine/src/session.ts` (`isCondWorkout`, lines 555-558)
- Modify: `packages/engine/src/db.ts` (`sanitizeDB`, lines 103-121)
- Modify: `packages/engine/test/db.test.ts`

**Interfaces:**
- Produces: `Workout.kind?: 'strength' | 'conditioning'`, `Session.kind?: 'strength' | 'conditioning'`, `isCondWorkout(w: Workout): boolean` (unchanged signature, new implementation) — consumed unchanged by Home.tsx/Library.tsx on both platforms, and directly by Tasks 2-5 (`w.kind`).
- Consumes: `isCond` (already imported in `db.ts` from `./session`), `uid()` (already imported in `db.ts`).

- [ ] **Step 1: Add `kind` to `Workout` and `Session`**

Modify `packages/engine/src/types.ts` — the `Workout` interface (currently lines 154-169):

```ts
export interface Workout<S extends AnySet = LoggedSet> {
  id: string;
  /**
   * 'strength' or 'conditioning' — decided when the first block is authored
   * (Planner's block-add toolbar, the guided builder's block-type choice) or
   * backfilled by `sanitizeDB` for data written before this field existed. A
   * 'strength' workout's blocks may never contain a CondBlock again; see
   * `sanitizeDB`'s splitMixedWorkout for how an already-mixed workout (the old
   * "finisher tacked onto a lift day" pattern) gets split into two siblings
   * on load, once.
   */
  kind?: 'strength' | 'conditioning';
  name?: string;
  blocks: Block<S>[];
  /** recurring weekday slots, 0=Sunday */
  days?: number[];
  /** one-off YYYY-MM-DD dates */
  dates?: string[];
  /** ids of every Folder (Settings.folders) this workout is filed under —
   *  empty or absent means it renders in Library's ungrouped list. A workout
   *  can be in several folders at once. */
  folderIds?: string[];
  updatedAt?: number;
  _rev?: string;
  sample?: boolean;
}
```

And the `Session` interface (currently lines 173-184):

```ts
export interface Session {
  id: string;
  /** Mirrors `Workout.kind` — see its doc comment. Backfilled by `sanitizeDB`
   *  the same way. */
  kind?: 'strength' | 'conditioning';
  /** YYYY-MM-DD */
  date: string;
  name?: string;
  status: SessionStatus;
  blocks: Block<LoggedSet>[];
  startedAt?: number;
  completedAt?: number;
  updatedAt?: number;
  workoutId?: string;
}
```

- [ ] **Step 2: Write the failing sanitizeDB kind/split tests**

Modify `packages/engine/test/db.test.ts` — add `isCondWorkout` to the import from `../src/session` (new import line, right after the existing imports at the top of the file):

```ts
import { isCondWorkout } from '../src/session';
```

Then append two new `describe` blocks at the very end of the file, right after the file's current final `});` (the closing brace of the `pickWorkout unions folderIds like days/dates` describe block):

```ts

describe('sanitizeDB backfills and splits Workout.kind', () => {
  const strengthBlock = () => ({
    id: 'sb1',
    exercises: [{ id: 'e1', name: 'Squat', mode: 'reps_kg', sets: [{ t: '5', rpe: '8' }] }],
  });
  const condBlock = () => ({ id: 'cb1', kind: 'conditioning', condFmt: 'intervals' });

  it('backfills kind=strength on an old workout with only strength blocks', () => {
    const out = sanitizeDB({ workouts: [{ id: 'w1', blocks: [strengthBlock()] }], sessions: [], settings: {} });
    expect(out.workouts).toHaveLength(1);
    expect(out.workouts[0].kind).toBe('strength');
  });

  it('backfills kind=conditioning on an old workout that is all conditioning blocks', () => {
    const out = sanitizeDB({ workouts: [{ id: 'w1', blocks: [condBlock()] }], sessions: [], settings: {} });
    expect(out.workouts).toHaveLength(1);
    expect(out.workouts[0].kind).toBe('conditioning');
  });

  it('backfills kind=strength on a workout with zero blocks — matches the old isCondWorkout guard', () => {
    const out = sanitizeDB({ workouts: [{ id: 'w1', blocks: [] }], sessions: [], settings: {} });
    expect(out.workouts[0].kind).toBe('strength');
  });

  it('splits a mixed workout into a strength sibling (keeps the id) and a new conditioning sibling, same days/dates', () => {
    const out = sanitizeDB({
      workouts: [
        {
          id: 'w1',
          name: 'Leg Day',
          blocks: [strengthBlock(), condBlock()],
          days: [1, 3],
          dates: ['2026-08-10'],
        },
      ],
      sessions: [],
      settings: {},
    });
    expect(out.workouts).toHaveLength(2);
    const strength = out.workouts.find((w) => w.id === 'w1')!;
    const cond = out.workouts.find((w) => w.id !== 'w1')!;
    expect(strength.kind).toBe('strength');
    expect(strength.blocks.map((b) => b.id)).toEqual(['sb1']);
    expect(strength.days).toEqual([1, 3]);
    expect(cond.kind).toBe('conditioning');
    expect(cond.name).toBe('Leg Day — Conditioning');
    expect(cond.blocks.map((b) => b.id)).toEqual(['cb1']);
    expect(cond.days).toEqual([1, 3]);
    expect(cond.dates).toEqual(['2026-08-10']);
  });

  it('splitting is idempotent — running sanitizeDB again on already-split output changes nothing further', () => {
    const once = sanitizeDB({
      workouts: [{ id: 'w1', blocks: [strengthBlock(), condBlock()] }],
      sessions: [],
      settings: {},
    });
    const twice = sanitizeDB(once);
    expect(twice.workouts).toHaveLength(2);
    expect(twice.workouts.map((w) => w.kind).sort()).toEqual(['conditioning', 'strength']);
  });
});

describe('sanitizeDB backfills and splits Session.kind', () => {
  const strengthBlock = () => ({
    id: 'sb1',
    exercises: [{ id: 'e1', name: 'Squat', mode: 'reps_kg', sets: [{ t: '5', rpe: '8' }] }],
  });
  const condBlock = () => ({ id: 'cb1', kind: 'conditioning', condFmt: 'intervals' });

  it('splits a mixed session the same way, preserving status', () => {
    const out = sanitizeDB({
      workouts: [],
      sessions: [{ id: 's1', date: '2026-08-10', status: 'completed', blocks: [strengthBlock(), condBlock()] }],
      settings: {},
    });
    expect(out.sessions).toHaveLength(2);
    const strength = out.sessions.find((s) => s.id === 's1')!;
    const cond = out.sessions.find((s) => s.id !== 's1')!;
    expect(strength.kind).toBe('strength');
    expect(strength.status).toBe('completed');
    expect(cond.kind).toBe('conditioning');
    expect(cond.status).toBe('completed');
  });
});

describe('isCondWorkout reads the stored kind, not block contents', () => {
  it('is true for kind: conditioning regardless of blocks', () => {
    expect(isCondWorkout({ id: 'w1', kind: 'conditioning', blocks: [] })).toBe(true);
  });

  it('is false for kind: strength even if every block happens to be conditioning-shaped', () => {
    expect(
      isCondWorkout({
        id: 'w1',
        kind: 'strength',
        blocks: [{ id: 'b1', kind: 'conditioning', condFmt: 'intervals' } as never],
      }),
    ).toBe(false);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @hybrid/engine test -- db.test.ts`
Expected: FAIL — `out.workouts[0].kind` is `undefined` (sanitizeDB does not set `kind` yet), and the mixed-workout tests fail because sanitizeDB returns 1 workout, not 2.

- [ ] **Step 4: Redefine `isCondWorkout`**

Modify `packages/engine/src/session.ts`, replacing the current body (lines 555-558):

```ts
/** Whether this workout is a conditioning-kind workout — a stored field
 *  (`Workout.kind`), not scanned from block contents. `sanitizeDB` guarantees
 *  every workout carries `kind` by the time any app code reads it. */
export function isCondWorkout(w: Workout): boolean {
  return w.kind === 'conditioning';
}
```

- [ ] **Step 5: Implement `splitMixedWorkout`/`splitMixedSession` in sanitizeDB**

Modify `packages/engine/src/db.ts` — add the two helpers as nested functions inside `sanitizeDB`, right after the `cleanSettings` function definition (immediately before the `return {` statement that currently starts the function's return value, i.e. right before what is currently line 103 `return {`):

```ts
  /**
   * A workout mixing a conditioning block with strength/text blocks (the old
   * "finisher tacked onto a lift day" pattern) is split into a strength
   * sibling and a NEW conditioning sibling — once, here, rather than carrying
   * an inferred mix forever. A workout already single-kind just gets `kind`
   * backfilled. This runs on every load (same as the rest of sanitizeDB) but
   * is idempotent: a workout that is already split, or was never mixed, comes
   * back unchanged — no separate migration-version stamp is needed.
   */
  const splitMixedWorkout = (w: Workout): Workout[] => {
    const condBlocks = w.blocks.filter(isCond);
    const otherBlocks = w.blocks.filter((b) => !isCond(b));
    if (!condBlocks.length) return [{ ...w, kind: 'strength' }];
    if (!otherBlocks.length) return [{ ...w, kind: 'conditioning' }];
    return [
      { ...w, kind: 'strength', blocks: otherBlocks },
      {
        ...w,
        id: uid(),
        kind: 'conditioning',
        name: `${w.name || 'Session'} — Conditioning`,
        blocks: condBlocks,
        updatedAt: Date.now(),
      },
    ];
  };

  /** Same reasoning as `splitMixedWorkout`, for a logged Session instead of a
   *  Workout template. */
  const splitMixedSession = (s: Session): Session[] => {
    const condBlocks = s.blocks.filter(isCond);
    const otherBlocks = s.blocks.filter((b) => !isCond(b));
    if (!condBlocks.length) return [{ ...s, kind: 'strength' }];
    if (!otherBlocks.length) return [{ ...s, kind: 'conditioning' }];
    return [
      { ...s, kind: 'strength', blocks: otherBlocks },
      { ...s, id: uid(), kind: 'conditioning', blocks: condBlocks, updatedAt: Date.now() },
    ];
  };

```

Then modify the `return { workouts: ..., sessions: ..., settings: ... }` block (currently lines 103-121) — change both `.map` calls to `.flatMap`, and route each element through the new split helper instead of returning it directly:

```ts
  return {
    workouts: arr<unknown>(src.workouts).flatMap((w0) => {
      const w = (w0 && typeof w0 === 'object' ? w0 : {}) as Workout;
      w.blocks = cleanBlocks(w.blocks);
      if (!w.id) w.id = uid();
      if ('days' in w) w.days = arr<number>(w.days).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
      if ('dates' in w) w.dates = arr<string>(w.dates).filter((k) => typeof k === 'string');
      if ('folderIds' in w) w.folderIds = arr<string>(w.folderIds).filter((id) => typeof id === 'string' && id);
      return splitMixedWorkout(w);
    }),
    sessions: arr<unknown>(src.sessions).flatMap((s0) => {
      const s = (s0 && typeof s0 === 'object' ? s0 : {}) as Session;
      s.blocks = cleanBlocks(s.blocks);
      if (!s.id) s.id = uid();
      return splitMixedSession(s);
    }),
    settings: cleanSettings(src.settings),
  };
```

- [ ] **Step 6: Run it to verify it passes**

Run: `pnpm --filter @hybrid/engine test -- db.test.ts`
Expected: PASS, all new tests, plus every pre-existing test in the file unchanged.

- [ ] **Step 7: Run the full engine suite and typecheck**

Run: `pnpm --filter @hybrid/engine test && pnpm --filter @hybrid/engine typecheck`
Expected: every pre-existing engine test still passes — `session.test.ts`, `conditioning.test.ts`, `balance.test.ts`, `warmupblock.test.ts`, `concept2.test.ts`, `rpegap.test.ts`, `emit.test.ts`, `golden.test.ts`, `restore.test.ts` all construct `Session`/`Workout` objects directly in memory (never through `sanitizeDB`) and never call `isCondWorkout`, so none of them are affected by this task's changes — `CondBlock` is still a valid `Block` member and every aggregation function is untouched.

- [ ] **Step 8: Commit**

```bash
git add packages/engine/src/types.ts packages/engine/src/session.ts packages/engine/src/db.ts packages/engine/test/db.test.ts
git commit -m "Add Workout/Session.kind, redefine isCondWorkout, split mixed workouts/sessions in sanitizeDB"
```

---

### Task 2: Web Planner — mutually-exclusive block-add toolbar

**Files:**
- Modify: `apps/web/src/screens/Planner.tsx`
- Modify: `checks/react-smoke.mjs`

**Interfaces:**
- Consumes: `w.kind` (Task 1) — guaranteed set by the time Planner renders (either backfilled by `sanitizeDB` on load, or set by the guided builder on its first block commit — Task 4 — since Planner is only ever reached after a workout already has at least one block).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing toolbar-guard smoke test**

Add to `checks/react-smoke.mjs`, in the Planner-related test section (near the existing Planner tests):

```js
await t("the Planner's block-add toolbar only offers kinds compatible with the workout's own kind", async () => {
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
    db.workouts.push(
      {
        id: 'toolbar-strength-1',
        name: 'Strength Toolbar Test',
        kind: 'strength',
        updatedAt: 1,
        blocks: [
          {
            id: 'b1',
            exercises: [{ id: 'e1', name: 'Squat', mode: 'reps_kg', sets: [{ t: '5', rpe: '8' }] }],
          },
        ],
      },
      {
        id: 'toolbar-cond-1',
        name: 'Conditioning Toolbar Test',
        kind: 'conditioning',
        updatedAt: 1,
        blocks: [{ id: 'cb1', kind: 'conditioning', condFmt: 'intervals' }],
      },
    );
    localStorage.setItem('hybrid-engine-v1', JSON.stringify(db));
  });

  await page.goto(base + '/planner/toolbar-strength-1', { waitUntil: 'networkidle' });
  let txt = await page.textContent('body');
  assert(/＋ Block/.test(txt), 'a strength workout should still offer + Block');
  assert(
    !/♥ Conditioning/.test(txt),
    'a strength workout must not offer + Conditioning — that is the finisher pattern being removed',
  );

  await page.goto(base + '/planner/toolbar-cond-1', { waitUntil: 'networkidle' });
  txt = await page.textContent('body');
  assert(/♥ Conditioning/.test(txt), 'a conditioning workout should offer + Conditioning');
  assert(
    !/＋ Block/.test(txt),
    'a conditioning workout must not offer strength/warm-up/metcon block buttons',
  );
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm run smoke`
Expected: FAIL — today's toolbar always renders all four buttons regardless of the workout's contents.

- [ ] **Step 3: Implement the toolbar guard**

Modify `apps/web/src/screens/Planner.tsx` — replace the block-add toolbar (currently lines 288-295):

```tsx
    <div className="mt-2 flex flex-wrap gap-1">
      {w.kind !== 'conditioning' ? (
        <>
          <Button onClick={() => edit((d) => void d.blocks.push(newBlock() as never))}>＋ Block</Button>
          <Button onClick={() => edit((d) => void d.blocks.push(newWarmupBlock() as never))}>
            ☀ Warm-up / Cooldown
          </Button>
          <Button onClick={() => edit((d) => void d.blocks.push(newTextBlock()))}>✎ Metcon / notes</Button>
        </>
      ) : (
        <Button onClick={() => edit((d) => void d.blocks.push(newCondBlock()))}>♥ Conditioning</Button>
      )}
    </div>
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm run typecheck && pnpm run smoke`
Expected: PASS — the new test, plus every pre-existing Planner smoke test unchanged (none of them exercise a workout whose `kind` would flip which buttons show, since every existing seeded workout in those tests is strength-shaped and none currently mixes in a `CondBlock` — confirmed via the blast-radius research for this plan).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/screens/Planner.tsx checks/react-smoke.mjs
git commit -m "Guard web Planner's block-add toolbar by workout kind"
```

---

### Task 3: Mobile Planner — mutually-exclusive block-add toolbar

**Files:**
- Modify: `apps/mobile/src/screens/Planner.tsx`
- Modify: `apps/mobile/test/screens.test.tsx`

**Interfaces:**
- Consumes: `w.kind` (Task 1), mirrors Task 2 exactly on mobile.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing toolbar-guard test**

Add to `apps/mobile/test/screens.test.tsx` a new import line right after the existing `import { HomeScreen } from '../src/screens/Home';` line (line 21) — this is the first test in this file to render `PlannerScreen` directly, no existing test does (confirmed via search):

```tsx
import { PlannerScreen } from '../src/screens/Planner';
```

Then append a new `describe` block anywhere in the file (after the existing imports and describe blocks):

```tsx
describe('Planner toolbar kind guard', () => {
  it('hides + Conditioning for a strength workout', () => {
    seed({
      workouts: [
        {
          id: 'toolbar-strength-1',
          name: 'Strength Toolbar Test',
          kind: 'strength',
          updatedAt: 1,
          blocks: [
            { id: 'b1', exercises: [{ id: 'e1', name: 'Squat', mode: 'reps_kg', sets: [{ t: '5', rpe: '8' }] }] },
          ],
        },
      ],
    });
    renderScreen(<PlannerScreen />, { id: 'toolbar-strength-1' });
    expect(screen.getByText('＋ Block')).toBeTruthy();
    expect(screen.queryByText('♥ Conditioning')).toBeNull();
  });

  it('shows only + Conditioning for a conditioning workout', () => {
    seed({
      workouts: [
        {
          id: 'toolbar-cond-1',
          name: 'Conditioning Toolbar Test',
          kind: 'conditioning',
          updatedAt: 1,
          blocks: [{ id: 'cb1', kind: 'conditioning', condFmt: 'intervals' }],
        },
      ],
    });
    renderScreen(<PlannerScreen />, { id: 'toolbar-cond-1' });
    expect(screen.getByText('♥ Conditioning')).toBeTruthy();
    expect(screen.queryByText('＋ Block')).toBeNull();
  });
});
```

(Add the `PlannerScreen` import alongside this file's other screen imports at the top if not already present — check first, since other describe blocks in this file may already import screens from neighboring paths.)

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @hybrid/mobile test -- screens.test.tsx`
Expected: FAIL — today's toolbar always renders all four buttons.

- [ ] **Step 3: Implement the toolbar guard**

Modify `apps/mobile/src/screens/Planner.tsx` — replace the block-add toolbar (currently lines 233-246):

```tsx
      <View className="mt-2 flex-row flex-wrap gap-1">
        {w.kind !== 'conditioning' ? (
          <>
            <Btn className="min-w-[48%]" onPress={() => edit((d) => void d.blocks.push(newBlock() as never))}>
              ＋ Block
            </Btn>
            <Btn className="min-w-[48%]" onPress={() => edit((d) => void d.blocks.push(newWarmupBlock() as never))}>
              ☀ Warm-up / Cooldown
            </Btn>
            <Btn className="min-w-[48%]" onPress={() => edit((d) => void d.blocks.push(newTextBlock()))}>
              ✎ Metcon / notes
            </Btn>
          </>
        ) : (
          <Btn className="min-w-[48%]" onPress={() => edit((d) => void d.blocks.push(newCondBlock()))}>
            ♥ Conditioning
          </Btn>
        )}
      </View>
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @hybrid/mobile test -- screens.test.tsx`
Expected: PASS — both new tests, plus every pre-existing test in the file unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/screens/Planner.tsx apps/mobile/test/screens.test.tsx
git commit -m "Guard mobile Planner's block-add toolbar by workout kind"
```

---

### Task 4: Web guided builder — restrict block-type choices to the workout's kind

**Files:**
- Modify: `apps/web/src/screens/guided/BlockTypeStep.tsx`
- Modify: `apps/web/src/screens/guided/GuidedBuilder.tsx`
- Modify: `checks/react-smoke.mjs`

**Interfaces:**
- Consumes: `BlockKind` type from `@hybrid/guided-flow` (unchanged).
- Produces: `BlockTypeStep`'s new optional `allowed` prop, consumed only within this file's own `GuidedBuilder.tsx` (no other task depends on it).

- [ ] **Step 1: Write the failing guided-builder smoke test**

Add to `checks/react-smoke.mjs`, near the other guided-builder tests:

```js
await t('the guided builder excludes Conditioning from block-type choices once a strength block exists', async () => {
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
    db.workouts.push({ id: 'guided-kind-1', name: 'Guided Kind Test', blocks: [], updatedAt: 1 });
    localStorage.setItem('hybrid-engine-v1', JSON.stringify(db));
  });
  await page.goto(base + '/build/guided-kind-1', { waitUntil: 'networkidle' });

  let txt = await page.textContent('body');
  assert(/Conditioning/.test(txt) && /Lift/.test(txt), 'the first block of a brand-new workout should offer every kind');

  await page.click('button:has-text("Lift")');
  await page.fill('input[aria-label="movement name"]', 'Back Squat');
  await page.click('button:has-text("Next")');
  await page.click('button:has-text("Next")'); // sets step — default of 3 is fine
  await page.click('button:has-text("5")'); // reps preset chip
  await page.click('button:has-text("Next")');
  await page.click('button:has-text("RPE 8")');
  await page.click('button:has-text("Next")');

  await page.waitForSelector('text=Add another block?');
  await page.click('button:has-text("Yes, add another")');

  txt = await page.textContent('body');
  assert(/Lift/.test(txt) && /Warm-up/.test(txt), 'lift and warm-up should remain offered for a strength workout');
  assert(!/Conditioning/.test(txt), 'conditioning must not be offered once a strength block already exists in this workout');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm run smoke`
Expected: FAIL — today `BlockTypeStep` always shows all four choices regardless of what has already been added.

- [ ] **Step 3: Add the `allowed` prop to `BlockTypeStep`**

Modify `apps/web/src/screens/guided/BlockTypeStep.tsx` — replace the component signature and choice-rendering:

```tsx
export function BlockTypeStep({
  onPick,
  onBack,
  allowed,
}: {
  onPick: (kind: Exclude<BlockKind, null>) => void;
  onBack: () => void;
  /** Restrict which choices render — used from the second block onward in a
   *  workout that has already committed to a kind (a strength workout's
   *  guided flow never offers 'cond' again, and a conditioning workout's flow
   *  never offers 'lift'/'warmup'/'metcon'). Undefined — the first block of a
   *  brand-new workout — shows all four. */
  allowed?: Exclude<BlockKind, null>[];
}) {
  const choices = allowed ? CHOICES.filter((c) => allowed.includes(c.kind)) : CHOICES;
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-2 p-3">
      <h1 className="text-8 font-[800]">What are we doing?</h1>
      <div className="grid grid-cols-2 gap-1.5">
        {choices.map((c) => (
          <Button
            key={c.kind}
            variant="brass"
            size="lg"
            className="flex-col gap-0.5 !h-9 !w-[9.5rem]"
            onClick={() => onPick(c.kind)}
          >
            <span aria-hidden className="text-8">{c.glyph}</span>
            <span>{c.label}</span>
          </Button>
        ))}
      </div>
      <Button className="mt-1" onClick={onBack} aria-label="cancel and go back to the library">
        ‹ Cancel
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Compute `allowedKinds` and pass them through in `GuidedBuilder`**

Modify `apps/web/src/screens/guided/GuidedBuilder.tsx` — add, right after the existing `const known = useMemo(...)` line (currently line 72):

```ts
  const currentWorkout = db.workouts.find((x) => x.id === id);
  const allowedKinds: Exclude<BlockKind, null>[] | undefined =
    currentWorkout?.kind === 'conditioning'
      ? ['cond']
      : currentWorkout?.kind === 'strength'
        ? ['lift', 'warmup', 'metcon']
        : undefined;
```

Modify the `renderStep` function's `block-type` branch (currently line 241):

```tsx
    if (step === 'block-type') return <BlockTypeStep onPick={pick} onBack={goBack} allowed={allowedKinds} />;
```

Modify `commitBlock` (currently lines 167-208) to set `w.kind` on the first block committed — add one line right after `if (!w) return false;` (currently line 173):

```ts
    update((d) => {
      const w = d.workouts.find((x) => x.id === id);
      if (!w) return false;
      if (!w.kind) w.kind = kind === 'cond' ? 'conditioning' : 'strength';
      if (kind === 'lift') {
```

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm run typecheck && pnpm run smoke`
Expected: PASS — the new test, plus every pre-existing guided-builder smoke test unchanged (none of them add more than one block, so `allowedKinds` being `undefined` on their first-and-only `block-type` screen is unaffected).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/screens/guided/BlockTypeStep.tsx apps/web/src/screens/guided/GuidedBuilder.tsx checks/react-smoke.mjs
git commit -m "Restrict web guided builder's block-type choices to the workout's own kind"
```

---

### Task 5: Mobile guided builder — restrict block-type choices to the workout's kind

**Files:**
- Modify: `apps/mobile/src/screens/guided/BlockTypeStep.tsx`
- Modify: `apps/mobile/src/screens/guided/GuidedBuilder.tsx`
- Modify: `apps/mobile/test/guidedBuilder.test.tsx`

**Interfaces:**
- Mirrors Task 4 exactly on mobile.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing guided-builder test**

Add to `apps/mobile/test/guidedBuilder.test.tsx`, in the `describe('GuidedBuilderScreen', ...)` block, following this file's own established pattern (`newWorkout()`, `seed`, `renderScreen`):

```tsx
  it('excludes Conditioning from block-type choices once a strength block exists', () => {
    seed({ workouts: [newWorkout()] });
    renderScreen(<GuidedBuilderScreen />, { id: 'w1' });

    expect(screen.getByText('♥ Conditioning')).toBeTruthy();

    fireEvent.press(screen.getByText('🏋 Lift'));
    fireEvent.changeText(screen.getByLabelText('movement name'), 'Back Squat');
    fireEvent.press(screen.getByText('Next'));
    fireEvent.press(screen.getByText('Next'));
    fireEvent.press(screen.getByText('8'));
    fireEvent.press(screen.getByText('Next'));
    fireEvent.press(screen.getByText('RPE 8'));
    fireEvent.press(screen.getByText('Next'));

    expect(screen.getByText('Yes, add another')).toBeTruthy();
    fireEvent.press(screen.getByText('Yes, add another'));

    expect(screen.getByText('☀ Warm-up / Cooldown')).toBeTruthy();
    expect(screen.queryByText('♥ Conditioning')).toBeNull();
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @hybrid/mobile test -- guidedBuilder.test.tsx`
Expected: FAIL — today `BlockTypeStep` always shows all four choices.

- [ ] **Step 3: Add the `allowed` prop to mobile's `BlockTypeStep`**

Modify `apps/mobile/src/screens/guided/BlockTypeStep.tsx` — replace the component signature and choice-rendering:

```tsx
export function BlockTypeStep({
  onPick,
  onBack,
  allowed,
}: {
  onPick: (kind: Exclude<BlockKind, null>) => void;
  onBack: () => void;
  /** Restrict which choices render — used from the second block onward in a
   *  workout that has already committed to a kind. Undefined shows all four. */
  allowed?: Exclude<BlockKind, null>[];
}) {
  const choices = allowed ? CHOICES.filter((c) => allowed.includes(c.kind)) : CHOICES;
  return (
    <View className="flex-1 items-center justify-center gap-3 p-4">
      <Title>What are we doing?</Title>
      <View className="flex-row flex-wrap justify-center gap-2">
        {choices.map((c) => (
          <Btn key={c.kind} variant="brass" size="lg" onPress={() => onPick(c.kind)} label={c.label}>
            {c.glyph + ' ' + c.label}
          </Btn>
        ))}
      </View>
      <Btn className="mt-2" onPress={onBack} label="cancel and go back to the library">
        ‹ Cancel
      </Btn>
    </View>
  );
}
```

- [ ] **Step 4: Compute `allowedKinds` and pass them through in mobile's `GuidedBuilder`**

Modify `apps/mobile/src/screens/guided/GuidedBuilder.tsx` — add, right after the existing `const known = useMemo(...)` line (currently line 59):

```ts
  const currentWorkout = db.workouts.find((x) => x.id === params.id);
  const allowedKinds: Exclude<BlockKind, null>[] | undefined =
    currentWorkout?.kind === 'conditioning'
      ? ['cond']
      : currentWorkout?.kind === 'strength'
        ? ['lift', 'warmup', 'metcon']
        : undefined;
```

Modify the `renderStep` function's `block-type` branch (currently line 196):

```tsx
    if (step === 'block-type') return <BlockTypeStep onPick={pick} onBack={goBack} allowed={allowedKinds} />;
```

Modify `commitBlock` (currently lines 96-138) to set `w.kind` on the first block committed — add one line right after `if (!w) return false;` (currently line 102):

```ts
    update((d) => {
      const w = d.workouts.find((x) => x.id === params.id);
      if (!w) return false;
      if (!w.kind) w.kind = kind === 'cond' ? 'conditioning' : 'strength';
      if (kind === 'lift') {
```

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm --filter @hybrid/mobile test -- guidedBuilder.test.tsx`
Expected: PASS — the new test, plus every pre-existing test in the file unchanged.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/screens/guided/BlockTypeStep.tsx apps/mobile/src/screens/guided/GuidedBuilder.tsx apps/mobile/test/guidedBuilder.test.tsx
git commit -m "Restrict mobile guided builder's block-type choices to the workout's own kind"
```

---

### Task 6: Full verification and push

**Files:** none (verification only)

**Interfaces:** none

- [ ] **Step 1: Run the whole verify pipeline**

Run: `pnpm run verify`
Expected: PASS — `typecheck`, `test` (engine + web + mobile, including every test added in Tasks 1-5), `build:site`, `check:csp`, `smoke` (including every scenario added in Tasks 2 and 4), `smoke:deploy`.

- [ ] **Step 2: Fix any failure found**

Read the actual error output before changing code. Likely candidates given this plan's shape: a button-text selector mismatch between a smoke test and the real rendered text (web's `＋`/`♥`/`☀` characters must match exactly — copy them from the source file rather than retyping), or the mobile `PlannerScreen`/`BlockTypeStep` import path being slightly different from what Tasks 3/5 assumed (verify the real import path in the file being edited before assuming the plan's guess).

- [ ] **Step 3: Push**

```bash
git push -u origin main
```
