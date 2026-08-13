# Session Authoring Package — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@hybrid/session-authoring` — the headless engine that runs a training session — so that `apps/web`, `apps/mobile` and the coach bench can each render their own screens on one shared brain.

**Architecture:** A pure core plus a thin React hook. Every decision (which set is live, what order a superset's pair runs in, what a draft becomes when logged) is a pure function over `Session` + `RunState`, tested exhaustively without React. `useSession` is glue: it holds the two values in state and re-derives the view. The coaching rule is NOT re-implemented here — the view calls `foldFromExercise` from `@hybrid/engine`, which slice 1 made the single owner.

**Tech Stack:** TypeScript 5.9, Vitest 3.2, React 19 (peer dependency), pnpm workspaces.

This is slice 2 of `docs/superpowers/specs/2026-08-12-round-major-logger-design.md`.

## Global Constraints

- The package must not import, or transitively resolve to, `react-dom` or `react-native`. `react` is a **peerDependency**, exactly as `packages/design/package.json` declares it.
- Tests are colocated: `src/x.ts` is tested by `src/x.test.ts`, same directory. No `*.test.ts` under `test/`.
- No placeholders in shipped code — no `TODO`, no stub, no mock data.
- The coaching rule is not re-implemented. Any weight the package reports comes from `foldFromExercise`. If a task's diff contains rep-to-failure or RPE arithmetic, it is wrong.
- All state transitions are pure and immutable: a reducer returns new `Session`/`RunState` objects and never mutates its arguments. A test asserting the input was not mutated is required wherever a reducer touches nested data.
- **Run the FULL suite at every task gate**, not a scoped one: `pnpm run typecheck` and `pnpm run test`. Slice 1 lost three tasks' worth of confidence to a scoped gate that hid two failures.
- Known pre-existing red, not to be fixed here: `apps/web/src/screens/StartFreshCard.test.tsx` fails 3 tests, reproduced at commit `0e464f7` before any of this work. Any OTHER failure is yours.

## Two corrections to the spec, established before planning

**Prep pieces need no new storage.** Spec constraint 5 calls for "a piece list on prep blocks — name plus seconds or reps". Checking `packages/engine/src/types.ts`, that shape already exists: a prep block is `StrengthBlock { warmup: true, exercises: [...] }`, and a piece is an `Exercise` whose `mode` is `'seconds'` or `'reps'` — both already in `ModeKey`. "90 s cardio of choice" is `{ name: 'Cardio of choice', mode: 'seconds', sets: [{ t: '90', rpe: '' }] }`. No field is added, and none should be.

**Superset round order does need a new field.** The engine models pairing with `block.superset` and the per-exercise `ex.ssNext` link. Neither records which movement LED a given round, which slice 1's spec requires to be history rather than preference. One optional field is added in Task 1.

---

### Task 1: Package scaffold, and the one new storage field

**Files:**
- Create: `packages/session-authoring/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`
- Modify: `packages/engine/src/types.ts` — add `roundOrder` to `StrengthBlock`
- Test: `packages/session-authoring/src/index.test.ts`

**Interfaces:**
- Consumes: `@hybrid/engine`'s `Session`, `Block`, `StrengthBlock`, `Exercise`, `LoggedSet`.
- Produces: the workspace package `@hybrid/session-authoring`, and `StrengthBlock.roundOrder?: Record<number, number[]>`.

- [ ] **Step 1: Create the package files**

`packages/session-authoring/package.json` — mirrors `packages/design/package.json`'s React handling exactly:

```json
{
  "name": "@hybrid/session-authoring",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "build": "tsc -p tsconfig.json --noEmit",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@hybrid/engine": "workspace:*"
  },
  "peerDependencies": {
    "react": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.2.0",
    "react": "19.1.0",
    "typescript": "^5.9.3",
    "vitest": "^3.2.4"
  }
}
```

`packages/session-authoring/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": ".",
    "types": ["vitest/globals"],
    "jsx": "react-jsx",
    "declaration": false,
    "declarationMap": false
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"]
}
```

`packages/session-authoring/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
```

`packages/session-authoring/src/index.ts`:

```ts
/**
 * The headless engine for running a training session.
 *
 * `apps/web` is React DOM and `apps/mobile` is React Native, so no screen can be
 * shared between them — a `<div>` does not render on Android. What both already
 * depend on is `react` itself, and a hook contains no JSX and touches no DOM.
 * So the shared thing is a hook, and each app renders its own body on it.
 *
 * Everything here is pure except `useSession`, which is glue. Nothing here
 * decides what a set should weigh: that is `@hybrid/engine`'s `foldExercise`,
 * the single owner of the coaching rule, and this package calls it.
 */
export const SESSION_AUTHORING_VERSION = '1.0.0';
```

- [ ] **Step 2: Add the field to the engine's block type**

In `packages/engine/src/types.ts`, inside `StrengthBlock`, after `superset?: boolean;`:

```ts
  /**
   * Which movement led each round, by round index, as indices into `exercises`.
   *
   * A superset's pair order is a fact about each ROUND, not about the block.
   * Reordering the pair mid-session must not rewrite what already happened, so a
   * round that has begun keeps the order it ran in and only unstarted rounds
   * move. Absent means "the order `exercises` is in", which is every session
   * logged before the athlete reordered anything.
   */
  roundOrder?: Record<number, number[]>;
```

- [ ] **Step 3: Write the test**

`packages/session-authoring/src/index.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SESSION_AUTHORING_VERSION } from './index';

describe('@hybrid/session-authoring', () => {
  it('is wired into the workspace', () => {
    expect(SESSION_AUTHORING_VERSION).toBe('1.0.0');
  });

  it('declares react as a peer, never a dependency — the apps own their renderer', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(pkg.peerDependencies.react).toBeDefined();
    expect(pkg.dependencies.react).toBeUndefined();
  });

  it('depends on nothing that resolves to a renderer', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const names = Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies });
    expect(names).not.toContain('react-dom');
    expect(names).not.toContain('react-native');
  });
});
```

- [ ] **Step 4: Install and verify**

Run: `pnpm install`
Run: `pnpm --filter @hybrid/session-authoring test`
Run: `pnpm run typecheck && pnpm run test`
Expected: new package green; every other project unchanged and green apart from the 3 known `StartFreshCard` failures.

- [ ] **Step 5: Commit**

```bash
git add packages/session-authoring packages/engine/src/types.ts pnpm-lock.yaml
git commit -m "Add @hybrid/session-authoring, and record which movement led a round"
```

---

### Task 2: The round queue

Which set is live, and in what order, across a superset's interleaved rounds. This is the spine every other task hangs off.

A superset of A (4 sets) and B (3 sets) runs A1 B1 A2 B2 A3 B3 A4 — round-major, and the exercise that runs out drops away rather than shifting everything up.

**Files:**
- Create: `packages/session-authoring/src/queue.ts`
- Test: `packages/session-authoring/src/queue.test.ts`

**Interfaces:**
- Consumes: `StrengthBlock`, `Exercise`, `LoggedSet` from `@hybrid/engine`; `isWarmup` from `@hybrid/engine`.
- Produces: `orderFor(block, round): number[]`, `blockQueue(block): QueueItem[]`, `nextUp(block): QueueItem | null`, `roundCount(block): number`, and `interface QueueItem { exerciseIndex: number; setIndex: number }`.

- [ ] **Step 1: Write the failing test**

`packages/session-authoring/src/queue.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { StrengthBlock, LoggedSet } from '@hybrid/engine';
import { orderFor, blockQueue, nextUp, roundCount } from './queue';

const set = (t: string, done = false): LoggedSet =>
  done ? { t, rpe: '8', aVal: '60', aVal2: t, felt: '8', done: true } : { t, rpe: '8' };

const block = (sets: LoggedSet[][], over: Partial<StrengthBlock<LoggedSet>> = {}): StrengthBlock<LoggedSet> => ({
  id: 'b1',
  superset: sets.length > 1,
  exercises: sets.map((s, i) => ({ id: `e${i}`, name: `Move ${i}`, mode: 'reps_kg', sets: s })),
  ...over,
});

describe('roundCount', () => {
  it('is the longest exercise in the block', () => {
    expect(roundCount(block([[set('8'), set('8')], [set('8')]]))).toBe(2);
  });
});

describe('orderFor', () => {
  it('is the order the exercises are stored in, by default', () => {
    expect(orderFor(block([[set('8')], [set('8')]]), 0)).toEqual([0, 1]);
  });

  it('honours a recorded order for that round', () => {
    const b = block([[set('8')], [set('8')]], { roundOrder: { 0: [1, 0] } });
    expect(orderFor(b, 0)).toEqual([1, 0]);
    expect(orderFor(b, 1)).toEqual([0, 1]);
  });
});

describe('blockQueue', () => {
  it('runs a superset round-major, not exercise-major', () => {
    const q = blockQueue(block([[set('8'), set('8')], [set('8'), set('8')]]));
    expect(q).toEqual([
      { exerciseIndex: 0, setIndex: 0 },
      { exerciseIndex: 1, setIndex: 0 },
      { exerciseIndex: 0, setIndex: 1 },
      { exerciseIndex: 1, setIndex: 1 },
    ]);
  });

  it('drops the exercise that runs out, rather than shifting the rest up', () => {
    const q = blockQueue(block([[set('8'), set('8')], [set('8')]]));
    expect(q).toEqual([
      { exerciseIndex: 0, setIndex: 0 },
      { exerciseIndex: 1, setIndex: 0 },
      { exerciseIndex: 0, setIndex: 1 },
    ]);
  });

  it('follows a rotated round', () => {
    const b = block([[set('8')], [set('8')]], { roundOrder: { 0: [1, 0] } });
    expect(blockQueue(b)).toEqual([
      { exerciseIndex: 1, setIndex: 0 },
      { exerciseIndex: 0, setIndex: 0 },
    ]);
  });

  it('skips warm-up sets — they are performed, but they are not the working queue', () => {
    const q = blockQueue(block([[set('W10'), set('8')]]));
    expect(q).toEqual([{ exerciseIndex: 0, setIndex: 1 }]);
  });
});

describe('nextUp', () => {
  it('is the first set not yet done', () => {
    expect(nextUp(block([[set('8', true), set('8')]]))).toEqual({ exerciseIndex: 0, setIndex: 1 });
  });

  it('is null once the block is finished', () => {
    expect(nextUp(block([[set('8', true)]]))).toBeNull();
  });

  it('returns to a gap left behind, rather than running past it', () => {
    // set 1 skipped, set 2 done: the queue still owes set 1
    expect(nextUp(block([[set('8'), set('8', true)]]))).toEqual({ exerciseIndex: 0, setIndex: 0 });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @hybrid/session-authoring exec vitest run src/queue.test.ts`
Expected: FAIL — `Failed to resolve import "./queue"`.

- [ ] **Step 3: Implement**

`packages/session-authoring/src/queue.ts`:

```ts
import { isWarmup, type Exercise, type LoggedSet, type StrengthBlock } from '@hybrid/engine';

/** One working set's address inside a block. */
export interface QueueItem {
  exerciseIndex: number;
  setIndex: number;
}

/** How many rounds the block has: the longest exercise decides. */
export function roundCount(block: StrengthBlock<LoggedSet>): number {
  return block.exercises.reduce((n, ex) => Math.max(n, ex.sets.length), 0);
}

/**
 * Which movement leads round `round`, as indices into `block.exercises`.
 *
 * Falls back to storage order, which is what every round of an unreordered
 * block uses and what every session logged before reordering existed will have.
 */
export function orderFor(block: StrengthBlock<LoggedSet>, round: number): number[] {
  const recorded = block.roundOrder && block.roundOrder[round];
  if (recorded && recorded.length === block.exercises.length) return recorded;
  return block.exercises.map((_, i) => i);
}

/**
 * Every working set in the block, in the order it is meant to be performed.
 *
 * Round-major: a superset alternates its pair each round rather than finishing
 * one movement before starting the other. An exercise with fewer sets simply
 * stops appearing — the others keep their places rather than sliding up, so
 * "round 4" means the same thing to both movements.
 *
 * Warm-up sets are not in the queue. They are real work the athlete performs,
 * but they are not the sets the session is counting, and nothing in a warm-up
 * may reach a working weight.
 */
export function blockQueue(block: StrengthBlock<LoggedSet>): QueueItem[] {
  const out: QueueItem[] = [];
  const rounds = roundCount(block);
  for (let round = 0; round < rounds; round++) {
    for (const exerciseIndex of orderFor(block, round)) {
      const ex: Exercise<LoggedSet> | undefined = block.exercises[exerciseIndex];
      const st = ex && ex.sets[round];
      if (!st || isWarmup(st)) continue;
      out.push({ exerciseIndex, setIndex: round });
    }
  }
  return out;
}

/**
 * The set the athlete is on: the first in the queue that is not done.
 *
 * A skipped set is still owed, so this returns to it rather than running past —
 * skipping is "not now", not "never", and the block is not finished while one
 * is outstanding.
 */
export function nextUp(block: StrengthBlock<LoggedSet>): QueueItem | null {
  for (const item of blockQueue(block)) {
    const st = block.exercises[item.exerciseIndex].sets[item.setIndex];
    if (!st.done) return item;
  }
  return null;
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @hybrid/session-authoring exec vitest run src/queue.test.ts`
Expected: PASS — every test in the file green.

- [ ] **Step 5: Full gate and commit**

Run: `pnpm run typecheck && pnpm run test`

```bash
git add packages/session-authoring/src/queue.ts packages/session-authoring/src/queue.test.ts
git commit -m "Run a superset round-major, and owe a skipped set rather than losing it"
```

---

### Task 3: Rotation

Reordering a superset's pair. The rule slice 1's spec fixed: unstarted rounds move, a round that has begun keeps the order it ran in.

**Files:**
- Create: `packages/session-authoring/src/rotate.ts`
- Test: `packages/session-authoring/src/rotate.test.ts`

**Interfaces:**
- Consumes: `orderFor`, `roundCount` from `./queue`.
- Produces: `roundStarted(block, round): boolean`, `rotateBlock(block): StrengthBlock<LoggedSet>`.

- [ ] **Step 1: Write the failing test**

`packages/session-authoring/src/rotate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { StrengthBlock, LoggedSet } from '@hybrid/engine';
import { rotateBlock, roundStarted } from './rotate';
import { orderFor } from './queue';

const set = (done = false): LoggedSet =>
  done ? { t: '8', rpe: '8', aVal: '60', aVal2: '8', felt: '8', done: true } : { t: '8', rpe: '8' };

const pair = (a: LoggedSet[], b: LoggedSet[]): StrengthBlock<LoggedSet> => ({
  id: 'b1',
  superset: true,
  exercises: [
    { id: 'e0', name: 'Press', mode: 'reps_kg', sets: a },
    { id: 'e1', name: 'Raise', mode: 'reps_kg', sets: b },
  ],
});

describe('roundStarted', () => {
  it('is false when neither movement has logged that round', () => {
    expect(roundStarted(pair([set()], [set()]), 0)).toBe(false);
  });

  it('is true as soon as either has', () => {
    expect(roundStarted(pair([set(true)], [set()]), 0)).toBe(true);
  });
});

describe('rotateBlock', () => {
  it('rotates every round when nothing has been logged', () => {
    const b = rotateBlock(pair([set(), set()], [set(), set()]));
    expect(orderFor(b, 0)).toEqual([1, 0]);
    expect(orderFor(b, 1)).toEqual([1, 0]);
  });

  it('leaves a round that has already begun in the order it ran', () => {
    const b = rotateBlock(pair([set(true), set()], [set(), set()]));
    expect(orderFor(b, 0)).toEqual([0, 1]);   // history
    expect(orderFor(b, 1)).toEqual([1, 0]);   // preference
  });

  it('rotates back, so it is not a one-way door', () => {
    const once = rotateBlock(pair([set()], [set()]));
    expect(orderFor(rotateBlock(once), 0)).toEqual([0, 1]);
  });

  it('is a rotation, not a swap — three movements cycle', () => {
    const trio: StrengthBlock<LoggedSet> = {
      id: 'b1', superset: true,
      exercises: [0, 1, 2].map((i) => ({ id: `e${i}`, name: `M${i}`, mode: 'reps_kg' as const, sets: [set()] })),
    };
    expect(orderFor(rotateBlock(trio), 0)).toEqual([1, 2, 0]);
  });

  it('does not mutate the block it was given', () => {
    const before = pair([set()], [set()]);
    const snapshot = JSON.stringify(before);
    rotateBlock(before);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('leaves a single-movement block alone — there is nothing to rotate', () => {
    const solo: StrengthBlock<LoggedSet> = {
      id: 'b1', exercises: [{ id: 'e0', name: 'Squat', mode: 'reps_kg', sets: [set()] }],
    };
    expect(rotateBlock(solo)).toEqual(solo);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @hybrid/session-authoring exec vitest run src/rotate.test.ts`
Expected: FAIL — `Failed to resolve import "./rotate"`.

- [ ] **Step 3: Implement**

`packages/session-authoring/src/rotate.ts`:

```ts
import type { LoggedSet, StrengthBlock } from '@hybrid/engine';
import { orderFor, roundCount } from './queue';

/** Has any movement logged its set for this round yet? */
export function roundStarted(block: StrengthBlock<LoggedSet>, round: number): boolean {
  return block.exercises.some((ex) => !!ex.sets[round] && !!ex.sets[round].done);
}

/**
 * Move the pair round by one, from here on.
 *
 * The bench is taken, so you do the other movement first. That is a change of
 * plan, not a rewrite of the session: a round already underway keeps the order
 * it actually ran in, and only rounds that have not begun take the new order.
 * The old order is written down explicitly for those started rounds at the
 * moment of rotation, because "absent means storage order" would otherwise
 * silently reinterpret them.
 *
 * A rotation rather than a swap, so a triset cycles instead of only its first
 * two movements trading places.
 */
export function rotateBlock(block: StrengthBlock<LoggedSet>): StrengthBlock<LoggedSet> {
  if (block.exercises.length < 2) return block;

  const roundOrder: Record<number, number[]> = { ...(block.roundOrder || {}) };
  const rounds = roundCount(block);
  const current = orderFor(block, rounds > 0 ? rounds - 1 : 0);
  const rotated = current.slice(1).concat(current[0]);

  for (let round = 0; round < rounds; round++) {
    roundOrder[round] = roundStarted(block, round) ? orderFor(block, round) : rotated;
  }

  return { ...block, roundOrder };
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @hybrid/session-authoring exec vitest run src/rotate.test.ts`
Expected: PASS.

- [ ] **Step 5: Full gate and commit**

Run: `pnpm run typecheck && pnpm run test`

```bash
git add packages/session-authoring/src/rotate.ts packages/session-authoring/src/rotate.test.ts
git commit -m "Rotate a superset from here on, and leave what already happened alone"
```

---

### Task 4: The draft, and logging it

**Files:**
- Create: `packages/session-authoring/src/draft.ts`
- Test: `packages/session-authoring/src/draft.test.ts`

**Interfaces:**
- Consumes: `nextUp` from `./queue`; `foldFromExercise`, `AUTOREG` from `@hybrid/engine`.
- Produces: `interface Draft { kg: number; reps: number; felt: number | null }`, `openDraft(block, item): Draft`, `applyDraft(block, item, draft): StrengthBlock<LoggedSet>`, `draftReady(draft): boolean`.

- [ ] **Step 1: Write the failing test**

`packages/session-authoring/src/draft.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { StrengthBlock, LoggedSet } from '@hybrid/engine';
import { openDraft, applyDraft, draftReady } from './draft';

const done = (kg: string, reps: string, felt: string): LoggedSet =>
  ({ t: reps, rpe: '8', aVal: kg, aVal2: reps, felt, done: true });

const one = (sets: LoggedSet[]): StrengthBlock<LoggedSet> => ({
  id: 'b1',
  exercises: [{ id: 'e0', name: 'Squat', mode: 'reps_kg', sets }],
});

describe('openDraft', () => {
  it('opens at the weight the coaching rule asks for', () => {
    const b = one([done('100', '8', '8'), { t: '8', rpe: '8' }]);
    expect(openDraft(b, { exerciseIndex: 0, setIndex: 1 }).kg).toBe(100);
  });

  it('opens at the planned reps, so the common case is one tap', () => {
    const b = one([{ t: '8', rpe: '8' }]);
    expect(openDraft(b, { exerciseIndex: 0, setIndex: 0 }).reps).toBe(8);
  });

  it('opens a max set at zero reps — the count is the whole point of it', () => {
    const b = one([{ t: 'max', rpe: '10' }]);
    expect(openDraft(b, { exerciseIndex: 0, setIndex: 0 }).reps).toBe(0);
  });

  it('never guesses how hard it was', () => {
    const b = one([{ t: '8', rpe: '8' }]);
    expect(openDraft(b, { exerciseIndex: 0, setIndex: 0 }).felt).toBeNull();
  });
});

describe('draftReady', () => {
  it('needs reps and a rating before it can be logged', () => {
    expect(draftReady({ kg: 100, reps: 8, felt: null })).toBe(false);
    expect(draftReady({ kg: 100, reps: 0, felt: 8 })).toBe(false);
    expect(draftReady({ kg: 100, reps: 8, felt: 8 })).toBe(true);
  });

  it('allows a bodyweight set, which has no weight to enter', () => {
    expect(draftReady({ kg: 0, reps: 8, felt: 8 })).toBe(true);
  });
});

describe('applyDraft', () => {
  it('writes the draft onto the set and marks it done', () => {
    const b = applyDraft(one([{ t: '8', rpe: '8' }]), { exerciseIndex: 0, setIndex: 0 }, { kg: 102.5, reps: 7, felt: 9 });
    expect(b.exercises[0].sets[0]).toMatchObject({ aVal: '102.5', aVal2: '7', felt: '9', done: true });
  });

  it('leaves the planned target alone — the plan is not rewritten by doing it', () => {
    const b = applyDraft(one([{ t: '8', rpe: '8' }]), { exerciseIndex: 0, setIndex: 0 }, { kg: 100, reps: 7, felt: 9 });
    expect(b.exercises[0].sets[0].t).toBe('8');
    expect(b.exercises[0].sets[0].rpe).toBe('8');
  });

  it('does not mutate the block it was given', () => {
    const before = one([{ t: '8', rpe: '8' }]);
    const snapshot = JSON.stringify(before);
    applyDraft(before, { exerciseIndex: 0, setIndex: 0 }, { kg: 100, reps: 8, felt: 8 });
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @hybrid/session-authoring exec vitest run src/draft.test.ts`
Expected: FAIL — `Failed to resolve import "./draft"`.

- [ ] **Step 3: Implement**

`packages/session-authoring/src/draft.ts`:

```ts
import { AUTOREG, foldFromExercise, repFloorOf, type LoggedSet, type StrengthBlock } from '@hybrid/engine';
import type { QueueItem } from './queue';

/** What the athlete is entering for the set in front of them. */
export interface Draft {
  kg: number;
  reps: number;
  /** How hard it was. Null until they say — never guessed. */
  felt: number | null;
}

/**
 * Open the entry for a set.
 *
 * The weight comes from `@hybrid/engine`'s coaching rule, not from anything
 * here — this package does not decide loads. Reps open at what was planned, so
 * the ordinary case is one tap; a `max` set opens at zero, because counting
 * them is the entire point of it and a prefilled number would be answered for
 * the athlete.
 */
export function openDraft(block: StrengthBlock<LoggedSet>, item: QueueItem): Draft {
  const ex = block.exercises[item.exerciseIndex];
  const st = ex.sets[item.setIndex];
  const folded = foldFromExercise(ex, AUTOREG.plateIncrement);
  const isMax = /max/i.test(st.t || '');
  return {
    kg: folded ? folded.kg : 0,
    reps: isMax ? 0 : repFloorOf(st.t),
    felt: null,
  };
}

/** A draft can be logged once it has reps and a rating. Weight may be zero. */
export function draftReady(draft: Draft): boolean {
  return draft.reps > 0 && draft.felt != null;
}

/**
 * Write a draft onto its set.
 *
 * `t` and `rpe` are left exactly as they were: they are what was ASKED for, and
 * the coaching rule judges the performance against them. Overwriting the plan
 * with what happened would score every set as perfect and the weight would
 * never move.
 */
export function applyDraft(
  block: StrengthBlock<LoggedSet>,
  item: QueueItem,
  draft: Draft,
): StrengthBlock<LoggedSet> {
  return {
    ...block,
    exercises: block.exercises.map((ex, ei) =>
      ei !== item.exerciseIndex
        ? ex
        : {
            ...ex,
            sets: ex.sets.map((st, si) =>
              si !== item.setIndex
                ? st
                : {
                    ...st,
                    aVal: String(draft.kg),
                    aVal2: String(draft.reps),
                    felt: draft.felt == null ? st.felt : String(draft.felt),
                    done: true,
                  },
            ),
          },
    ),
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @hybrid/session-authoring exec vitest run src/draft.test.ts`
Expected: PASS.

- [ ] **Step 5: Full gate and commit**

Run: `pnpm run typecheck && pnpm run test`

```bash
git add packages/session-authoring/src/draft.ts packages/session-authoring/src/draft.test.ts
git commit -m "Open a draft from the coaching rule, and log it without rewriting the plan"
```

---

### Task 5: Rest

**Files:**
- Create: `packages/session-authoring/src/rest.ts`
- Test: `packages/session-authoring/src/rest.test.ts`

**Interfaces:**
- Consumes: `nextUp` from `./queue`.
- Produces: `interface RestState { left: number; total: number; kind: 'set' | 'block' }`, `restAfter(block, item): RestState | null`, `tickRest(rest): RestState | null`, `extendRest(rest, seconds): RestState`.

- [ ] **Step 1: Write the failing test**

`packages/session-authoring/src/rest.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { StrengthBlock, LoggedSet } from '@hybrid/engine';
import { restAfter, tickRest, extendRest } from './rest';

const s = (done = false): LoggedSet =>
  done ? { t: '8', rpe: '8', aVal: '60', aVal2: '8', felt: '8', done: true } : { t: '8', rpe: '8' };

const solo = (sets: LoggedSet[], rest?: number): StrengthBlock<LoggedSet> => ({
  id: 'b1',
  exercises: [{ id: 'e0', name: 'Squat', mode: 'reps_kg', sets, rest }],
});

describe('restAfter', () => {
  it('rests for the exercise’s own rest, between sets', () => {
    const b = solo([s(true), s()], 120);
    expect(restAfter(b, { exerciseIndex: 0, setIndex: 0 })).toEqual({ left: 120, total: 120, kind: 'set' });
  });

  it('turns the page when the block is finished, with no clock to wait out', () => {
    const b = solo([s(true)], 120);
    expect(restAfter(b, { exerciseIndex: 0, setIndex: 0 })).toEqual({ left: 0, total: 0, kind: 'block' });
  });

  it('does not rest when the exercise asks for none', () => {
    const b = solo([s(true), s()], 0);
    expect(restAfter(b, { exerciseIndex: 0, setIndex: 0 })).toBeNull();
  });
});

describe('tickRest', () => {
  it('counts down', () => {
    expect(tickRest({ left: 2, total: 120, kind: 'set' })).toEqual({ left: 1, total: 120, kind: 'set' });
  });

  it('stops at zero rather than going negative', () => {
    expect(tickRest({ left: 0, total: 120, kind: 'set' })).toEqual({ left: 0, total: 120, kind: 'set' });
  });

  it('leaves a page-turn alone — it is not a clock', () => {
    expect(tickRest({ left: 0, total: 0, kind: 'block' })).toEqual({ left: 0, total: 0, kind: 'block' });
  });
});

describe('extendRest', () => {
  it('adds to both what is left and the whole, so the dial stays honest', () => {
    expect(extendRest({ left: 30, total: 120, kind: 'set' }, 15)).toEqual({ left: 45, total: 135, kind: 'set' });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @hybrid/session-authoring exec vitest run src/rest.test.ts`
Expected: FAIL — `Failed to resolve import "./rest"`.

- [ ] **Step 3: Implement**

`packages/session-authoring/src/rest.ts`:

```ts
import type { LoggedSet, StrengthBlock } from '@hybrid/engine';
import { nextUp, type QueueItem } from './queue';

/**
 * A rest in progress.
 *
 * `kind: 'block'` with a zero total is not a rest — it is the page turning
 * between blocks. Both travel in the same field because both take the screen
 * over, but a screen that shows a spent 0:00 dial reads as a timer that ran
 * out rather than as a block ending, so they must stay distinguishable.
 */
export interface RestState {
  left: number;
  total: number;
  kind: 'set' | 'block';
}

/** What follows the set just logged. */
export function restAfter(block: StrengthBlock<LoggedSet>, item: QueueItem): RestState | null {
  if (!nextUp(block)) return { left: 0, total: 0, kind: 'block' };
  const rest = block.exercises[item.exerciseIndex].rest || 0;
  if (rest <= 0) return null;
  return { left: rest, total: rest, kind: 'set' };
}

/** One second gone. Floors at zero; a page turn has no clock to advance. */
export function tickRest(rest: RestState): RestState | null {
  if (rest.total <= 0) return rest;
  return { ...rest, left: Math.max(0, rest.left - 1) };
}

/**
 * Give it longer.
 *
 * Both numbers move, so the fraction the dial draws still means "how much of
 * this rest is left" rather than overflowing past full.
 */
export function extendRest(rest: RestState, seconds: number): RestState {
  return { ...rest, left: rest.left + seconds, total: rest.total + seconds };
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @hybrid/session-authoring exec vitest run src/rest.test.ts`
Expected: PASS.

- [ ] **Step 5: Full gate and commit**

Run: `pnpm run typecheck && pnpm run test`

```bash
git add packages/session-authoring/src/rest.ts packages/session-authoring/src/rest.test.ts
git commit -m "Separate a rest from a page turn, so neither pretends to be the other"
```

---

### Task 6: The reducer — every action in one pure place

**Files:**
- Create: `packages/session-authoring/src/machine.ts`
- Test: `packages/session-authoring/src/machine.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2-5.
- Produces: `interface RunState { blockIndex: number; draft: Draft | null; rest: RestState | null }`, `initialRun(session): RunState`, `type Action`, `reduce(session, run, action): { session: Session; run: RunState }`.

Actions: `{type:'setDraft', patch}`, `{type:'logSet'}`, `{type:'rotate', blockId}`, `{type:'skipSet'}`, `{type:'addSet'}`, `{type:'goToBlock', index}`, `{type:'tick'}`, `{type:'extendRest', seconds}`, `{type:'dismissRest'}`, `{type:'finish'}`.

- [ ] **Step 1: Write the failing test**

`packages/session-authoring/src/machine.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Session, LoggedSet, StrengthBlock } from '@hybrid/engine';
import { initialRun, reduce } from './machine';
import { orderFor } from './queue';

