# Coaching Rule Into The Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the engine's per-set coaching rule with the prototype's plan-anchored fold, so the repo has exactly one answer to "what should this set weigh".

**Architecture:** A new module `packages/engine/src/fold.ts` owns the rule. It walks every set already logged in an exercise, carries an adjustment multiplier, and prices the next set off the exercise's plan anchor rather than off the previous set. `computeSetAdjustment` is deleted and its four call sites migrate to it. Golden vectors are replaced, and the replacement is read as a behaviour change.

**Tech Stack:** TypeScript 5.9, Vitest 3.2, pnpm workspaces.

This is slice 1 of `docs/superpowers/specs/2026-08-12-round-major-logger-design.md`.

## Global Constraints

- Tests are colocated: `src/fold.ts` is tested by `src/fold.test.ts`. No `*.test.ts` under `test/`.
- No placeholders in shipped code — no `TODO`, no stub, no mock data, no deprecated twin left beside the new rule.
- `computeSetAdjustment` is **deleted**, not deprecated. If it still exists at the end of this plan, the plan failed.
- The plan-anchored constants are exactly: rep-to-failure cap `12`, `kOf` = 3 for reps ≤ 3, 2.5 for reps ≤ 7, 2 above, clamp `±7.5%`, missed-floor effective RPE `10.5`, Epley divisor `30`.
- Existing `AUTOREG` constants in `packages/engine/src/constants.ts` are not edited. The fold's constants are new and live beside it.
- Every task ends green: `pnpm --filter @hybrid/engine test` and `pnpm run typecheck` both pass before the commit.

---

### Task 1: The fold's arithmetic primitives

Four pure functions. They are separated from the walk because they are the part with exact numeric contracts, and they are what the golden vectors will pin.

**Files:**
- Create: `packages/engine/src/fold.ts`
- Test: `packages/engine/src/fold.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `repsToFailure(reps: number, rpe: number): number`, `e1rmOf(kg: number, reps: number, rpe: number): number`, `kFor(reps: number): number`, `clampPct(pct: number): number`. All exported from `packages/engine/src/fold.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/engine/src/fold.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { repsToFailure, e1rmOf, kFor, clampPct } from './fold';

describe('repsToFailure', () => {
  it('is reps plus the RPE shortfall', () => {
    expect(repsToFailure(8, 8)).toBe(10);
    expect(repsToFailure(5, 10)).toBe(5);
  });

  it('caps at 12, so a very easy high-rep set cannot claim an absurd e1RM', () => {
    expect(repsToFailure(20, 6)).toBe(12);
    expect(repsToFailure(12, 10)).toBe(12);
  });
});

describe('e1rmOf', () => {
  it('is Epley over reps-to-failure', () => {
    expect(e1rmOf(100, 10, 10)).toBeCloseTo(133.333, 3);
    expect(e1rmOf(100, 1, 10)).toBeCloseTo(103.333, 3);
  });

  it('returns 0 for a bodyweight set', () => {
    expect(e1rmOf(0, 10, 8)).toBe(0);
  });
});

describe('kFor', () => {
  it('moves low-rep work further per RPE point than high-rep work', () => {
    expect(kFor(1)).toBe(3);
    expect(kFor(3)).toBe(3);
    expect(kFor(4)).toBe(2.5);
    expect(kFor(7)).toBe(2.5);
    expect(kFor(8)).toBe(2);
    expect(kFor(20)).toBe(2);
  });
});

