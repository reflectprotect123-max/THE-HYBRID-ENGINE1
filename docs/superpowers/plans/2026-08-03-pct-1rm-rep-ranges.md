# % of 1RM + Rep Ranges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a coach prescribe a set's weight as a percentage of the athlete's best logged e1RM (flat or a ramping range keyed to each set's own RPE), and let `reps_kg`-mode sets carry a rep range the same way `seconds`-mode already does, per `docs/superpowers/specs/2026-08-02-pct-1rm-rep-ranges-design.md`.

**Architecture:** One new additive field on `PlannedSet` (`pct1rm?: { lo: number; hi: number }`), one new pure engine module (`packages/engine/src/pct1rm.ts`) computing the per-set percentage and prescribed kg, a small new all-time e1RM lookup (`bestE1rmForMovement` in `session.ts`), two small `logger.ts` changes (`targetLine` grows a `% of 1RM` suffix, `prefillPrimary` grows a pct1rm branch), and matching UI additions to Planner/Builder and Logger on both `apps/web` and `apps/mobile`. Rep ranges for `reps_kg` need **no engine change** — `repFloorOf`/`repTopOf` already parse "8-12" mode-agnostically; only the Builder's copy already documents this today.

**Tech Stack:** TypeScript, `packages/engine` (Vitest), React + Vite (`apps/web`), React Native + Jest/RNTL (`apps/mobile`), Playwright (`checks/react-smoke.mjs`).

## Global Constraints