const s = (done = false): LoggedSet =>
  done ? { t: '8', rpe: '8', aVal: '100', aVal2: '8', felt: '8', done: true } : { t: '8', rpe: '8' };

const session = (blocks: StrengthBlock<LoggedSet>[]): Session => ({
  id: 's1', date: '2026-08-13', status: 'active', blocks,
});

const solo = (sets: LoggedSet[], rest = 120): StrengthBlock<LoggedSet> => ({
  id: 'b1', exercises: [{ id: 'e0', name: 'Squat', mode: 'reps_kg', sets, rest }],
});

const pair = (): StrengthBlock<LoggedSet> => ({
  id: 'b2', superset: true, rest: 60,
  exercises: [
    { id: 'e0', name: 'Press', mode: 'reps_kg', sets: [s(), s()], rest: 60 },
    { id: 'e1', name: 'Raise', mode: 'reps_kg', sets: [s(), s()], rest: 60 },
  ],
});

describe('initialRun', () => {
  it('starts on the first block with a draft open and no rest', () => {
    const run = initialRun(session([solo([s()])]));
    expect(run.blockIndex).toBe(0);
    expect(run.rest).toBeNull();
    expect(run.draft).not.toBeNull();
  });
});

describe('logSet', () => {
  it('writes the set, opens the next draft, and starts the rest', () => {
    const sess = session([solo([s(), s()])]);
    let st = { session: sess, run: initialRun(sess) };
    st = reduce(st.session, { ...st.run, draft: { kg: 100, reps: 8, felt: 8 } }, { type: 'logSet' });
    expect((st.session.blocks[0] as StrengthBlock<LoggedSet>).exercises[0].sets[0].done).toBe(true);
    expect(st.run.rest).toEqual({ left: 120, total: 120, kind: 'set' });
    expect(st.run.draft).not.toBeNull();
  });

  it('refuses an incomplete draft rather than logging a guess', () => {
    const sess = session([solo([s()])]);
    const run = { ...initialRun(sess), draft: { kg: 100, reps: 8, felt: null } };
    const st = reduce(sess, run, { type: 'logSet' });
    expect((st.session.blocks[0] as StrengthBlock<LoggedSet>).exercises[0].sets[0].done).toBeFalsy();
  });

  it('does not mutate the session it was given', () => {
    const sess = session([solo([s()])]);
    const snapshot = JSON.stringify(sess);
    reduce(sess, { ...initialRun(sess), draft: { kg: 100, reps: 8, felt: 8 } }, { type: 'logSet' });
    expect(JSON.stringify(sess)).toBe(snapshot);
  });
});