describe('clampPct', () => {
  it('holds a single adjustment inside 7.5% either way', () => {
    expect(clampPct(3)).toBe(3);
    expect(clampPct(20)).toBe(7.5);
    expect(clampPct(-20)).toBe(-7.5);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @hybrid/engine exec vitest run src/fold.test.ts`
Expected: FAIL — `Failed to resolve import "./fold"`.

- [ ] **Step 3: Implement the minimal code to make the test pass**

Create `packages/engine/src/fold.ts`:

```ts
/**
 * The coaching rule: what should the next set weigh.
 *
 * This is the ONE owner of that question. It replaced
 * `autoreg.computeSetAdjustment`, which judged a single set against its own
 * target and moved off the last weight lifted. The difference is not a tuning
 * change: that rule had no memory, so a hard set followed by an easy one
 * wandered, and an opener entered heavy stayed the reference forever.
 *
 * This rule is plan-anchored. It reads the exercise's first planned set as the
 * anchor, prices every other planned set off that anchor, and then applies one
 * multiplier accumulated from how the session has actually gone.
 */

/** Reps-to-failure cap. Above this the Epley estimate stops meaning anything. */
export const RTF_CAP = 12;

/** Epley's divisor. */
const EPLEY_DIV = 30;

/** The most one exercise's adjustment may move on a single set, either way. */
export const MAX_STEP_PCT = 7.5;

/**
 * How many reps the athlete had left, by their own rating. An RPE of 10 is
 * failure, so the shortfall from 10 is reps in reserve.
 */
export function repsToFailure(reps: number, rpe: number): number {
  return Math.min(RTF_CAP, reps + (10 - rpe));
}

/** Estimated one-rep max for a set, via Epley over reps-to-failure. */
export function e1rmOf(kg: number, reps: number, rpe: number): number {
  return kg * (1 + repsToFailure(reps, rpe) / EPLEY_DIV);
}

/**
 * Percent of load one RPE point is worth, by rep range. A triple moves further
 * per point than a set of twelve, because the load-per-rep curve is steeper
 * where the reps are few.
 */
export function kFor(reps: number): number {
  if (reps <= 3) return 3;
  if (reps <= 7) return 2.5;
  return 2;
}

/** Hold one adjustment inside the step ceiling, in both directions. */
export function clampPct(pct: number): number {
  return Math.max(-MAX_STEP_PCT, Math.min(MAX_STEP_PCT, pct));
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `pnpm --filter @hybrid/engine exec vitest run src/fold.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/fold.ts packages/engine/src/fold.test.ts
git commit -m "Add the coaching fold's arithmetic, with its constants named"
```

---

### Task 2: The anchor and the planned weight for a set

The anchor is the e1RM implied by set 1's planned reps/RPE at the opener weight. Every other planned set is that anchor divided back down by its own reps-to-failure. This is what "plan-anchored" means, and it is why an easy fourth set does not drag the fifth set's target off the plan.

**Files:**
- Modify: `packages/engine/src/fold.ts`
- Test: `packages/engine/src/fold.test.ts`

**Interfaces:**
- Consumes: `repsToFailure`, `e1rmOf` from Task 1.
- Produces: `anchorFor(opener: number, first: PlanTarget): number` and `plannedKg(anchor: number, target: PlanTarget): number`, plus the exported type `PlanTarget = { reps: number | 'max'; rpe: number }`.

- [ ] **Step 1: Write the failing test**

Append to `packages/engine/src/fold.test.ts`:

```ts
import { anchorFor, plannedKg, type PlanTarget } from './fold';

describe('anchorFor', () => {
  it('is the e1RM implied by set 1 at the opener', () => {
    const first: PlanTarget = { reps: 10, rpe: 7 };
    // rtf = 10 + 3 = 13, capped to 12 → 60 * (1 + 12/30) = 84
    expect(anchorFor(60, first)).toBeCloseTo(84, 6);
  });

  it('is 0 for a bodyweight exercise, so nothing downstream invents a load', () => {
    expect(anchorFor(0, { reps: 10, rpe: 8 })).toBe(0);
  });
});

describe('plannedKg', () => {
  it('prices a later set off the anchor, not off the last set', () => {
    const anchor = anchorFor(60, { reps: 10, rpe: 7 });
    // set 2 asks 8 @ 8 → rtf 10 → 84 / (1 + 10/30) = 63
    expect(plannedKg(anchor, { reps: 8, rpe: 8 })).toBeCloseTo(63, 6);
  });

  it('treats a max set as the anchor set would be, since it has no rep target', () => {
    const anchor = anchorFor(60, { reps: 10, rpe: 7 });
    expect(plannedKg(anchor, { reps: 'max', rpe: 10 })).toBeCloseTo(84, 6);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @hybrid/engine exec vitest run src/fold.test.ts`
Expected: FAIL — `anchorFor is not a function`.

- [ ] **Step 3: Implement the minimal code to make the test pass**

Append to `packages/engine/src/fold.ts`:

```ts
/**
 * A planned set, reduced to the two numbers the fold needs. `reps: 'max'` is an
 * AMRAP: it has no rep floor to miss and no target load of its own.
 */
export interface PlanTarget {
  reps: number | 'max';
  rpe: number;
}

/**
 * The exercise's reference point: the e1RM implied by set 1's plan at the
 * weight the athlete opened with.
 *
 * Set 1 and not the best set, because the opener is the one number the athlete
 * chose deliberately. Anchoring on the best set would let one good day ratchet
 * the whole exercise upward with no decision behind it.
 */
export function anchorFor(opener: number, first: PlanTarget): number {
  if (!(opener > 0)) return 0;
  const reps = first.reps === 'max' ? RTF_CAP : first.reps;
  return e1rmOf(opener, reps, first.rpe);
}

/**
 * What the plan says this set should weigh, before anything that happened today
 * is taken into account.
 *
 * A `max` set has no reps to price against, so it sits at the anchor and the
 * walk's own back-off rule decides what it actually gets.
 */
export function plannedKg(anchor: number, target: PlanTarget): number {
  if (!(anchor > 0)) return 0;
  if (target.reps === 'max') return anchor;
  return anchor / (1 + repsToFailure(target.reps, target.rpe) / EPLEY_DIV);
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `pnpm --filter @hybrid/engine exec vitest run src/fold.test.ts`
Expected: PASS — 12 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/fold.ts packages/engine/src/fold.test.ts
git commit -m "Anchor the fold on set 1's plan, and price later sets off it"
```

---

### Task 3: The walk — accumulate the adjustment across logged sets

This is the memory that the old rule lacked. One pass over the sets already logged, carrying a multiplier.

Three behaviours to get exactly right, and each has a reason:

- **Underperformance locks.** Once a set comes in harder than asked, the multiplier is applied in full and `locked` is set. After that, easy sets stop raising the weight. Coming back up in the same exercise you just struggled in is how people injure themselves.
- **An easy set is worth half, until there are two.** The first easy set applies `k * dev / 2`; a second consecutive easy set applies the rest. One easy set is not evidence — it is a good rep, a fresh set, or a generous rating.
- **A `max` set contributes nothing.** It has no rep floor to miss and no target to deviate from, so it is skipped by the walk entirely.

**Files:**
- Modify: `packages/engine/src/fold.ts`
- Test: `packages/engine/src/fold.test.ts`

**Interfaces:**
- Consumes: `kFor`, `clampPct`, `PlanTarget` from Tasks 1–2.
- Produces: `walkLogs(logs: FoldLog[]): WalkState` and the types `FoldLog = { reps: number; kg: number; felt: number; target: PlanTarget }` and `WalkState = { adj: number; locked: boolean; easyRun: number; last: FoldLog | null }`.

- [ ] **Step 1: Write the failing test**

Append to `packages/engine/src/fold.test.ts`:

```ts
import { walkLogs, type FoldLog } from './fold';

const log = (reps: number, felt: number, target: PlanTarget, kg = 60): FoldLog =>
  ({ reps, kg, felt, target });

describe('walkLogs', () => {
  it('holds at 1 when every set landed on target', () => {
    const s = walkLogs([log(8, 8, { reps: 8, rpe: 8 })]);
    expect(s.adj).toBe(1);
    expect(s.locked).toBe(false);
    expect(s.easyRun).toBe(0);
  });

  it('locks and drops on a set harder than asked', () => {
    const s = walkLogs([log(8, 9, { reps: 8, rpe: 8 })]);
    // dev = 8 - 9 = -1, k = 2 → -2%
    expect(s.adj).toBeCloseTo(0.98, 6);
    expect(s.locked).toBe(true);
  });

  it('treats a missed rep floor as harder than a 10, however it was rated', () => {
    const s = walkLogs([log(5, 7, { reps: 8, rpe: 8 })]);
    // missed → eff 10.5, dev = 8 - 10.5 = -2.5, k = 2 → -5%
    expect(s.adj).toBeCloseTo(0.95, 6);
    expect(s.locked).toBe(true);
  });

  it('gives one easy set only half its correction', () => {
    const s = walkLogs([log(8, 7, { reps: 8, rpe: 8 })]);
    // dev = +1, k = 2 → (2 * 1) / 2 = +1%
    expect(s.adj).toBeCloseTo(1.01, 6);
    expect(s.easyRun).toBe(1);
  });

  it('gives a second consecutive easy set the rest of it', () => {
    const s = walkLogs([
      log(8, 7, { reps: 8, rpe: 8 }),
      log(8, 7, { reps: 8, rpe: 8 }),
    ]);
    expect(s.adj).toBeCloseTo(1.0201, 6);
    expect(s.easyRun).toBe(2);
  });

  it('refuses to climb again once locked', () => {
    const s = walkLogs([
      log(8, 9, { reps: 8, rpe: 8 }),   // hard: locks at 0.98
      log(8, 7, { reps: 8, rpe: 8 }),   // easy: ignored
    ]);
    expect(s.adj).toBeCloseTo(0.98, 6);
    expect(s.locked).toBe(true);
  });

  it('resets the easy run when a set lands on target', () => {
    const s = walkLogs([
      log(8, 7, { reps: 8, rpe: 8 }),
      log(8, 8, { reps: 8, rpe: 8 }),
    ]);
    expect(s.easyRun).toBe(0);
  });

  it('skips a max set entirely — no floor to miss, no target to deviate from', () => {
    const s = walkLogs([log(3, 10, { reps: 'max', rpe: 10 })]);
    expect(s.adj).toBe(1);
    expect(s.locked).toBe(false);
    expect(s.last?.target.reps).toBe('max');
  });

  it('clamps a wild rating to the step ceiling', () => {
    const s = walkLogs([log(3, 1, { reps: 3, rpe: 9 })]);
    // dev = +8, k = 3 → (3 * 8) / 2 = 12% → clamped to 7.5%
    expect(s.adj).toBeCloseTo(1.075, 6);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @hybrid/engine exec vitest run src/fold.test.ts`
Expected: FAIL — `walkLogs is not a function`.

- [ ] **Step 3: Implement the minimal code to make the test pass**

Append to `packages/engine/src/fold.ts`:

```ts
/** Effective RPE for a set that fell short of its rep floor. */
const MISSED_FLOOR_RPE = 10.5;

/** A set as it was actually performed, with the plan it was performed against. */
export interface FoldLog {
  reps: number;
  kg: number;
  felt: number;
  target: PlanTarget;
}

/** What the walk carries forward. */
export interface WalkState {
  /** Multiplier applied to the planned weight of the next set. */
  adj: number;
  /** Set by an underperformance. Once locked, easy sets no longer raise load. */
  locked: boolean;
  /** Consecutive easy sets immediately before now. */
  easyRun: number;
  /** The last set walked, or null. */
  last: FoldLog | null;
}

/**
 * Fold every set logged so far into one multiplier.
 *
 * Deviation is `asked - felt`: positive means easier than asked, negative means
 * harder. A missed rep floor is scored as `MISSED_FLOOR_RPE` regardless of what
 * the athlete rated it, so a modest rating on a failed set still brings the
 * weight down.
 */
export function walkLogs(logs: FoldLog[]): WalkState {
  const s: WalkState = { adj: 1, locked: false, easyRun: 0, last: null };

  for (const log of logs) {
    s.last = log;
    if (log.target.reps === 'max') continue;

    const floor = log.target.reps;
    const missed = log.reps < floor;
    const effective = missed ? MISSED_FLOOR_RPE : log.felt;
    const dev = log.target.rpe - effective;
    const k = kFor(floor);

    if (dev <= -1) {
      // Harder than asked. Full correction, and the exercise locks.
      s.adj *= 1 + clampPct(k * dev) / 100;
      s.locked = true;
      s.easyRun = 0;
    } else if (dev >= 1) {
      // Easier than asked. Half now; the second consecutive one adds the rest.
      // Nothing rises after a lock.
      if (!s.locked) {
        s.adj *= 1 + clampPct((k * dev) / 2) / 100;
        s.easyRun += 1;
      }
    } else {
      s.easyRun = 0;
    }
  }

  return s;
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `pnpm --filter @hybrid/engine exec vitest run src/fold.test.ts`
Expected: PASS — 21 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/fold.ts packages/engine/src/fold.test.ts
git commit -m "Give the coaching rule a memory: lock on hard, halve the first easy set"
```

---

### Task 4: `foldExercise` — the public answer

The one function the rest of the repo calls. It takes an exercise's plan, its opener, its logged sets and its load increment, and returns what the next set should weigh and why.

**Files:**
- Modify: `packages/engine/src/fold.ts`
- Test: `packages/engine/src/fold.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–3, plus `roundToIncrement` from `./num`.
- Produces: `foldExercise(input: FoldInput): FoldResult | null`, with
  `FoldInput = { targets: PlanTarget[]; logs: FoldLog[]; opener: number; increment: number }` and
  `FoldResult = { setIndex: number; target: PlanTarget; kg: number; message: string }`.
  Returns `null` when every planned set is already logged.

- [ ] **Step 1: Write the failing test**

Append to `packages/engine/src/fold.test.ts`:

```ts
import { foldExercise } from './fold';

const LADDER: PlanTarget[] = [
  { reps: 10, rpe: 7 },
  { reps: 8, rpe: 8 },
  { reps: 6, rpe: 9 },
  { reps: 'max', rpe: 10 },
];

const input = (logs: FoldLog[]) => ({ targets: LADDER, logs, opener: 60, increment: 2.5 });

describe('foldExercise', () => {
  it('opens at the weight the athlete chose, and says so', () => {
    const r = foldExercise(input([]))!;
    expect(r.setIndex).toBe(0);
    expect(r.kg).toBe(60);
    expect(r.message).toBe('opener — everything works from here');
  });

  it('returns null once every planned set is logged', () => {
    const logs = LADDER.map((t) => log(8, 8, t));
    expect(foldExercise(input(logs))).toBeNull();
  });

  it('is on plan when the opener landed on target', () => {
    const r = foldExercise(input([log(10, 7, LADDER[0])]))!;
    expect(r.setIndex).toBe(1);
    expect(r.kg).toBe(62.5);
    expect(r.message).toBe('on plan');
  });

  it('holds after one easy set rather than jumping on thin evidence', () => {
    const r = foldExercise(input([log(10, 6, LADDER[0])]))!;
    // planned 63 → want 63.63 → rounds back to 62.5, which IS the plan. The
    // wanted rise is smaller than one plate, so the message names the plate.
    expect(r.kg).toBe(62.5);
    expect(r.message).toBe('holding — the next jump is 2.5 kg, chase clean reps instead');
  });

  it('says plainly that one easy set is not evidence when the step is small', () => {
    // The "next jump is N kg" wording is reserved for inc >= 2, where naming
    // the plate is useful. Below that it just says why it held.
    // planned 63, want 63.63, both round to 63 on a 1.5 kg step.
    const r = foldExercise({ ...input([log(10, 6, LADDER[0])]), increment: 1.5 })!;
    expect(r.kg).toBe(63);
    expect(r.message).toBe('holding — one easy set is not evidence yet');
  });

  it('backs off after a set harder than asked, and names the set', () => {
    const r = foldExercise(input([log(10, 9, LADDER[0])]))!;
    expect(r.kg).toBeLessThan(62.5);
    expect(r.message).toBe('backed off — your 10 @ 9 was harder than asked');
  });

  it('gives a bodyweight exercise no load and no advice about load', () => {
    const r = foldExercise({ targets: LADDER, logs: [], opener: 0, increment: 2.5 })!;
    expect(r.kg).toBe(0);
    expect(r.message).toBe('bodyweight');
  });

  it('sends a max set back to set 1 weight when the run has gone well', () => {
    const logs = [log(10, 7, LADDER[0]), log(8, 8, LADDER[1]), log(6, 9, LADDER[2])];
    const r = foldExercise(input(logs))!;
    expect(r.setIndex).toBe(3);
    expect(r.kg).toBe(60);
    expect(r.message).toBe('back to set 1’s weight — count the reps');
  });

  it('backs a max set off when the set before it was a grind', () => {
    const logs = [log(10, 7, LADDER[0]), log(8, 8, LADDER[1]), log(6, 10, LADDER[2])];
    const r = foldExercise(input(logs))!;
    expect(r.kg).toBeLessThan(60);
    expect(r.message).toBe('set 1 minus the back-off — arrive fresh');
  });

  it('rounds to the exercise’s own increment', () => {
    const r = foldExercise({ ...input([log(10, 6, LADDER[0])]), increment: 5 })!;
    expect(r.kg % 5).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @hybrid/engine exec vitest run src/fold.test.ts`
Expected: FAIL — `foldExercise is not a function`.

- [ ] **Step 3: Implement the minimal code to make the test pass**

Append to `packages/engine/src/fold.ts` (and add `import { roundToIncrement } from './num';` at the top of the file):

```ts
export interface FoldInput {
  targets: PlanTarget[];
  logs: FoldLog[];
  /** Set 1's weight, as the athlete entered it. 0 for bodyweight. */
  opener: number;
  /** Smallest load step this exercise's equipment allows. */
  increment: number;
}

export interface FoldResult {
  setIndex: number;
  target: PlanTarget;
  kg: number;
  message: string;
}

/**
 * What the next set should weigh, and the one line explaining it.
 *
 * Returns null when the exercise is finished. The message is part of the
 * contract, not decoration: the parity gate asserts on it, because a number
 * with no reason attached is what athletes override.
 */
export function foldExercise({ targets, logs, opener, increment }: FoldInput): FoldResult | null {
  const setIndex = logs.length;
  if (setIndex >= targets.length) return null;

  const target = targets[setIndex];
  const inc = increment > 0 ? increment : 1;

  if (!(opener > 0)) return { setIndex, target, kg: 0, message: 'bodyweight' };
  if (setIndex === 0) {
    return { setIndex, target, kg: opener, message: 'opener — everything works from here' };
  }

  const state = walkLogs(logs);
  const anchor = anchorFor(opener, targets[0]);

  if (target.reps === 'max') {
    // A max set is not priced off the plan — it is set 1's weight, minus any
    // back-off the session has earned, so the athlete arrives fresh enough to
    // make the rep count mean something.
    const base = logs[0] ? logs[0].kg : opener;
    const ground = state.last != null && state.last.felt >= state.last.target.rpe + 1;
    const kg = roundToIncrement(base * (state.locked ? state.adj : 1) * (ground ? 0.95 : 1), inc);
    return {
      setIndex,
      target,
      kg,
      message:
        kg < base
          ? 'set 1 minus the back-off — arrive fresh'
          : 'back to set 1’s weight — count the reps',
    };
  }

  const planned = plannedKg(anchor, target);
  let want = planned * state.adj;
  // One easy set may nudge by at most a single increment, however generous the
  // rating was. The rest of the correction waits for a second easy set.
  if (!state.locked && state.easyRun === 1) want = Math.min(want, planned + inc);

  const kg = roundToIncrement(want, inc);
  const plan = roundToIncrement(planned, inc);
  const last = state.last;

  let message: string;
  if (state.locked && kg < plan && last) {
    message = `backed off — your ${last.reps} @ ${last.felt} was harder than asked`;
  } else if (kg === plan && state.easyRun >= 1) {
    message =
      Math.abs(want - planned) < inc && inc >= 2
        ? `holding — the next jump is ${inc} kg, chase clean reps instead`
        : 'holding — one easy set is not evidence yet';
  } else if (kg > plan) {
    message =
      state.easyRun >= 2
        ? 'two easy sets — full correction'
        : `one jump up — your ${last?.reps} @ ${last?.felt} was easy`;
  } else {
    message = 'on plan';
  }

  return { setIndex, target, kg, message };
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `pnpm --filter @hybrid/engine exec vitest run src/fold.test.ts`
Expected: PASS — 30 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/fold.ts packages/engine/src/fold.test.ts
git commit -m "Answer the whole question in one call: foldExercise"
```

---

### Task 5: Export the fold, and adapt an engine Exercise to it

`foldExercise` takes plain numbers. The engine's `Exercise<LoggedSet>` stores `t` and `rpe` as free-text strings (`"8"`, `"max"`, `"W10"`, `"5 @80%"`) and records values in `aVal`/`aVal2`/`felt`. One adapter does that translation, in one place, so no caller parses set text itself.

**Files:**
- Modify: `packages/engine/src/fold.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/src/fold.test.ts`

**Interfaces:**
- Consumes: `repFloorOf`, `isWarmup`, `rpeCenterOf` from `./autoreg`; `saneKg` from `./num`; `Exercise`, `LoggedSet` from `./types`.
- Produces: `foldFromExercise(ex: Exercise<LoggedSet>, increment: number): FoldResult | null`, exported from `packages/engine/src/index.ts` alongside `foldExercise` and its types.

- [ ] **Step 1: Write the failing test**

Append to `packages/engine/src/fold.test.ts`:

```ts
import { foldFromExercise } from './fold';
import type { Exercise, LoggedSet } from './types';

const ex = (sets: LoggedSet[]): Exercise<LoggedSet> => ({
  id: 'e1', name: 'Back Squat', mode: 'reps_kg', sets,
});

describe('foldFromExercise', () => {
  it('reads the opener from set 1’s recorded weight once it is done', () => {
    const r = foldFromExercise(ex([
      { t: '10', rpe: '7', aVal: '60', aVal2: '10', felt: '7', done: true },
      { t: '8', rpe: '8' },
    ]), 2.5)!;
    expect(r.setIndex).toBe(1);
    expect(r.kg).toBe(62.5);
  });

  it('ignores warm-up sets, so an empty bar never teaches the working weight', () => {
    const r = foldFromExercise(ex([
      { t: 'W10', rpe: '5', aVal: '20', aVal2: '10', felt: '3', done: true },
      { t: '10', rpe: '7', aVal: '60', aVal2: '10', felt: '7', done: true },
      { t: '8', rpe: '8' },
    ]), 2.5)!;
    expect(r.kg).toBe(62.5);
  });

  it('stops at the first unfinished set', () => {
    const r = foldFromExercise(ex([
      { t: '10', rpe: '7', aVal: '60', aVal2: '10', felt: '7', done: true },
      { t: '8', rpe: '8' },
      { t: '6', rpe: '9' },
    ]), 2.5)!;
    expect(r.setIndex).toBe(1);
  });

  it('reads a max target out of the set text', () => {
    const r = foldFromExercise(ex([
      { t: '10', rpe: '7', aVal: '60', aVal2: '10', felt: '7', done: true },
      { t: 'max', rpe: '10' },
    ]), 2.5)!;
    expect(r.target.reps).toBe('max');
  });

  it('returns null for an exercise with no working sets at all', () => {
    expect(foldFromExercise(ex([{ t: 'W10', rpe: '5' }]), 2.5)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @hybrid/engine exec vitest run src/fold.test.ts`
Expected: FAIL — `foldFromExercise is not a function`.

- [ ] **Step 3: Implement the minimal code to make the test pass**

Append to `packages/engine/src/fold.ts` (adding `import { isWarmup, repFloorOf, rpeCenterOf } from './autoreg';`, `import { saneKg } from './num';` and `import type { Exercise, LoggedSet } from './types';` at the top):

```ts
/** A planned set's rep target, read out of its free-text `t`. */
function targetRepsOf(t: string | undefined): number | 'max' {
  if (/max/i.test(t || '')) return 'max';
  const floor = repFloorOf(t);
  return floor > 0 ? floor : 8;
}

/**
 * Run the fold over an engine exercise.
 *
 * Warm-up sets are dropped before anything else happens — they are real work
 * the athlete performs, but they must never reach a working weight. That rule
 * belongs here, once, rather than at each call site.
 */
export function foldFromExercise(
  ex: Exercise<LoggedSet>,
  increment: number,
): FoldResult | null {
  const working = ex.sets.filter((st) => !isWarmup(st));
  if (!working.length) return null;

  const targets: PlanTarget[] = working.map((st) => ({
    reps: targetRepsOf(st.t),
    rpe: rpeCenterOf(st),
  }));

  const logs: FoldLog[] = [];
  for (let i = 0; i < working.length; i++) {
    const st = working[i];
    if (!st.done) break;
    const reps = parseInt(String(st.aVal2), 10) || 0;
    const felt = parseFloat(String(st.felt));
    if (!(reps > 0) || !Number.isFinite(felt)) break;
    logs.push({ reps, kg: saneKg(st.aVal), felt, target: targets[i] });
  }

  const opener = logs.length ? logs[0].kg : saneKg(working[0].aVal);
  return foldExercise({ targets, logs, opener, increment });
}
```

Then add to `packages/engine/src/index.ts`, beside the other re-exports:

```ts
export {
  foldExercise,
  foldFromExercise,
  anchorFor,
  plannedKg,
  walkLogs,
  repsToFailure,
  e1rmOf,
  kFor,
  clampPct,
  RTF_CAP,
  MAX_STEP_PCT,
} from './fold';
export type { PlanTarget, FoldLog, WalkState, FoldInput, FoldResult } from './fold';
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `pnpm --filter @hybrid/engine exec vitest run src/fold.test.ts && pnpm run typecheck`
Expected: PASS — 35 tests, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/fold.ts packages/engine/src/fold.test.ts packages/engine/src/index.ts
git commit -m "Adapt an engine Exercise to the fold, and export both"
```

---

### Task 6: Migrate `lift.ts`

`liftMoves` banks each movement's next working weight after a session. It currently reads the last working set and calls `computeSetAdjustment`. It now folds the whole exercise.

**Files:**
- Modify: `packages/engine/src/lift.ts:102`
- Test: `packages/engine/src/lift.test.ts`

**Interfaces:**
- Consumes: `foldFromExercise` from Task 5.
- Produces: no signature change. `liftMoves` still returns `{ name, key, from, to, delta, verdict, reps }[]`.

- [ ] **Step 1: Write the failing test**

Append to `packages/engine/src/lift.test.ts`:

```ts
it('banks the folded weight, not the last set’s own adjustment', () => {
  // Two easy sets earn the full correction; the old per-set rule would have
  // moved only off the second one.
  const moves = liftMoves(sessionWith([
    { t: '8', rpe: '8', aVal: '100', aVal2: '8', felt: '7', done: true },
    { t: '8', rpe: '8', aVal: '100', aVal2: '8', felt: '7', done: true },
    { t: '8', rpe: '8' },
  ]));
  expect(moves).toHaveLength(1);
  expect(moves[0].to).toBeGreaterThan(100);
});

it('does not bank a rise from an easy set that followed a hard one', () => {
  const moves = liftMoves(sessionWith([
    { t: '8', rpe: '8', aVal: '100', aVal2: '8', felt: '9', done: true },
    { t: '8', rpe: '8', aVal: '100', aVal2: '8', felt: '7', done: true },
    { t: '8', rpe: '8' },
  ]));
  expect(moves[0].to).toBeLessThan(100);
});
```

Add the `sessionWith` helper at the top of the file if it is not already there:

```ts
const sessionWith = (sets: LoggedSet[]): Session => ({
  id: 's1', date: '2026-08-12', status: 'done',
  blocks: [{ id: 'b1', exercises: [{ id: 'e1', name: 'Back Squat', mode: 'reps_kg', sets }] }],
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @hybrid/engine exec vitest run src/lift.test.ts`
Expected: FAIL — the second test fails, because the old rule moves up off the last easy set.

- [ ] **Step 3: Write the implementation**

In `packages/engine/src/lift.ts`, replace the `computeSetAdjustment` call at line 102 and the `lastWorkingSet` lookup feeding it:

```ts
      const folded = foldFromExercise(ex, AUTOREG.plateIncrement);
      if (!folded || folded.kg <= 0) return;
      const st = lastWorkingSet(ex);
      if (!st) return;
      const from = saneKg(st.aVal);
      const reps = parseInt(String(st.aVal2), 10) || 0;
      if (!(reps > 0)) return;
      seen.add(key);
      out.push({
        name,
        key,
        from,
        to: folded.kg,
        delta: Math.round((folded.kg - from) * 100) / 100,
        verdict: folded.message,
        reps,
      });
```

Update the import on line 2 to drop `computeSetAdjustment` and add `foldFromExercise` from `./fold`, and import `AUTOREG` from `./constants` if it is not already imported.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `pnpm --filter @hybrid/engine exec vitest run src/lift.test.ts`
Expected: PASS. If the pre-existing `liftMoves` tests fail, read each failure and decide whether the new expectation is correct — do not edit an assertion to make it green without understanding why it moved.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/lift.ts packages/engine/src/lift.test.ts
git commit -m "Bank the folded weight in liftMoves, not the last set's own delta"
```

---

### Task 7: Migrate `logger.ts`

`prefillPrimary` fills a set's weight field. Same swap.

**Files:**
- Modify: `packages/engine/src/logger.ts:221`
- Test: `packages/engine/src/logger.test.ts`

**Interfaces:**
- Consumes: `foldFromExercise` from Task 5.
- Produces: no signature change.

- [ ] **Step 1: Write the failing test**

Append to `packages/engine/src/logger.test.ts`:

```ts
it('prefills from the fold, so two easy sets earn more than one does', () => {
  const one = prefillFor([
    { t: '8', rpe: '8', aVal: '100', aVal2: '8', felt: '7', done: true },
    { t: '8', rpe: '8' },
  ]);
  const two = prefillFor([
    { t: '8', rpe: '8', aVal: '100', aVal2: '8', felt: '7', done: true },
    { t: '8', rpe: '8', aVal: '100', aVal2: '8', felt: '7', done: true },
    { t: '8', rpe: '8' },
  ]);
  expect(Number(two)).toBeGreaterThan(Number(one));
});
```

Add the `prefillFor` helper if the file does not already have an equivalent — it should build an exercise from the given sets and call `prefillPrimary` for the first set with `done` unset.

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @hybrid/engine exec vitest run src/logger.test.ts`
Expected: FAIL — under the old rule both prefills are identical.

- [ ] **Step 3: Write the implementation**

In `packages/engine/src/logger.ts`, replace the `computeSetAdjustment` call at line 221:

```ts
    if (isLiftMode(ex.mode) && !warm && p.done) {
      const folded = foldFromExercise(ex, AUTOREG.plateIncrement);
      if (folded && folded.kg > 0) return String(folded.kg);
    }
    return p.aVal;
```

Update the import on line 1 to drop `computeSetAdjustment` and add `foldFromExercise` from `./fold`.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `pnpm --filter @hybrid/engine exec vitest run src/logger.test.ts src/parity.test.ts`
Expected: PASS. `parity.test.ts` asserts prefill behaviour across modules — if it fails, read the failure before touching it.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/logger.ts packages/engine/src/logger.test.ts
git commit -m "Prefill from the fold, so the logger and the ledger agree"
```

---

### Task 8: Migrate the two app Loggers

`apps/web/src/screens/Logger.tsx` and `apps/mobile/src/screens/Logger.tsx` both import `computeSetAdjustment`. These screens are deleted in slices 4 and 6, but they must compile now — a slice that leaves the repo red is not a slice.

**Files:**
- Modify: `apps/web/src/screens/Logger.tsx`
- Modify: `apps/mobile/src/screens/Logger.tsx`
- Modify: `apps/mobile/src/screens/logger.test.tsx`

**Interfaces:**
- Consumes: `foldFromExercise` from Task 5, imported from `@hybrid/engine`.
- Produces: nothing. These files are deleted in later slices.

- [ ] **Step 1: Find every call site**

Run: `grep -n "computeSetAdjustment" apps/web/src/screens/Logger.tsx apps/mobile/src/screens/Logger.tsx apps/mobile/src/screens/logger.test.tsx`

- [ ] **Step 2: Replace each call**

Each site has the exercise in scope. Replace

```ts
computeSetAdjustment(reps, felt, repFloorOf(st.t), weight, rpeCenterOf(st)).newWeight
```

with

```ts
(foldFromExercise(ex, AUTOREG.plateIncrement)?.kg ?? weight)
```

and update the import to pull `foldFromExercise` and `AUTOREG` from `@hybrid/engine` instead of `computeSetAdjustment`.

- [ ] **Step 3: Run typecheck and the app tests**

Run: `pnpm run typecheck && pnpm --filter @hybrid/mobile test`
Expected: PASS. Any assertion in `logger.test.tsx` that pinned an old per-set number needs its expectation re-derived from the fold — recompute it by hand and say so in the commit message, do not nudge the number until it goes green.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/screens/Logger.tsx apps/mobile/src/screens/Logger.tsx apps/mobile/src/screens/logger.test.tsx
git commit -m "Point both app Loggers at the fold, ahead of their replacement"
```

---

### Task 9: Delete `computeSetAdjustment` and replace its golden vectors

The last step, and the one that makes the rule single-owner. Nothing may import `computeSetAdjustment` when this task is done, because it will not exist.

**Files:**
- Modify: `packages/engine/src/autoreg.ts` — delete `computeSetAdjustment`
- Modify: `packages/engine/src/autoreg.test.ts` — delete its tests
- Modify: `packages/engine/src/golden.test.ts` — swap the vector suite
- Modify: `packages/engine/src/adaptive/strength.ts:257` — the comment referring to it
- Modify: `packages/engine/src/index.ts` — drop the export
- Delete: `packages/engine/test/golden/computeSetAdjustment.json`
- Create: `packages/engine/test/golden/foldExercise.json`

**Interfaces:**
- Consumes: `foldExercise` from Task 4.
- Produces: nothing new. This task only removes.

- [ ] **Step 1: Prove nothing still calls it**

Run: `grep -rn "computeSetAdjustment" apps packages --include=*.ts --include=*.tsx | grep -v node_modules`
Expected: only `autoreg.ts`, `autoreg.test.ts`, `golden.test.ts`, `index.ts` and the comment in `adaptive/strength.ts`. If an app file still appears, Task 8 is unfinished — go back.

- [ ] **Step 2: Write the golden vectors for the fold**

Create `packages/engine/test/golden/foldExercise.json`. Each entry is an input and its expected output. Cover, at minimum, one case per branch of `foldExercise`:

```json
[
  { "targets": [{"reps":10,"rpe":7},{"reps":8,"rpe":8}], "logs": [], "opener": 60, "increment": 2.5,
    "out": { "setIndex": 0, "kg": 60, "message": "opener — everything works from here" } },
  { "targets": [{"reps":10,"rpe":7},{"reps":8,"rpe":8}],
    "logs": [{"reps":10,"kg":60,"felt":7,"target":{"reps":10,"rpe":7}}],
    "opener": 60, "increment": 2.5,
    "out": { "setIndex": 1, "kg": 62.5, "message": "on plan" } },
  { "targets": [{"reps":10,"rpe":7},{"reps":8,"rpe":8}],
    "logs": [{"reps":10,"kg":60,"felt":9,"target":{"reps":10,"rpe":7}}],
    "opener": 60, "increment": 2.5,
    "out": { "setIndex": 1, "kg": 60, "message": "backed off — your 10 @ 9 was harder than asked" } },
  { "targets": [{"reps":10,"rpe":7},{"reps":8,"rpe":8}],
    "logs": [{"reps":4,"kg":60,"felt":7,"target":{"reps":10,"rpe":7}}],
    "opener": 60, "increment": 2.5,
    "out": { "setIndex": 1, "kg": 57.5, "message": "backed off — your 4 @ 7 was harder than asked" } },
  { "targets": [{"reps":10,"rpe":7},{"reps":"max","rpe":10}],
    "logs": [{"reps":10,"kg":60,"felt":7,"target":{"reps":10,"rpe":7}}],
    "opener": 60, "increment": 2.5,
    "out": { "setIndex": 1, "kg": 60, "message": "back to set 1’s weight — count the reps" } },
  { "targets": [{"reps":10,"rpe":7},{"reps":8,"rpe":8}], "logs": [], "opener": 0, "increment": 2.5,
    "out": { "setIndex": 0, "kg": 0, "message": "bodyweight" } }
]
```

Every `out` value must be computed by hand from the rule and checked, not copied from a run of the code. A golden vector generated by the thing it tests proves nothing.

- [ ] **Step 3: Swap the suite in `golden.test.ts`**

Replace the `computeSetAdjustment` import and its `it(...)` block with:

```ts
import foldV from '../test/golden/foldExercise.json';

  it('foldExercise', () => {
    for (const v of foldV) {
      const got = foldExercise({
        targets: v.targets as PlanTarget[],
        logs: v.logs as FoldLog[],
        opener: v.opener,
        increment: v.increment,
      });
      expect(got, JSON.stringify(v)).toEqual(expect.objectContaining(v.out));
    }
  });
```

Update the import block at the top of the file: drop `computeSetAdjustment`, add `foldExercise` and the types.

- [ ] **Step 4: Delete the old rule**

- Delete the `computeSetAdjustment` function and its doc comment from `packages/engine/src/autoreg.ts`.
- Delete `packages/engine/test/golden/computeSetAdjustment.json`.
- Delete the `computeSetAdjustment` tests from `packages/engine/src/autoreg.test.ts`.
- Drop the export from `packages/engine/src/index.ts`.
- Rewrite the comment at `packages/engine/src/adaptive/strength.ts:257` to name `foldExercise` and describe what it actually does now: a missed set is scored at effective RPE 10.5 and locks the exercise, so no later easy set raises the load again.
- If `SetAdjustment` in `types.ts` now has no consumers, delete that type too. Check with `grep -rn "SetAdjustment" packages apps --include=*.ts | grep -v node_modules`.

- [ ] **Step 5: Run everything**

Run: `pnpm run typecheck && pnpm run test && pnpm run check:ecosystem`
Expected: all pass. Read every changed golden diff before accepting it.

- [ ] **Step 6: Commit**

```bash
git add -A packages/engine apps
git commit -m "Delete computeSetAdjustment — the fold is the only coaching rule now"
```

---

## Self-Review

Checked against slice 1 of the spec:

- *"New `packages/engine/src/fold.ts` owns it, exporting `foldExercise`"* — Tasks 1–4.
- *"`computeSetAdjustment` is deleted, not left beside it"* — Task 9, with Step 1 proving no callers remain first.
- *"Its call sites migrate: `src/lift.ts:102`, `src/logger.ts:221`, and the comment at `src/adaptive/strength.ts:257`"* — Tasks 6, 7, and Task 9 Step 4.
- *"The golden vectors are regenerated, and the regeneration is reviewed as a behaviour change"* — Task 9 Steps 2 and 5, with the rule that a vector computed by the code under test proves nothing.
- *"Done when typecheck and the full test run pass"* — Task 9 Step 5.

One gap the spec did not anticipate and this plan adds: the two app Loggers also import `computeSetAdjustment`, so deleting it without Task 8 leaves the repo red. Task 8 migrates them even though slices 4 and 6 delete those files later.

Type consistency: `FoldResult.kg` is the name used in Tasks 4–8; `PlanTarget.reps` is `number | 'max'` throughout; `foldFromExercise(ex, increment)` has the same two arguments at every call site.