- Purely additive: no existing `PlannedSet`/`Exercise`/`Workout` field changes shape or meaning. `packages/engine/test/emit.test.ts:14` (`expect(emit.newSet()).toEqual({ t: '', rpe: '' })`) must keep passing untouched — never write `pct1rm: undefined` onto a set; omit the key entirely when clearing it.
- No manually-entered training max anywhere. The only 1RM source is the engine's own logged history (`bestE1rmForMovement`, new).
- Weight rounds through `roundToIncrement(kg, AUTOREG.plateIncrement)` (`packages/engine/src/num.ts` + `packages/engine/src/constants.ts`) — the exact call `nextWorkingWeight` already uses (`packages/engine/src/lift.ts:179`) — every time a pct1rm kg is computed.
- Warm-ups (`isWarmup(st)`, `packages/engine/src/autoreg.ts:17`) are excluded from every pct1rm computation, same as everywhere else in this codebase.
- Every engine change ships to both `apps/web` and `apps/mobile` in the same pass — the two apps must never disagree on what a set means.
- One task = one commit. Run `pnpm run verify` (typecheck + engine/web/mobile unit tests + build + CSP + react-smoke + deploy-smoke) from the repo root after every task; it must exit 0 before moving on.
- Golden suite (`packages/engine/test/golden.test.ts`) must stay unchanged at its current count — nothing in this plan touches any code path it exercises.
- Commit message convention (matches this repo's history): `area: short description` — `engine: ...`, `web: ...`, `mobile: ...`.

## Decision: guided-flow is explicitly OUT of scope for this plan

The spec left open whether `packages/guided-flow` (the step-by-step builder) gets this feature in the same pass. Deciding it now, as this plan's own scope call:

**Deferred to a future follow-up plan.** `packages/guided-flow/src/flowSteps.ts` hardcodes `LIFT_SEQUENCE = ['block-type', 'movement', 'sets', 'reps', 'rpe']` — a strictly sequential, one-field-per-screen model with no `mode` concept at all (`'seconds'` mode isn't reachable through the guided flow today either). Fitting a 4-way mode selector plus a conditional %-range pair into that shape means inserting new steps into the sequence, which is materially riskier and larger than the table-form Planner/Builder change this plan makes, and touches a component neither app's dense-editor Builder shares any code with. Shipping the dense-editor version first, verified and used, is the safer sequencing — the guided-flow version can follow once the % ramp UX has been used for real and is worth carrying into a second, harder-to-edit-later editor.

---

## Task 1: Engine — `pct1rm` field + pure percentage/kg math

**Files:**
- Modify: `packages/engine/src/types.ts:24-28` (`PlannedSet` interface)
- Create: `packages/engine/src/pct1rm.ts`
- Test: `packages/engine/test/pct1rm.test.ts`

**Interfaces:**
- Consumes: `isWarmup(st: Pick<AnySet,'t'>): boolean` (`./autoreg`), `roundToIncrement(v: number, inc: number): number` (`./num`), `AUTOREG.plateIncrement` (`./constants`), `AnySet`/`Exercise` (`./types`).
- Produces: `pctForSet(ex: Exercise<AnySet>, si: number): number | null`, `prescribedKgForSet(ex: Exercise<AnySet>, si: number, bestE1rm: number): number | null` — both consumed by Task 3 (`logger.ts`) and Task 4/5 (Builder UI badge).

- [ ] **Step 1: Add the field to `PlannedSet`**

Edit `packages/engine/src/types.ts`, lines 24-28:

```ts
/** What a coach or planner authors. Never carries logged values. */
export interface PlannedSet {
  t: string;
  rpe: string;
  /** Weight prescription as a percentage of the movement's best logged
   *  e1RM. Absent means "no prescription — athlete's own call", same as
   *  today. lo === hi is a flat percentage; lo < hi ramps across this
   *  exercise's rated sets by where each set's own RPE falls between the
   *  exercise's lowest and highest authored RPE. Never present on a
   *  warm-up set. */
  pct1rm?: { lo: number; hi: number };
}
```

- [ ] **Step 2: Write the failing tests for `pctForSet`**

Create `packages/engine/test/pct1rm.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { pctForSet, prescribedKgForSet } from '../src/pct1rm';
import type { Exercise, LoggedSet } from '../src/types';

const ex = (sets: LoggedSet[]): Exercise<LoggedSet> => ({
  id: 'e1',
  name: 'Back squat',
  mode: 'reps_kg',
  sets,
});

describe('pctForSet', () => {
  it('a flat percentage (lo === hi) applies to every set regardless of RPE', () => {
    const e = ex([
      { t: '5', rpe: '7', pct1rm: { lo: 65, hi: 65 } },
      { t: '5', rpe: '9', pct1rm: { lo: 65, hi: 65 } },
    ]);
    expect(pctForSet(e, 0)).toBe(65);
    expect(pctForSet(e, 1)).toBe(65);
  });

  it('ramps a range across authored RPE: 60-65% at RPE 7/8/9 -> 60/62.5/65', () => {
    const e = ex([
      { t: '5', rpe: '7', pct1rm: { lo: 60, hi: 65 } },
      { t: '5', rpe: '8', pct1rm: { lo: 60, hi: 65 } },
      { t: '5', rpe: '9', pct1rm: { lo: 60, hi: 65 } },
    ]);
    expect(pctForSet(e, 0)).toBe(60);
    expect(pctForSet(e, 1)).toBe(62.5);
    expect(pctForSet(e, 2)).toBe(65);
  });

  it('gives every set the ceiling when every rated set shares the same RPE', () => {
    const e = ex([
      { t: '5', rpe: '8', pct1rm: { lo: 60, hi: 65 } },
      { t: '5', rpe: '8', pct1rm: { lo: 60, hi: 65 } },
    ]);
    expect(pctForSet(e, 0)).toBe(65);
    expect(pctForSet(e, 1)).toBe(65);
  });

  it('excludes a warm-up set from the RPE spread even if it carried pct1rm', () => {
    const e = ex([
      { t: 'W10', rpe: '4', pct1rm: { lo: 60, hi: 65 } },
      { t: '5', rpe: '8', pct1rm: { lo: 60, hi: 65 } },
      { t: '5', rpe: '9', pct1rm: { lo: 60, hi: 65 } },
    ]);
    // If the warm-up's RPE 4 leaked into the spread, set 1 (RPE 8) would not
    // read as the floor of the two RATED sets.
    expect(pctForSet(e, 1)).toBe(60);
    expect(pctForSet(e, 2)).toBe(65);
  });

  it('returns null for a set with no pct1rm', () => {
    const e = ex([{ t: '5', rpe: '8' }]);
    expect(pctForSet(e, 0)).toBeNull();
  });
});

describe('prescribedKgForSet', () => {
  it('computes pct-of-e1RM and rounds to the plate increment', () => {
    const e = ex([{ t: '5', rpe: '8', pct1rm: { lo: 65, hi: 65 } }]);
    // 65% of 116.67 = 75.833..., rounds to the nearest 2.5kg plate: 75.
    expect(prescribedKgForSet(e, 0, 116.67)).toBe(75);
  });

  it('returns null when the set carries no pct1rm', () => {
    const e = ex([{ t: '5', rpe: '8' }]);
    expect(prescribedKgForSet(e, 0, 116.67)).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @hybrid/engine test -- pct1rm`
Expected: FAIL — `Cannot find module '../src/pct1rm'`

- [ ] **Step 4: Implement `packages/engine/src/pct1rm.ts`**

```ts
import { isWarmup } from './autoreg';
import { bestE1rmForMovement } from './session';
import { roundToIncrement } from './num';
import { AUTOREG } from './constants';
import type { AnySet, Exercise, Session } from './types';

/*
 * The RPE -> %1RM ramp.
 *
 * A coach authors ONE range per exercise, written onto every rated (non-
 * warm-up) set; the per-set percentage falls out of where that set's own
 * authored RPE sits between the exercise's lowest and highest rated RPE.
 * Flat (lo === hi) skips the ramp entirely.
 */

/** This set's own prescribed percentage of 1RM, or null if it carries none. */
export function pctForSet(ex: Exercise<AnySet>, si: number): number | null {
  const st = ex.sets[si];
  const pr = st && st.pct1rm;
  if (!st || !pr) return null;
  if (pr.lo === pr.hi) return pr.hi;

  const rated = ex.sets.filter((s) => !isWarmup(s) && s.pct1rm);
  const rpes = rated.map((s) => Number(s.rpe)).filter((n) => Number.isFinite(n));
  const rpe = Number(st.rpe);
  if (!rpes.length || !Number.isFinite(rpe)) return pr.hi;

  const rpeMin = Math.min(...rpes);
  const rpeMax = Math.max(...rpes);
  if (rpeMax === rpeMin) return pr.hi;

  return pr.lo + ((rpe - rpeMin) / (rpeMax - rpeMin)) * (pr.hi - pr.lo);
}

/** This set's prescribed weight, rounded to a real plate increment. */
export function prescribedKgForSet(ex: Exercise<AnySet>, si: number, bestE1rm: number): number | null {
  const pct = pctForSet(ex, si);
  if (pct == null) return null;
  return roundToIncrement((pct / 100) * bestE1rm, AUTOREG.plateIncrement);
}

/** The Logger's "why this weight" sub-line for a pct1rm set, or '' if there's
 *  no logged e1RM yet to compute one from. */
export function pct1rmSourceNote(ex: Exercise<AnySet>, si: number, sessions: Session[]): string {
  const st = ex.sets[si];
  if (!st || !st.pct1rm) return '';
  const best = bestE1rmForMovement(ex.name, sessions);
  if (!best) return '';
  return `from your best e1RM · ${ex.name} ${Math.round(best.e1)}kg`;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @hybrid/engine test -- pct1rm`
Expected: PASS (all 7 cases). This will still fail to compile until Task 2 adds `bestE1rmForMovement` — proceed to Task 2 before running this if the test runner type-checks first; otherwise this step's FAIL is expected to be a missing-export TypeScript error, not a logic failure, and Task 2 resolves it.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/types.ts packages/engine/src/pct1rm.ts packages/engine/test/pct1rm.test.ts
git commit -m "engine: add pct1rm field and RPE-ramp percentage/kg math"
```

---

## Task 2: Engine — `bestE1rmForMovement` (all-time e1RM lookup)

**Files:**
- Modify: `packages/engine/src/session.ts` (add new export near `bestE1rmByLift` at line 521)
- Test: `packages/engine/test/session.test.ts`

**Interfaces:**
- Consumes: `bestE1rmByLift(sessions: Session[], fromMs: number, toMs: number): Map<string, {name; e1; kg; reps}>` (already exists, `packages/engine/src/session.ts:521`).
- Produces: `bestE1rmForMovement(name: string, sessions: Session[], nowMs?: number): { e1: number; kg: number; reps: number } | null` — consumed by Task 1's `pct1rmSourceNote` and Task 3's `prefillPrimary`.

- [ ] **Step 1: Write the failing test**

Add to `packages/engine/test/session.test.ts` (append a new `describe` block; it already imports `describe, expect, it` and has an `ex`/`set` fixture pattern — add these alongside them):

```ts
import { bestE1rmForMovement } from '../src/session';

describe('bestE1rmForMovement', () => {
  const doneSet = (kg: string, reps: string): LoggedSet => ({
    t: String(reps), rpe: '8', aVal: kg, aVal2: reps, done: true,
  });
  const session = (id: string, at: number, kg: string, reps: string): Session => ({
    id,
    date: '2026-01-01',
    status: 'completed',
    completedAt: at,
    blocks: [{ id: 'b', heading: 'Main', exercises: [{ id: 'e', name: 'Back squat', mode: 'reps_kg', sets: [doneSet(kg, reps)] }] }],
  });

  it('picks the best logged e1RM across ALL sessions, not just a recent window', () => {
    const sessions = [session('s1', 1000, '100', '5'), session('s2', 2000, '110', '3')];
    const best = bestE1rmForMovement('Back squat', sessions);
    // 110x3 -> e1 = 110 * (1 + 3/30) = 121; 100x5 -> e1 = 100 * (1 + 5/30) = 116.67.
    expect(best?.e1).toBeCloseTo(121, 2);
  });

  it('is case- and whitespace-insensitive on the movement name, matching every other keyer', () => {
    const sessions = [session('s1', 1000, '100', '5')];
    expect(bestE1rmForMovement('back squat ', sessions)?.kg).toBe(100);
  });

  it('returns null for a movement with no logged history', () => {
    expect(bestE1rmForMovement('Deadlift', [])).toBeNull();
  });
});
```

(Add `import type { LoggedSet, Session } from '../src/types';` to the top-of-file import list if `LoggedSet`/`Session` are not already imported there — `session.test.ts` currently imports `Block, CondBlock, Exercise, LoggedSet, PlannedSet, Session, Workout` from `../src/types`, so both are already available.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @hybrid/engine test -- session.test`
Expected: FAIL — `bestE1rmForMovement is not a function` / import error.

- [ ] **Step 3: Implement `bestE1rmForMovement`**

Add to `packages/engine/src/session.ts`, immediately after the closing brace of `bestE1rmByLift` (line 553):

```ts
/** The best logged e1RM for a movement across ALL history — no window, no
 *  manually-entered training max. Backs the pct1rm feature's weight
 *  prescription: a coach writes "65% of 1RM" and this is where "1RM" comes
 *  from. */
export function bestE1rmForMovement(
  name: string,
  sessions: Session[],
  nowMs: number = Date.now(),
): { e1: number; kg: number; reps: number } | null {
  const map = bestE1rmByLift(sessions, 0, nowMs + 86400000);
  const hit = map.get(String(name || '').trim().toLowerCase());
  return hit ? { e1: hit.e1, kg: hit.kg, reps: hit.reps } : null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @hybrid/engine test -- session.test pct1rm`
Expected: PASS — this also resolves Task 1's Step 5 compile dependency.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/session.ts packages/engine/test/session.test.ts
git commit -m "engine: add bestE1rmForMovement, an all-time e1RM lookup for pct1rm"
```

---

## Task 3: Engine — wire pct1rm into `targetLine`/`prefillPrimary`, export the module

**Files:**
- Modify: `packages/engine/src/logger.ts:1-4` (imports), `:115-120` (`targetLine`), `:172-220` (`prefillPrimary`)
- Modify: `packages/engine/src/index.ts` (add `export * from './pct1rm';`)
- Modify: `packages/engine/test/parity.test.ts:10-17` (imports), `:50-152` (`describe('the guided-logger prefills', ...)`)

**Interfaces:**
- Consumes: `pctForSet`, `prescribedKgForSet` (`./pct1rm`, Task 1), `bestE1rmForMovement` (`./session`, Task 2).
- Produces: `targetLine(ex: Exercise<LoggedSet>, st: LoggedSet, si?: number): string` (new optional third param — existing two-arg call sites still compile but will not show the `% of 1RM` suffix until Task 6/7 pass `si`), `prefillPrimary` unchanged signature, new pct1rm branch.

- [ ] **Step 1: Write the failing tests**

In `packages/engine/test/parity.test.ts`, change the import on line 11 from:

```ts
import { prefillPrimary, prefillSecondary } from '../src/logger';
```

to:

```ts
import { prefillPrimary, prefillSecondary, targetLine } from '../src/logger';
```

Then add two new `it` blocks inside the existing `describe('the guided-logger prefills', ...)` block (after line 151's closing, i.e. as new top-level items in that describe, alongside the existing `today`/`last` fixtures already in scope):

```ts
  it('targetLine appends the computed % of 1RM for a pct1rm set', () => {
    const e = ex('Back squat', [{ t: '5', rpe: '8', pct1rm: { lo: 60, hi: 65 } } as LoggedSet]);
    expect(targetLine(e, e.sets[0], 0)).toBe('5 @8 · 65% of 1RM');
  });

  it('targetLine is unchanged for a set with no pct1rm', () => {
    const e = ex('Back squat', [{ t: '5', rpe: '8' }]);
    expect(targetLine(e, e.sets[0], 0)).toBe('5 @8');
  });

  describe('a pct1rm set prefills the computed kg', () => {
    const histWithE1rm = historySession(
      ex('Front squat', [{ t: '5', rpe: '8', aVal: '100', aVal2: '5', done: true }]),
    );

    it('prefills the rounded prescribed weight when a best e1RM exists', () => {
      const plan = ex('Front squat', [{ t: '5', rpe: '8', pct1rm: { lo: 65, hi: 65 } } as LoggedSet]);
      // 65% of 116.67 (100x5) rounds to 75.
      expect(prefillPrimary(plan, 0, [histWithE1rm])).toBe('75');
    });

    it('stays blank — never guesses — when the movement has no logged history', () => {
      const plan = ex('Brand New Lift', [{ t: '5', rpe: '8', pct1rm: { lo: 65, hi: 65 } } as LoggedSet]);
      expect(prefillPrimary(plan, 0, [])).toBe('');
    });

    it('outranks both the earned working weight and an earlier typed set of the same exercise', () => {
      const earned = { liftProgress: { 'front squat': { kg: 999, at: 2000 } } };
      const plan = ex('Front squat', [
        { t: '5', rpe: '8', aVal: '50', done: true } as LoggedSet,
        { t: '5', rpe: '9', pct1rm: { lo: 65, hi: 70 } } as LoggedSet,
      ]);
      // Set 1's own pct1rm range is {65,70}; with only one rated (pct1rm-
      // carrying) set at RPE 9, rpeMin === rpeMax so pctForSet returns the
      // ceiling, 70. 70% of 116.67 = 81.669, rounds to 82.5.
      expect(prefillPrimary(plan, 1, [histWithE1rm], { settings: earned })).toBe('82.5');
    });

    it('never applies to a warm-up set even if one somehow carried pct1rm', () => {
      // isLiftMode's branch (packages/engine/src/logger.ts's prefillPrimary)
      // unconditionally returns '' at the end of its own block for any
      // reps_kg/amrap set that reaches it without finding an earned weight or
      // a same-kind history match — it never falls through to the final
      // repTopOf(st.t) line, which only runs for NON-lift modes. A warm-up
      // skips nextWorkingWeight (guarded by `if (!warm)`), and
      // histWithE1rm has no warm-up set for 'Front squat' to match against,
      // so this must resolve to ''.
      const plan = ex('Front squat', [{ t: 'W10', rpe: '', pct1rm: { lo: 65, hi: 65 } } as LoggedSet]);
      expect(prefillPrimary(plan, 0, [histWithE1rm])).toBe('');
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @hybrid/engine test -- parity.test`
Expected: FAIL — `targetLine` 3-arg call type errors / wrong string values (pct1rm branch not implemented yet).

- [ ] **Step 3: Implement the `targetLine` change**

Edit `packages/engine/src/logger.ts`, lines 115-120:

```ts
/** The target line on the stage: "5 @8", "max @9", "W10", "5 @8 · 65% of 1RM". */
export function targetLine(ex: Exercise<LoggedSet>, st: LoggedSet, si?: number): string {
  if (ex.mode === 'amrap') return 'max' + (st.rpe ? ' @' + st.rpe : '');
  const t = st.t === 'max' ? 'max' : st.t || '—';
  const base = t + (st.rpe ? ' @' + st.rpe : '');
  if (ex.mode === 'reps_kg' && st.pct1rm && si != null) {
    const pct = pctForSet(ex, si);
    if (pct != null) return base + ` · ${Math.round(pct * 10) / 10}% of 1RM`;
  }
  return base;
}
```

- [ ] **Step 4: Implement the `prefillPrimary` change**

Edit `packages/engine/src/logger.ts`, inside `prefillPrimary` (currently lines 172-220) — insert the new branch immediately after the `if (st.aVal) return st.aVal;` line and before the `warm`/`same` carry-forward loop:

```ts
export function prefillPrimary(
  ex: Exercise<LoggedSet>,
  si: number,
  sessions: Session[] = [],
  ctx: PrefillCtx = {},
): string {
  const st = ex.sets[si];
  if (!st) return '';
  if (st.aVal) return st.aVal;

  // A pct1rm-prescribed set is a fully separate weight path from the earned/
  // carried-forward suggestions below: the coach authored a specific % for
  // THIS set, which the carry-forward loop's "reuse an earlier typed value"
  // rule would silently override with a DIFFERENT set's number. Warm-ups
  // never carry a prescription, matching every other place isWarmup guards
  // working-weight logic.
  if (ex.mode === 'reps_kg' && st.pct1rm && !isWarmup(st)) {
    const best = bestE1rmForMovement(ex.name, sessions);
    if (!best) return '';
    const kg = prescribedKgForSet(ex, si, best.e1);
    return kg != null ? String(kg) : '';
  }

  const warm = isWarmup(st);
  const same = (x: LoggedSet | null | undefined) => !!x && isWarmup(x) === warm;

  for (let i = si - 1; i >= 0; i--) {
    const p = ex.sets[i];
    if (p.aVal && same(p)) return p.aVal;
  }

  if (isLiftMode(ex.mode)) {
    if (!warm) {
      const w = nextWorkingWeight(ex.name, ctx.settings, ctx.whoop);
      if (w) return String(w.kg);
    }

    const last = lastTimeFor(ex.name, sessions);
    if (last) {
      const at = last[si];
      if (at && at.aVal && same(at)) return at.aVal;
      const ls = last.find((x) => x && x.aVal && same(x));
      if (ls && ls.aVal) return ls.aVal;
    }
    return '';
  }

  return st.t && st.t !== 'max' ? repTopOf(st.t) : '';
}
```

- [ ] **Step 5: Add the new imports**

Edit `packages/engine/src/logger.ts`, lines 1-4:

```ts
import { isWarmup, repTopOf } from './autoreg';
import { nextWorkingWeight } from './lift';
import { pctForSet, prescribedKgForSet } from './pct1rm';
import { bestE1rmForMovement, blockExercises, isCond, isLiftMode, isText } from './session';
import type { AnySet, Block, Exercise, LoggedSet, Session, Settings, WhoopSample } from './types';
```

- [ ] **Step 6: Export the new module from the package index**

Edit `packages/engine/src/index.ts` — add a line after `export * from './lift';` (or anywhere in the existing alphabetical-ish list; match the file's own ordering by adding it right after the `session`/`lift` exports):

```ts
export * from './pct1rm';
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @hybrid/engine test`
Expected: PASS — full engine suite, including the new `parity.test.ts` cases, `pct1rm.test.ts`, and `session.test.ts`'s new block. Golden suite count unchanged.

- [ ] **Step 8: Commit**

```bash
git add packages/engine/src/logger.ts packages/engine/src/index.ts packages/engine/test/parity.test.ts
git commit -m "engine: wire pct1rm into targetLine and prefillPrimary"
```

---

## Task 4: Web Builder — 4-way mode selector + per-set %1RM badge

**Files:**
- Modify: `apps/web/src/screens/planner/ExerciseCard.tsx`
- Modify: `apps/web/src/screens/Planner.tsx:1-30` (imports), `:198-241` (`ExerciseCard` invocation)
- Test: `checks/react-smoke.mjs` (new scenario, appended near the other Planner/Builder scenarios)

**Interfaces:**
- Consumes: `pctForSet` (`@hybrid/engine`, Task 1), `isWarmup` (`@hybrid/engine`, already used).
- Produces: `ExerciseCard`'s new `onModeChange`/`onPctChange` props, consumed only by `Planner.tsx` in this same task.

- [ ] **Step 1: Add the mode selector, %-inputs, and per-set badge to `ExerciseCard.tsx`**

Rewrite `apps/web/src/screens/planner/ExerciseCard.tsx` in full:

```tsx
import { fmtRest, isWarmup, pctForSet, rxLine, type Exercise, type LoggedSet } from '@hybrid/engine';
import { Card, LetterChip, cx } from '../../ui';

type PctMode = 'reps' | 'seconds' | 'pctFlat' | 'pctRange';

const MODE_LABEL: Record<PctMode, string> = {
  reps: 'Reps',
  seconds: 'Seconds',
  pctFlat: '% flat + reps',
  pctRange: '% range + reps',
};

function modeOf(ex: Exercise<LoggedSet>): PctMode {
  if (ex.mode === 'seconds') return 'seconds';
  const withPct = ex.sets.find((s) => s.pct1rm);
  if (!withPct || !withPct.pct1rm) return 'reps';
  return withPct.pct1rm.lo === withPct.pct1rm.hi ? 'pctFlat' : 'pctRange';
}

/**
 * One exercise, as a card — collapsed to a single line until opened. Split
 * out of `Planner.tsx`, which had grown past 500 lines doing every block
 * kind's job in one file.
 */
export function ExerciseCard({
  ex,
  letter,
  open,
  listId,
  onToggle,
  onNameChange,
  onSet,
  onAddSet,
  onDelSet,
  onRest,
  onDuplicate,
  onRemove,
  onModeChange,
  onPctChange,
}: {
  ex: Exercise<LoggedSet>;
  letter: string;
  open: boolean;
  /** Which datalist this movement name should offer — prep-first inside a
      warm-up block, logged movements everywhere else. */
  listId: string;
  onToggle: () => void;
  onNameChange: (v: string) => void;
  onSet: (si: number, key: 't' | 'rpe', v: string) => void;
  onAddSet: () => void;
  onDelSet: (si: number) => void;
  onRest: (delta: number) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onModeChange: (mode: PctMode) => void;
  onPctChange: (lo: number, hi: number) => void;
}) {
  const mode = modeOf(ex);
  const pctSet = ex.sets.find((s) => s.pct1rm);

  return (
    <Card className={open ? 'border-gold-line shadow-lift' : undefined}>
      <button className="flex w-full items-center gap-1 text-left" onClick={onToggle}>
        <LetterChip letter={letter} />
        <span className="min-w-0 flex-1">
          <b className="block truncate text-5 font-[750]">{ex.name || 'Exercise'}</b>
          <span className="num block truncate text-3 text-dim">{rxLine(ex)}</span>
        </span>
        <span className="text-6 text-dim">{open ? '▴' : '›'}</span>
      </button>

      {open ? (
        <div className="mt-1.5 border-t border-line pt-1.5">
          <input
            value={ex.name}
            list={listId}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Movement"
            aria-label="movement name"
            className="h-5 w-full rounded-md border border-line bg-well px-1 text-4 outline-none focus:border-gold-line"
          />

          <div className="mt-1.5 flex gap-0.5" role="group" aria-label="target type">
            {(Object.keys(MODE_LABEL) as PctMode[]).map((m) => (
              <button
                key={m}
                onClick={() => onModeChange(m)}
                aria-pressed={mode === m}
                className={cx(
                  'h-4 flex-1 rounded-md border px-1 text-2 font-[650] uppercase tracking-[.08em]',
                  mode === m ? 'border-gold-line bg-gold-wash text-gold2' : 'border-line2 text-dim',
                )}
              >
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>

          {mode === 'pctFlat' || mode === 'pctRange' ? (
            <div className="mt-1 flex items-center gap-1">
              <span className="text-2 font-[750] uppercase tracking-[.14em] text-dim">% of 1RM</span>
              <input
                type="number"
                value={pctSet?.pct1rm?.lo ?? ''}
                onChange={(e) => {
                  const lo = Number(e.target.value) || 0;
                  onPctChange(lo, mode === 'pctFlat' ? lo : (pctSet?.pct1rm?.hi ?? lo));
                }}
                aria-label="percent low"
                className="num h-4 w-12 rounded-md border border-line bg-well px-1 text-center text-4 outline-none focus:border-gold-line"
              />
              {mode === 'pctRange' ? (
                <>
                  <span className="text-3 text-dim">–</span>
                  <input
                    type="number"
                    value={pctSet?.pct1rm?.hi ?? ''}
                    onChange={(e) => onPctChange(pctSet?.pct1rm?.lo ?? 0, Number(e.target.value) || 0)}
                    aria-label="percent high"
                    className="num h-4 w-12 rounded-md border border-line bg-well px-1 text-center text-4 outline-none focus:border-gold-line"
                  />
                </>
              ) : null}
            </div>
          ) : null}

          <div className="mt-1.5 flex flex-col gap-1">
            {ex.sets.map((st, si) => (
              <div key={si} className="flex items-center gap-1">
                <span className={cx('num w-8 shrink-0 text-3 font-[650]', isWarmup(st) ? 'text-gold2' : 'text-dim')}>
                  {isWarmup(st) ? 'Warm' : 'Set ' + (si + 1)}
                </span>
                <input
                  value={st.t}
                  onChange={(e) => onSet(si, 't', e.target.value)}
                  placeholder="reps"
                  aria-label={`target for set ${si + 1}`}
                  className="num h-4 w-14 rounded-md border border-line bg-well px-1 text-center text-4 outline-none focus:border-gold-line"
                />
                <input
                  value={st.rpe}
                  onChange={(e) => onSet(si, 'rpe', e.target.value)}
                  placeholder={isWarmup(st) ? '—' : 'RPE'}
                  aria-label={`target RPE for set ${si + 1}`}
                  className="num h-4 w-12 rounded-md border border-line bg-well px-1 text-center text-4 outline-none focus:border-gold-line"
                />
                {(mode === 'pctFlat' || mode === 'pctRange') && !isWarmup(st) ? (
                  <span className="num text-2 text-gold2" aria-label={`percent of 1RM for set ${si + 1}`}>
                    {(() => {
                      const p = pctForSet(ex, si);
                      return p == null ? '' : `${Math.round(p * 10) / 10}%`;
                    })()}
                  </span>
                ) : null}
                {ex.sets.length > 1 ? (
                  <button
                    onClick={() => onDelSet(si)}
                    aria-label={`remove set ${si + 1}`}
                    className="h-4 w-4 text-3 text-dim hover:text-bad"
                  >
                    ✕
                  </button>
                ) : null}
              </div>
            ))}
            <button
              onClick={onAddSet}
              className="h-4 w-fit rounded-md border border-dashed border-line2 px-1 text-3 text-muted hover:border-gold-line hover:text-gold2"
            >
              ＋ Add set
            </button>
            <p className="max-w-[46ch] text-3 text-dim">
              Type what you want to hit — <b className="text-muted">8</b>, <b className="text-muted">8-12</b>,{' '}
              <b className="text-muted">max</b>. Start with <b className="text-muted">W</b> for a warm-up (
              <b className="text-muted">W</b> or <b className="text-muted">W10</b>).
            </p>
          </div>

          <div className="mt-1.5 flex items-center gap-1">
            <span className="text-2 font-[750] uppercase tracking-[.14em] text-dim">Rest</span>
            <button
              onClick={() => onRest(-15)}
              className="h-4 w-4 rounded-md border border-line2 bg-panel2 text-5 text-muted"
            >
              −
            </button>
            <span className="num w-10 text-center text-4 font-[750]">{fmtRest(ex.rest || 0)}</span>
            <button
              onClick={() => onRest(15)}
              className="h-4 w-4 rounded-md border border-line2 bg-panel2 text-5 text-muted"
            >
              +
            </button>
            <button
              onClick={onDuplicate}
              className="ml-auto h-4 rounded-md border border-line2 px-1 text-3 text-dim hover:text-gold2"
            >
              Duplicate
            </button>
            <button onClick={onRemove} className="h-4 rounded-md border border-line2 px-1 text-3 text-dim hover:text-bad">
              Remove
            </button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
```

- [ ] **Step 2: Wire `onModeChange`/`onPctChange` in `Planner.tsx`**

Edit `apps/web/src/screens/Planner.tsx` — add `isWarmup` to the `@hybrid/engine` import list (line 3-24, insert alphabetically after `fillLinkedSets`):

```ts
import {
  CON_EFFORTS,
  blockExercises,
  duplicateExercise,
  fillLinkedSets,
  isCond,
  isText,
  isWarmup,
  knownMovements,
  newBlock,
  newCondBlock,
  newWarmupBlock,
  newTextBlock,
  newEx,
  newSet,
  sessionLetters,
  type CondFmtKey,
  type EffortKey,
  type LoggedSet,
  type StrengthBlock,
  type TextBlock,
  type Workout,
} from '@hybrid/engine';
```

Then, inside the `<ExerciseCard ... />` invocation (around lines 198-241), add two new props right after `onRest`:

```tsx
                        onRest={(delta) =>
                          edit((d) => {
                            const e2 = (d.blocks[bi] as StrengthBlock<LoggedSet>).exercises[ei];
                            e2.rest = Math.max(0, Math.min(3600, (e2.rest || 0) + delta));
                          })
                        }
                        onModeChange={(mode) =>
                          edit((d) => {
                            const e2 = (d.blocks[bi] as StrengthBlock<LoggedSet>).exercises[ei];
                            if (mode === 'seconds' || mode === 'reps') {
                              e2.mode = mode === 'seconds' ? 'seconds' : 'reps_kg';
                              e2.sets = e2.sets.map((s) => {
                                const { pct1rm, ...rest } = s;
                                return rest as LoggedSet;
                              });
                            } else {
                              e2.mode = 'reps_kg';
                              e2.sets = e2.sets.map((s) =>
                                isWarmup(s) ? s : { ...s, pct1rm: s.pct1rm ?? { lo: 65, hi: 65 } },
                              );
                            }
                          })
                        }
                        onPctChange={(lo, hi) =>
                          edit((d) => {
                            const e2 = (d.blocks[bi] as StrengthBlock<LoggedSet>).exercises[ei];
                            e2.sets = e2.sets.map((s) => (isWarmup(s) ? s : { ...s, pct1rm: { lo, hi } }));
                          })
                        }
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @hybrid/web typecheck` (or `pnpm run typecheck` from root)
Expected: exit 0.

- [ ] **Step 4: Build and write the react-smoke scenario**

Run: `pnpm --filter @hybrid/web build`

Append to `checks/react-smoke.mjs` (near the other Planner-focused scenarios, after the Duplicate scenario):

```js
await t('the % mode selector writes and clears pct1rm on every rated set', async () => {
  const id = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
    const wid = 'pct-src-1';
    db.workouts.push({
      id: wid,
      name: 'Pct Source',
      updatedAt: 1,
      blocks: [
        {
          id: 'pctb1',
          heading: 'Main',
          superset: false,
          exercises: [
            {
              id: 'pcte1',
              name: 'Bench press',
              mode: 'reps_kg',
              rest: 90,
              sets: [
                { t: 'W10', rpe: '' },
                { t: '5', rpe: '8' },
                { t: '5', rpe: '9' },
              ],
            },
          ],
        },
      ],
    });
    localStorage.setItem('hybrid-engine-v1', JSON.stringify(db));
    return wid;
  });

  await page.goto(base + '/planner/' + id, { waitUntil: 'networkidle' });
  await page.click('span:text-is("Bench press")');
  await page.waitForSelector('button:has-text("% range + reps")');
  await page.click('button:has-text("% range + reps")');

  await page.waitForSelector('input[aria-label="percent low"]');
  await page.fill('input[aria-label="percent low"]', '60');
  await page.fill('input[aria-label="percent high"]', '65');

  // Badge on the RPE-9 working set should read the ceiling (65%); the
  // RPE-8 set should read the floor (60%) since those are the only two
  // rated sets.
  await page.waitForSelector('span[aria-label="percent of 1RM for set 2"]');
  const low = await page.textContent('span[aria-label="percent of 1RM for set 2"]');
  const high = await page.textContent('span[aria-label="percent of 1RM for set 3"]');
  assert(low === '60%', 'expected the RPE-8 set badge to read 60%, got: ' + low);
  assert(high === '65%', 'expected the RPE-9 set badge to read 65%, got: ' + high);

  const stored = await page.evaluate(
    (wid) =>
      JSON.parse(localStorage.getItem('hybrid-engine-v1')).workouts.find((w) => w.id === wid).blocks[0].exercises[0]
        .sets,
    id,
  );
  assert(stored[0].pct1rm === undefined, 'a warm-up must never carry pct1rm, got: ' + JSON.stringify(stored[0]));
  assert(
    stored[1].pct1rm.lo === 60 && stored[1].pct1rm.hi === 65,
    'set 2 should store {lo:60,hi:65}, got: ' + JSON.stringify(stored[1].pct1rm),
  );

  // Switching back to Reps clears pct1rm from every set.
  await page.click('button:has-text("Reps")');
  const afterClear = await page.evaluate(
    (wid) =>
      JSON.parse(localStorage.getItem('hybrid-engine-v1')).workouts.find((w) => w.id === wid).blocks[0].exercises[0]
        .sets,
    id,
  );
  assert(
    afterClear.every((s) => !('pct1rm' in s)),
    'switching back to Reps should clear pct1rm from every set, got: ' + JSON.stringify(afterClear),
  );
});
```

- [ ] **Step 5: Run the smoke suite**

Run: `node checks/react-smoke.mjs` (repo root; requires `pnpm --filter @hybrid/web build` to have run first, per the file's own header comment)
Expected: `PASS` for the new scenario and every pre-existing one (no regressions).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/screens/planner/ExerciseCard.tsx apps/web/src/screens/Planner.tsx checks/react-smoke.mjs
git commit -m "web: add the 4-way target-type selector and per-set %1RM badge to Builder"
```

---

## Task 5: Mobile Builder — mirror Task 4

**Files:**
- Modify: `apps/mobile/src/screens/planner/ExerciseCard.tsx`
- Modify: `apps/mobile/src/screens/Planner.tsx:1-33` (imports), `:144-191` (`ExerciseCard` invocation)
- Test: `apps/mobile/test/planner.test.tsx` (new file — no Planner-level test file exists yet on mobile)

**Interfaces:**
- Consumes: same as Task 4 (`pctForSet`, `isWarmup` from `@hybrid/engine`).
- Produces: same new `onModeChange`/`onPctChange` props on the mobile `ExerciseCard`.

- [ ] **Step 1: Add the mode selector, %-inputs, and per-set badge to the mobile `ExerciseCard.tsx`**

Rewrite `apps/mobile/src/screens/planner/ExerciseCard.tsx` in full:

```tsx
import { View } from 'react-native';
import { fmtRest, isWarmup, pctForSet, rxLine, type Exercise, type LoggedSet } from '@hybrid/engine';
import { Btn, Card, Chip, Input, Ltr, T, Tap } from '../../ui';

/** How many name suggestions fit under the field without pushing the sets off. */
const MAX_SUGGEST = 6;

type PctMode = 'reps' | 'seconds' | 'pctFlat' | 'pctRange';

const MODE_LABEL: Record<PctMode, string> = {
  reps: 'Reps',
  seconds: 'Seconds',
  pctFlat: '% flat + reps',
  pctRange: '% range + reps',
};

function modeOf(ex: Exercise<LoggedSet>): PctMode {
  if (ex.mode === 'seconds') return 'seconds';
  const withPct = ex.sets.find((s) => s.pct1rm);
  if (!withPct || !withPct.pct1rm) return 'reps';
  return withPct.pct1rm.lo === withPct.pct1rm.hi ? 'pctFlat' : 'pctRange';
}

/*
 * Movements you have already written, offered back.
 *
 * Not a catalogue — the sessions ARE the catalogue, and `knownMovements`
 * derives this on read. The point is that "Squat" and "Back Squat" are two
 * different lifts to the history, the PR detector and the earned working
 * weight, so the cheapest way to stop a lift fragmenting is to make retyping
 * it unnecessary.
 *
 * Hidden once what you have typed already matches something exactly — at that
 * point the row is only telling you what is already in the box.
 */
function Suggest({ typed, known, onPick }: { typed: string; known: string[]; onPick: (name: string) => void }) {
  const q = String(typed || '').trim().toLowerCase();
  const hits = known.filter((n) => n.toLowerCase() !== q && (!q || n.toLowerCase().includes(q))).slice(0, MAX_SUGGEST);
  if (!hits.length) return null;

  return (
    <View className="mt-0.5 flex-row flex-wrap gap-0.5">
      {hits.map((n) => (
        <Chip key={n} onPress={() => onPick(n)}>
          {n}
        </Chip>
      ))}
    </View>
  );
}

/**
 * One exercise, as a card — collapsed to a single line until opened. Split out
 * of `Planner.tsx`, which had grown past 470 lines doing every block kind's
 * job in one file.
 */
export function ExerciseCard({
  ex,
  letter,
  open,
  suggestPool,
  onToggle,
  onNameChange,
  onSet,
  onAddSet,
  onDelSet,
  onRest,
  onDuplicate,
  onRemove,
  onModeChange,
  onPctChange,
}: {
  ex: Exercise<LoggedSet>;
  letter: string;
  open: boolean;
  /** Prep-first inside a warm-up block, logged movements everywhere else. */
  suggestPool: string[];
  onToggle: () => void;
  onNameChange: (v: string) => void;
  onSet: (si: number, key: 't' | 'rpe', v: string) => void;
  onAddSet: () => void;
  onDelSet: (si: number) => void;
  onRest: (delta: number) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onModeChange: (mode: PctMode) => void;
  onPctChange: (lo: number, hi: number) => void;
}) {
  const mode = modeOf(ex);
  const pctSet = ex.sets.find((s) => s.pct1rm);

  return (
    <Card className={`mb-1 ${open ? 'border-gold-line' : ''}`}>
      <Tap onPress={onToggle} label={`${open ? 'collapse' : 'expand'} ${ex.name || 'exercise'}`}>
        <View className="flex-row items-center gap-1">
          <Ltr>{letter}</Ltr>
          <View className="flex-1">
            <T w="semi" className="text-5 text-text" numberOfLines={1}>
              {ex.name || 'Exercise'}
            </T>
            <T num className="text-3 text-dim" numberOfLines={1}>
              {rxLine(ex)}
            </T>
          </View>
          <T className="text-6 text-dim">{open ? '▴' : '›'}</T>
        </View>
      </Tap>

      {open ? (
        <View className="mt-1.5 border-t border-line pt-1.5">
          <Input
            value={ex.name}
            onChangeText={onNameChange}
            placeholder="Movement"
            accessibilityLabel="movement name"
            className="h-5 rounded-md border border-line bg-well px-1 text-4 text-text"
          />
          <Suggest typed={ex.name} known={suggestPool} onPick={onNameChange} />

          <View className="mt-1.5 flex-row gap-0.5">
            {(Object.keys(MODE_LABEL) as PctMode[]).map((m) => (
              <Tap
                key={m}
                onPress={() => onModeChange(m)}
                label={`${MODE_LABEL[m]} mode`}
                box={{ h: 20 }}
                className={`flex-1 rounded-md border px-1 py-0.5 ${
                  mode === m ? 'border-gold-line bg-gold-wash' : 'border-line2'
                }`}
              >
                <T className={`text-center text-2 uppercase tracking-widest ${mode === m ? 'text-gold2' : 'text-dim'}`}>
                  {MODE_LABEL[m]}
                </T>
              </Tap>
            ))}
          </View>

          {mode === 'pctFlat' || mode === 'pctRange' ? (
            <View className="mt-1 flex-row items-center gap-1">
              <T w="semi" className="text-2 uppercase tracking-widest text-dim">% of 1RM</T>
              <Input
                num
                value={pctSet?.pct1rm?.lo != null ? String(pctSet.pct1rm.lo) : ''}
                onChangeText={(v) => {
                  const lo = Number(v) || 0;
                  onPctChange(lo, mode === 'pctFlat' ? lo : (pctSet?.pct1rm?.hi ?? lo));
                }}
                accessibilityLabel="percent low"
                className="h-4 w-12 rounded-md border border-line bg-well px-1 text-center text-4 text-text"
              />
              {mode === 'pctRange' ? (
                <>
                  <T className="text-3 text-dim">–</T>
                  <Input
                    num
                    value={pctSet?.pct1rm?.hi != null ? String(pctSet.pct1rm.hi) : ''}
                    onChangeText={(v) => onPctChange(pctSet?.pct1rm?.lo ?? 0, Number(v) || 0)}
                    accessibilityLabel="percent high"
                    className="h-4 w-12 rounded-md border border-line bg-well px-1 text-center text-4 text-text"
                  />
                </>
              ) : null}
            </View>
          ) : null}

          {ex.sets.map((st, si) => (
            <View key={si} className="mt-1 flex-row items-center gap-1">
              <T w="semi" num className={`w-8 text-3 ${isWarmup(st) ? 'text-gold2' : 'text-dim'}`}>
                {isWarmup(st) ? 'Warm' : 'Set ' + (si + 1)}
              </T>
              <Input
                num
                value={st.t}
                onChangeText={(v) => onSet(si, 't', v)}
                placeholder="reps"
                accessibilityLabel="set target"
                className="h-5 w-14 rounded-md border border-line bg-well px-1 text-center text-4 text-text"
              />
              <Input
                num
                value={st.rpe}
                onChangeText={(v) => onSet(si, 'rpe', v)}
                placeholder={isWarmup(st) ? '—' : 'RPE'}
                accessibilityLabel="RPE"
                className="h-5 w-12 rounded-md border border-line bg-well px-1 text-center text-4 text-text"
              />
              {(mode === 'pctFlat' || mode === 'pctRange') && !isWarmup(st) ? (
                <T num accessibilityLabel={`percent of 1RM for set ${si + 1}`} className="text-2 text-gold2">
                  {(() => {
                    const p = pctForSet(ex, si);
                    return p == null ? '' : `${Math.round(p * 10) / 10}%`;
                  })()}
                </T>
              ) : null}
              {ex.sets.length > 1 ? (
                <Tap onPress={() => onDelSet(si)} box={{ h: 20, w: 24 }} label={`delete set ${si + 1}`}>
                  <T className="px-1 text-3 text-dim">✕</T>
                </Tap>
              ) : null}
            </View>
          ))}
          <Btn className="mt-1 self-start" onPress={onAddSet}>
            ＋ Add set
          </Btn>
          <T className="mt-1 text-3 text-dim">
            Type what you want to hit — 8, 8-12, max. Start with W for a warm-up (W or W10).
          </T>

          <View className="mt-1.5 flex-row items-center gap-1">
            <T w="semi" className="text-2 uppercase tracking-widest text-dim">Rest</T>
            <Btn onPress={() => onRest(-15)}>−</Btn>
            <T w="semi" num className="w-10 text-center text-4 text-text">{fmtRest(ex.rest || 0)}</T>
            <Btn onPress={() => onRest(15)}>+</Btn>
            <View className="flex-1" />
            <Tap
              label={`duplicate ${ex.name || 'exercise'}`}
              onPress={onDuplicate}
              box={{ h: 28 }}
              className="mr-1 rounded-md border border-line2 px-1 py-0.5"
            >
              <T className="text-3 text-dim">Duplicate</T>
            </Tap>
            <Tap
              label={`remove ${ex.name || 'exercise'}`}
              onPress={onRemove}
              box={{ h: 28 }}
              className="rounded-md border border-line2 px-1 py-0.5"
            >
              <T className="text-3 text-dim">Remove</T>
            </Tap>
          </View>
        </View>
      ) : null}
    </Card>
  );
}
```

- [ ] **Step 2: Wire `onModeChange`/`onPctChange` in mobile `Planner.tsx`**

Edit `apps/mobile/src/screens/Planner.tsx` — add `isWarmup` to the `@hybrid/engine` import list (same insertion point as Task 4's web change, line 5-26):

```ts
import {
  CON_EFFORTS,
  blockExercises,
  duplicateExercise,
  fillLinkedSets,
  isCond,
  isText,
  isWarmup,
  knownMovements,
  newBlock,
  newCondBlock,
  newWarmupBlock,
  newTextBlock,
  newEx,
  newSet,
  sessionLetters,
  type CondFmtKey,
  type EffortKey,
  type LoggedSet,
  type StrengthBlock,
  type TextBlock,
  type Workout,
} from '@hybrid/engine';
```

Inside the `<ExerciseCard ... />` invocation (around lines 144-191), add the same two new props right after `onRest`:

```tsx
                      onRest={(delta) =>
                        edit((d) => {
                          const e2 = (d.blocks[bi] as StrengthBlock<LoggedSet>).exercises[ei];
                          e2.rest = Math.max(0, Math.min(3600, (e2.rest || 0) + delta));
                        })
                      }
                      onModeChange={(mode) =>
                        edit((d) => {
                          const e2 = (d.blocks[bi] as StrengthBlock<LoggedSet>).exercises[ei];
                          if (mode === 'seconds' || mode === 'reps') {
                            e2.mode = mode === 'seconds' ? 'seconds' : 'reps_kg';
                            e2.sets = e2.sets.map((s) => {
                              const { pct1rm, ...rest } = s;
                              return rest as LoggedSet;
                            });
                          } else {
                            e2.mode = 'reps_kg';
                            e2.sets = e2.sets.map((s) =>
                              isWarmup(s) ? s : { ...s, pct1rm: s.pct1rm ?? { lo: 65, hi: 65 } },
                            );
                          }
                        })
                      }
                      onPctChange={(lo, hi) =>
                        edit((d) => {
                          const e2 = (d.blocks[bi] as StrengthBlock<LoggedSet>).exercises[ei];
                          e2.sets = e2.sets.map((s) => (isWarmup(s) ? s : { ...s, pct1rm: { lo, hi } }));
                        })
                      }
```

- [ ] **Step 3: Write the failing RNTL test**

Create `apps/mobile/test/planner.test.tsx`:

```tsx
import { fireEvent, screen } from '@testing-library/react-native';
import { newBlock, newEx, uid, type Workout } from '@hybrid/engine';
import { renderScreen, seed } from './harness';
import { PlannerScreen } from '../src/screens/Planner';

function benchWorkout(): Workout {
  const ex = {
    ...newEx(),
    id: uid(),
    name: 'Bench press',
    sets: [
      { t: 'W10', rpe: '' },
      { t: '5', rpe: '8' },
      { t: '5', rpe: '9' },
    ],
  };
  const block = { ...newBlock(), id: uid(), heading: 'Main', exercises: [ex] };
  return { id: uid(), name: 'Push', blocks: [block], updatedAt: Date.now() };
}

describe('Planner — pct1rm mode selector', () => {
  it('writes a % range onto every rated set and shows the ramped badge, then clears on Reps', () => {
    const w = benchWorkout();
    seed({ workouts: [w] });
    renderScreen(<PlannerScreen />, { id: w.id });

    fireEvent.press(screen.getByLabelText('expand Bench press'));
    fireEvent.press(screen.getByLabelText('% range + reps mode'));

    fireEvent.changeText(screen.getByLabelText('percent low'), '60');
    fireEvent.changeText(screen.getByLabelText('percent high'), '65');

    expect(screen.getByLabelText('percent of 1RM for set 2').props.children).toBe('60%');
    expect(screen.getByLabelText('percent of 1RM for set 3').props.children).toBe('65%');

    fireEvent.press(screen.getByLabelText('Reps mode'));
    expect(screen.queryByLabelText('percent of 1RM for set 2')).toBeNull();
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter @hybrid/mobile test -- planner`
Expected: FAIL — labels not found (props/UI not implemented yet, or Step 1/2 not yet applied). If Steps 1-2 are already applied by this point, skip to Step 5.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @hybrid/mobile test -- planner`
Expected: PASS.

- [ ] **Step 6: Full mobile suite + typecheck**

Run: `pnpm --filter @hybrid/mobile typecheck && pnpm --filter @hybrid/mobile test`
Expected: exit 0, no regressions in existing mobile suites.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/screens/planner/ExerciseCard.tsx apps/mobile/src/screens/Planner.tsx apps/mobile/test/planner.test.tsx
git commit -m "mobile: add the 4-way target-type selector and per-set %1RM badge to Builder"
```

---

## Task 6: Web Logger — % target line + source sub-line

**Files:**
- Modify: `apps/web/src/screens/Logger.tsx:3-35` (imports), `:414` (`targetLine` call), `:423-430` (Weight field `note`)
- Test: `checks/react-smoke.mjs` (new scenario)

**Interfaces:**
- Consumes: `pct1rmSourceNote` (`@hybrid/engine`, Task 1), `targetLine`'s new 3rd param (Task 3).

- [ ] **Step 1: Add the import**

Edit `apps/web/src/screens/Logger.tsx`, lines 3-35 — insert `pct1rmSourceNote` alphabetically between `nextWorkingWeight` and `plateBreakdown`:

```ts
import {
  AUTOREG,
  advanceAfterSet,
  blockExercises,
  computeSetAdjustment,
  curSetIndex,
  decideStrengthProgression,
  explainWorkingWeight,
  fmtRest,
  fmtRpe,
  isCond,
  isText,
  isLiftMode,
  isWarmup,
  MAX_KG,
  nextLoggerLocation,
  nextWorkingWeight,
  pct1rmSourceNote,
  plateBreakdown,
  prefillPrimary,
  prefillSecondary,
  repFloorOf,
  repTopOf,
  rpeCenterOf,
  sanNumStr,
  saneKg,
  sessionLetters,
  sessionProgress,
  targetLine,
  todayRecovery,
  type Exercise,
  type LoggedSet,
  type StrengthBlock,
} from '@hybrid/engine';
```

- [ ] **Step 2: Pass `si` to `targetLine` and swap the Weight note for a pct1rm set**

Edit `apps/web/src/screens/Logger.tsx`, line 414:

```tsx
              <em className="not-italic text-gold2">target {targetLine(ex, st, si)}</em>
```

And lines 423-430 (the `StepperField`'s `note` prop):

```tsx
                      note={
                        isWarmup(st)
                          ? ''
                          : st.pct1rm
                            ? pct1rmSourceNote(ex, si, sessions)
                            : earned
                              ? (earned.dailyAdj < 0
                                  ? `earned ${earned.earned}kg · ${earned.note}`
                                  : `earned ${earned.earned}kg last time`) +
                                (earnedExplained?.confidence === 'low' ? ' · no recovery data today' : '')
                              : ''
                      }
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @hybrid/web typecheck`
Expected: exit 0.

- [ ] **Step 4: Build and write the react-smoke scenario**

Run: `pnpm --filter @hybrid/web build`

Append to `checks/react-smoke.mjs`, after the "a consistent 2-session on-target streak..." scenario:

```js
await t('a pct1rm set shows its computed %, prefills the prescribed kg, and names its source', async () => {
  const orig = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
    db.sessions.push({
      id: 'pct-hist-1', date: '2026-01-01', status: 'completed', completedAt: 1000,
      blocks: [{
        id: 'b', heading: 'Main', superset: false,
        exercises: [{ id: 'e', name: 'Overhead press', mode: 'reps_kg', rest: 90, sets: [
          { t: '5', rpe: '8', aVal: '100', aVal2: '5', done: true },
        ] }],
      }],
    });

    const origSession = db.sessions.find((s) => s.status === 'active');
    origSession.status = 'incomplete';

    db.workouts.push({
      id: 'w-pct-scratch', name: 'Pct scratch', days: [], updatedAt: Date.now(),
      blocks: [{
        id: 'sb', heading: 'Main', superset: false,
        exercises: [{ id: 'se', name: 'Overhead press', mode: 'reps_kg', rest: 90, sets: [
          { t: 'W10', rpe: '' },
          { t: '5', rpe: '8', pct1rm: { lo: 65, hi: 65 } },
        ] }],
      }],
    });
    db.sessions.push({
      id: 'pct-scratch-session', name: 'Pct scratch', date: '2026-08-03', status: 'active',
      startedAt: Date.now(), workoutId: 'w-pct-scratch',
      blocks: [{
        id: 'sb', heading: 'Main', superset: false,
        exercises: [{ id: 'se', name: 'Overhead press', mode: 'reps_kg', rest: 90, sets: [
          { t: 'W10', rpe: '' },
          { t: '5', rpe: '8', pct1rm: { lo: 65, hi: 65 } },
        ] }],
      }],
    });
    localStorage.setItem('hybrid-engine-v1', JSON.stringify(db));
    return { id: origSession.id };
  });

  await page.goto(base + '/log/0/0', { waitUntil: 'networkidle' });
  await page.waitForSelector('button:has-text("Skip rest"), button:has-text("Finish Set")');
  const skip = await page.$('button:has-text("Skip rest")');
  if (skip) await skip.click();
  await page.waitForSelector('input[aria-label="Weight"]');

  const txt = await page.textContent('body');
  assert(/65% of 1RM/.test(txt), 'expected the target line to show the computed %, got: ' + txt.slice(0, 400));
  assert(/from your best e1RM · Overhead press 117kg/.test(txt), 'expected the source sub-line, got: ' + txt.slice(0, 400));

  const kg = await page.inputValue('input[aria-label="Weight"]');
  assert(kg === '75', 'expected the Weight field prefilled with the rounded prescribed kg, got: ' + kg);

  // Restore the shared session's status so scenarios below are unaffected.
  await page.evaluate((origId) => {
    const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
    db.sessions = db.sessions.filter((s) => !['pct-hist-1', 'pct-scratch-session'].includes(s.id));
    db.workouts = db.workouts.filter((w) => w.id !== 'w-pct-scratch');
    db.sessions.find((s) => s.id === origId).status = 'active';
    localStorage.setItem('hybrid-engine-v1', JSON.stringify(db));
  }, orig.id);
});
```

- [ ] **Step 5: Run the smoke suite**

Run: `node checks/react-smoke.mjs`
Expected: PASS for the new scenario and no regressions in the scenarios that share the main active session (per the cleanup step above).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/screens/Logger.tsx checks/react-smoke.mjs
git commit -m "web: show computed %1RM and prescribed-weight source in Logger"
```

---

## Task 7: Mobile Logger — mirror Task 6

**Files:**
- Modify: `apps/mobile/src/screens/Logger.tsx:5-37` (imports), `:512` (`targetLine` call), `:519-529` (Weight note block)
- Test: `apps/mobile/test/logger.test.tsx` (new cases)

**Interfaces:**
- Consumes: same as Task 6.

- [ ] **Step 1: Add the import**

Edit `apps/mobile/src/screens/Logger.tsx`, lines 5-37 — same alphabetical insertion as Task 6:

```ts
import {
  AUTOREG,
  advanceAfterSet,
  blockExercises,
  computeSetAdjustment,
  curSetIndex,
  decideStrengthProgression,
  explainWorkingWeight,
  fmtRest,
  fmtRpe,
  isCond,
  isText,
  isLiftMode,
  isWarmup,
  MAX_KG,
  nextLoggerLocation,
  nextWorkingWeight,
  pct1rmSourceNote,
  plateBreakdown,
  prefillPrimary,
  prefillSecondary,
  repFloorOf,
  repTopOf,
  rpeCenterOf,
  sanNumStr,
  saneKg,
  sessionLetters,
  sessionProgress,
  targetLine,
  todayRecovery,
  type Exercise,
  type LoggedSet,
  type StrengthBlock,
} from '@hybrid/engine';
```

- [ ] **Step 2: Pass `si` to `targetLine` and swap the Weight note block**

Edit `apps/mobile/src/screens/Logger.tsx`, line 512:

```tsx
              <T w="semi" num className="text-2 text-gold2">target {targetLine(ex, st, si)}</T>
```

And lines 519-529:

```tsx
                    <View className="mt-2 flex-row items-baseline justify-between">
                      <T w="semi" className="text-2 uppercase tracking-widest text-dim">Weight</T>
                      {!isWarmup(st) && st.pct1rm ? (
                        <T num className="text-2 text-muted">{pct1rmSourceNote(ex, si, db.sessions)}</T>
                      ) : earned && !isWarmup(st) ? (
                        <T num className="text-2 text-muted">
                          {(earned.dailyAdj < 0
                            ? `earned ${earned.earned}kg · ${earned.note}`
                            : `earned ${earned.earned}kg last time`) +
                            (earnedExplained?.confidence === 'low' ? ' · no recovery data today' : '')}
                        </T>
                      ) : null}
                    </View>
```

- [ ] **Step 3: Write the failing RNTL tests**

Add to `apps/mobile/test/logger.test.tsx`, near the other Logger `describe` blocks (reusing the file's own `route`/`navigation`/`mount` constants at the bottom of the file — add these as new `it` blocks inside the existing `describe('Logger', ...)`):

```tsx
  it('shows the computed % and prefills the prescribed kg for a pct1rm set', () => {
    const w: Workout = {
      id: uid(),
      name: 'Push',
      blocks: [{
        id: uid(), heading: 'Main', exercises: [{
          id: uid(), name: 'Overhead press', mode: 'reps_kg', rest: 90,
          sets: [{ t: '5', rpe: '8', pct1rm: { lo: 65, hi: 65 } } as LoggedSet],
        }],
      }],
      updatedAt: Date.now(),
    };
    const hist: Session = {
      id: uid(), date: '2026-01-01', status: 'completed', completedAt: 1000,
      blocks: [{
        id: uid(), heading: 'Main', exercises: [{
          id: uid(), name: 'Overhead press', mode: 'reps_kg', rest: 90,
          sets: [{ t: '5', rpe: '8', aVal: '100', aVal2: '5', done: true } as LoggedSet],
        }],
      }],
    };
    const live: Session = {
      id: uid(), date: ymd(new Date()), name: 'Push', status: 'active',
      blocks: freshSessionBlocks(w.blocks), startedAt: Date.now(), workoutId: w.id,
    };
    seed({ workouts: [w], sessions: [hist, live] });
    mount();

    expect(screen.getByText('target 5 @8 · 65% of 1RM')).toBeTruthy();
    expect(screen.getByText('from your best e1RM · Overhead press 117kg')).toBeTruthy();
    expect(screen.getByLabelText('kg').props.value).toBe('75');
  });
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `pnpm --filter @hybrid/mobile test -- logger`
Expected: FAIL if Steps 1-2 are not yet applied; if already applied, this confirms correctness instead — either order is fine as long as the test is written before being confirmed green.

- [ ] **Step 5: Run the full mobile suite**

Run: `pnpm --filter @hybrid/mobile typecheck && pnpm --filter @hybrid/mobile test`
Expected: exit 0, all PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/screens/Logger.tsx apps/mobile/test/logger.test.tsx
git commit -m "mobile: show computed %1RM and prescribed-weight source in Logger"
```

---

## Task 8: Full-repo verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full verify chain**

Run: `pnpm run verify` from the repo root.
Expected: exit 0 — typecheck clean across all 6 workspace projects, engine suite passing (golden 33/33 unchanged, plus the new `pct1rm.test.ts` cases and the `session.test.ts`/`parity.test.ts` additions), web unit tests unchanged in count (this feature's web coverage lives in react-smoke), mobile suite up by the new `planner.test.tsx` file and `logger.test.tsx` cases, `build:site` clean, `check:csp` clean, `smoke` (react-smoke) passing including the two new scenarios, `smoke:deploy` unchanged.

- [ ] **Step 2: Run the touch-target regression suite**

Run: `node checks/web-touch.mjs`
Expected: PASS — the new mode-selector buttons and %1RM badges reuse this file's existing small-button sizing (`h-4`, matching the pre-existing Duplicate/Remove/set-delete buttons in the same file), so no new touch-target violation is expected; this step exists to catch it if wrong, per the exact class of bug the Calendar day-jump plan hit (`docs/superpowers/plans/...calendar...`, see `handoff.md`'s `9ae319a` entry).

- [ ] **Step 3: Record the verification numbers**

No code change — this step is a checkpoint. If either command fails, fix the regression and re-run Steps 1-2 before considering this plan complete. Do not commit anything in this task; Task 7's commit is the plan's last code commit.