describe('rotate', () => {
  it('rotates the named block and reopens the draft on the new leader', () => {
    const sess = session([pair()]);
    const st = reduce(sess, initialRun(sess), { type: 'rotate', blockId: 'b2' });
    expect(orderFor(st.session.blocks[0] as StrengthBlock<LoggedSet>, 0)).toEqual([1, 0]);
    expect(st.run.draft).not.toBeNull();
  });

  it('ignores a block id that is not in the session', () => {
    const sess = session([pair()]);
    const st = reduce(sess, initialRun(sess), { type: 'rotate', blockId: 'nope' });
    expect(st.session).toBe(sess);
  });
});

describe('skipSet', () => {
  it('moves past the set without marking it done, so it is still owed', () => {
    const sess = session([solo([s(), s()])]);
    const st = reduce(sess, initialRun(sess), { type: 'skipSet' });
    expect((st.session.blocks[0] as StrengthBlock<LoggedSet>).exercises[0].sets[0].done).toBeFalsy();
    expect(st.run.draft).not.toBeNull();
  });
});

describe('addSet', () => {
  it('appends a set shaped like the last one', () => {
    const sess = session([solo([s()])]);
    const st = reduce(sess, initialRun(sess), { type: 'addSet' });
    const ex = (st.session.blocks[0] as StrengthBlock<LoggedSet>).exercises[0];
    expect(ex.sets).toHaveLength(2);
    expect(ex.sets[1]).toEqual({ t: '8', rpe: '8' });
  });
});

describe('rest', () => {
  it('ticks down and clears itself when spent', () => {
    const sess = session([solo([s(), s()])]);
    let run = { ...initialRun(sess), rest: { left: 1, total: 120, kind: 'set' as const } };
    run = reduce(sess, run, { type: 'tick' }).run;
    expect(run.rest).toEqual({ left: 0, total: 120, kind: 'set' });
  });

  it('can be extended and dismissed', () => {
    const sess = session([solo([s(), s()])]);
    const rest = { left: 30, total: 120, kind: 'set' as const };
    expect(reduce(sess, { ...initialRun(sess), rest }, { type: 'extendRest', seconds: 15 }).run.rest)
      .toEqual({ left: 45, total: 135, kind: 'set' });
    expect(reduce(sess, { ...initialRun(sess), rest }, { type: 'dismissRest' }).run.rest).toBeNull();
  });
});

describe('goToBlock', () => {
  it('moves and reopens the draft there', () => {
    const sess = session([solo([s()]), pair()]);
    const st = reduce(sess, initialRun(sess), { type: 'goToBlock', index: 1 });
    expect(st.run.blockIndex).toBe(1);
  });

  it('refuses an index outside the session', () => {
    const sess = session([solo([s()])]);
    expect(reduce(sess, initialRun(sess), { type: 'goToBlock', index: 9 }).run.blockIndex).toBe(0);
  });
});

describe('finish', () => {
  it('marks the session completed and stamps when', () => {
    const sess = session([solo([s(true)])]);
    const st = reduce(sess, initialRun(sess), { type: 'finish' });
    expect(st.session.status).toBe('completed');
    expect(typeof st.session.completedAt).toBe('number');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @hybrid/session-authoring exec vitest run src/machine.test.ts`
Expected: FAIL — `Failed to resolve import "./machine"`.

- [ ] **Step 3: Implement**

Write `packages/session-authoring/src/machine.ts` so every test above passes. It must:

- export `RunState`, `initialRun(session)`, `Action`, and `reduce(session, run, action)`
- treat a `Block` that is not a `StrengthBlock` as having no queue, so a session containing one does not crash — use the engine's own block discrimination rather than casting
- return the SAME `session` reference when an action changes nothing, so a consumer's identity check is meaningful
- never mutate: every change rebuilds the blocks array and the block it touched
- on `logSet`: refuse unless `draftReady`; otherwise `applyDraft`, then set `rest` from `restAfter`, then reopen the draft on the new `nextUp` (null if the block is done)
- on `skipSet`: advance past the current item WITHOUT marking it done, leaving it owed, and reopen the draft on the following item
- on `addSet`: append a set carrying the planned `t` and `rpe` of the last set in that exercise, and nothing else — no recorded values
- on `rotate`: find the block by id, `rotateBlock` it, reopen the draft
- on `tick`: `tickRest`, and clear `rest` to null once a `'set'` rest reaches zero, leaving a `'block'` page-turn standing until dismissed
- on `finish`: set `status: 'completed'` and `completedAt`. Take the timestamp from `Date.now()` inside `reduce` — note it in your report as the one impure edge, and confirm the `finish` test does not depend on its value

Use the exact spellings in the Interfaces block above. Later tasks and other slices are written against them.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @hybrid/session-authoring exec vitest run src/machine.test.ts`
Expected: PASS.

- [ ] **Step 5: Full gate and commit**

Run: `pnpm run typecheck && pnpm run test`

```bash
git add packages/session-authoring/src/machine.ts packages/session-authoring/src/machine.test.ts
git commit -m "One reducer for every session action, pure and immutable"
```

---

### Task 7: The view, and the hook

**Files:**
- Create: `packages/session-authoring/src/view.ts`, `packages/session-authoring/src/useSession.ts`
- Modify: `packages/session-authoring/src/index.ts`
- Test: `packages/session-authoring/src/view.test.ts`

**Interfaces:**
- Consumes: everything above; `foldFromExercise`, `AUTOREG` from `@hybrid/engine`.
- Produces: `sessionView(session, run): SessionView` and `useSession(initial): SessionView & Actions`, both exported from the package index.

`SessionView` carries: `blocks` (title and progress per block), `rounds` (per round: the sets, each as done / live / upcoming, in that round's order), `hot` (the live set with its exercise and the coaching message), `rest`, `draft`, and `finished`.

- [ ] **Step 1: Write the failing test for the view**

`packages/session-authoring/src/view.test.ts` must assert at least:

```ts
// the live set carries the coaching rule's message, unedited
it('reports the coaching message from the engine, not one of its own', () => { /* … */ });

// rounds render in that round's order, including a rotated one
it('renders a rotated round in the order it will run', () => { /* … */ });

// a finished session reports finished, and has no hot set
it('has no live set once every block is done', () => { /* … */ });

// progress counts working sets only
it('counts progress in working sets, so a warm-up cannot inflate it', () => { /* … */ });
```

Write each of those out fully, with fixtures in the style of `machine.test.ts`, and hand-computed expected values.

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @hybrid/session-authoring exec vitest run src/view.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the view**

`sessionView` derives everything a screen needs and holds no state of its own. It must take the coaching message verbatim from `foldFromExercise(ex, AUTOREG.plateIncrement)` — if the diff computes a message string from numbers, the task is wrong.

- [ ] **Step 4: Implement the hook**

`packages/session-authoring/src/useSession.ts`:

```ts
import { useCallback, useMemo, useState } from 'react';
import type { Session } from '@hybrid/engine';
import { initialRun, reduce, type Action, type RunState } from './machine';
import { sessionView, type SessionView } from './view';

/**
 * The one piece of this package that is not pure.
 *
 * It holds the session and the run state, and re-derives the view when either
 * moves. Every decision it appears to make is `reduce`'s; this is glue, and it
 * is deliberately thin enough that `apps/web` and `apps/mobile` can each render
 * their own screens on it without either owning any of the logic.
 */
export function useSession(initial: Session) {
  const [session, setSession] = useState<Session>(initial);
  const [run, setRun] = useState<RunState>(() => initialRun(initial));

  const dispatch = useCallback((action: Action) => {
    setSession((s) => {
      let nextRun: RunState | null = null;
      const result = reduce(s, run, action);
      nextRun = result.run;
      setRun(nextRun);
      return result.session;
    });
  }, [run]);

  const view: SessionView = useMemo(() => sessionView(session, run), [session, run]);
  return { ...view, dispatch };
}
```

If that shape has a stale-closure or double-render problem, fix it and say what you changed and why — the requirement is that a `dispatch` always reduces against the CURRENT session and run, and that React's strict-mode double invocation cannot double-apply an action.

- [ ] **Step 5: Export the surface**

`packages/session-authoring/src/index.ts` re-exports the modules whole, matching how `packages/engine/src/index.ts` does it:

```ts
export * from './queue';
export * from './rotate';
export * from './draft';
export * from './rest';
export * from './machine';
export * from './view';
export * from './useSession';
```

Keep the module doc comment at the top of the file.

- [ ] **Step 6: Full gate and commit**

Run: `pnpm run typecheck && pnpm run test`

```bash
git add packages/session-authoring/src
git commit -m "Derive the whole screen from state, and hold that state in one hook"
```

---

## Self-Review

Checked against slice 2 of the spec:

- *"the block model — prep blocks and strength blocks"* — Task 1, with the finding that prep pieces need no new field.
- *"the round queue — which set is live, in which order, across a superset's interleaved rounds"* — Task 2.
- *"superset rotation"* — Task 3, with the started/unstarted rule from spec constraint 6.
- *"draft state"* — Task 4.
- *"the coaching fold is NOT re-implemented here — the hook calls `foldExercise` from the engine"* — enforced as a global constraint and re-stated in Tasks 4 and 7.
- *"one hook: `useSession`"* — Task 7. The spec's listed methods map to reducer actions: `setDraft`, `logSet`, `rotate`, `skipSet`, `addSet`, `goToBlock`, `finish`, plus `tick`/`extendRest`/`dismissRest` which the rest model needs and the spec's list did not anticipate.
- *"`@hybrid/guided-flow` is superseded by this one and is deleted with the last `GuidedBuilder` that imports it"* — correctly NOT in this slice; those screens die in slices 4 and 6.

Known gap, stated rather than hidden: `useSession` itself has no unit test in this package. Testing a hook needs a renderer, and every renderer available pulls in `react-dom` or `react-native` — the exact thing the package is forbidden to depend on. The hook is glue over `reduce` and `sessionView`, both exhaustively tested here; it is exercised for real by each app's smoke test in slices 4 and 6. If that trade is wrong, the fix is a `react-test-renderer` devDependency, and it should be a deliberate decision rather than a silent one.

Type consistency: `QueueItem` is `{ exerciseIndex, setIndex }` in Tasks 2-6; `Draft` is `{ kg, reps, felt }` in Tasks 4, 6, 7; `RestState` is `{ left, total, kind }` in Tasks 5-7; `reduce(session, run, action)` returns `{ session, run }` at every call site.
