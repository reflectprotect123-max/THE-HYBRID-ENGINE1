# Coach Authors Engine Types — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the coach app's parallel `CoachSession`/`CoachBlock`/`CoachEx` model and have it author `@hybrid/engine`'s real types directly, so anything the athlete Planner can express (warm-up blocks, text blocks, per-exercise supersets, explicit mode, tempo) the coach builder can express too.

**Architecture:** `apps/coach/src/model.ts`'s day type becomes `type CoachSession = Workout<PlannedSet>` — a type alias, not a rename, so `store.tsx` and `cloud.tsx` need zero changes. `sessionToWorkout`/`toAthleteEx` disappear; `assertPublishable` becomes a one-line call into the engine's own `emit.assertWorkout`, since the object it validates is already workout-shaped. `migrateLib` gains one new conversion — the CURRENT (already-blocks-based) on-disk shape into engine shape — and drops the ancient pre-blocks flat-exercise migration entirely (permission granted: no real coach data exists to preserve). The coach's editor components stop importing coach-local `newSet`/`newEx`/`newBlock`/`isCond`/`letters`/`summary`/`duplicateCoachEx` and import the equivalent engine functions instead — the exact ones already proven working in `apps/web/src/screens/Planner.tsx` and its `./planner/*` components.

**Tech Stack:** TypeScript, React, Vite (apps/coach), Vitest.

## Global Constraints

- `PlannedSet` stays exactly `{ t: string; rpe: string }` — no contract change. A prescribed load still lives in `cue`. (Spec §"What this design declines to do".)
- `migrateLib`'s new conversion is best-effort and lossy by permission: convert what parses, drop what does not, never throw. No data-preservation guarantee. (Spec §"Migration".)
- Every new/changed input keeps an `aria-label`, matching the coach app's existing universal convention. (Spec §"Standing constraints".)
- The superset control renders BETWEEN two exercise cards, never as a checkbox inside one. (Spec §"The superset control is a link, not a field".)
- The warm-up affordance is a new "add block" button (`☀ Warm-up / Cooldown`), matching the athlete Planner's own button — not a toggle on an existing block, since no such toggle exists on the athlete side either. (Resolved during planning: the spec's "toggle" language was imprecise; the actual athlete-side parity target is a button.)
- `mode` and `tempo` sit behind a disclosure on the exercise header, not as extra cells in every set row. (Spec §"Progressive disclosure".)
- No emoji as icons. Touch targets ≥44px on coarse pointers — enforced by `checks/web-touch.mjs`, which must still pass.
- Every task ends with `pnpm --filter @hybrid/coach typecheck` and the relevant test file passing before moving on. The final task runs the full workspace `verify` chain.

---

## File Structure

| File | Change |
|---|---|
| `packages/engine/src/types.ts` | Add `note?: string` to `Workout` — the one field coach sessions need that the engine type didn't have. |
| `apps/coach/src/model.ts` | Major reduction. Keep `CoachWeek`/`CoachProgram`/`CoachLib`/`COACH_LS_KEY`/`emptyWeek`/`emptyLib`/`newSession`. Alias `CoachSession = Workout<PlannedSet>`. Replace `migrateLib`'s session conversion. Delete `CoachSet`/`CoachEx`/`CoachBlock`/`CoachCond`/`AnyBlock`, `newSet`/`newEx`/`newBlock`/`newCond`/`duplicateCoachEx`/`isCond`/`letters`/`summary`/`sessionToWorkout`/`toAthleteEx`/`COND_FORMATS`/`EFFORTS`/`fmtLabel`/`effLabel`/`effBand`/`condSummary`. Rewrite `assertPublishable` as a one-liner. |
| `apps/coach/src/editor/ExerciseCard.tsx` | `CoachEx` → `Exercise<PlannedSet>`. `summary(ex)` → engine's `rxLine(ex)`. Add a mode select and tempo field behind a disclosure. |
| `apps/coach/src/editor/ConditioningCard.tsx` | Drop `fmtLabel`/`condSummary` (deleted). Read `CON_FORMATS`/`CON_EFFORTS` from `@hybrid/engine` directly — the exact pattern already in `apps/web/src/screens/planner/CondBlockCard.tsx`. |
| `apps/coach/src/editor/TextBlockCard.tsx` | **New.** Coach-styled twin of `apps/web/src/screens/planner/TextBlockCard.tsx`. |
| `apps/coach/src/Editor.tsx` | Cast targets `CoachBlock`/`CoachCond` → `StrengthBlock<PlannedSet>`/`CondBlock`. `duplicateCoachEx` → engine's `duplicateExercise`. Add: a `☀ Warm-up / Cooldown` block button (engine's `newWarmupBlock()`), a warm-up visual treatment on the block wrapper, a `✎ Metcon / notes` block button (engine's `newTextBlock()`) routing to the new `TextBlockCard`, and a per-exercise superset `Seam` between cards bound to `ex.ssNext` (the existing `Seam` component already renders exactly this — it currently binds to the block-level `ss` flag and needs rebinding). |
| `apps/coach/src/App.tsx` | `preview()`: `b.ex` → engine's `blockExercises(b)`; coach-local `isCond`/`fmtLabel` → engine's `isCond` + `CON_FORMATS[b.condFmt].name`. `sess.title` → `sess.name` in `DayRow`. |
| `apps/coach/src/store.tsx`, `apps/coach/src/cloud.tsx` | **No changes.** Both reference `CoachSession` only as a type annotation; the alias makes them resolve to the new shape automatically. Verified by the type-check step in Task 7. |
| `apps/coach/test/model.test.ts` | Rewritten fixtures (`Workout<PlannedSet>` shape instead of `CoachSession`). New tests for `migrateLib`'s conversion, and for the mode-inference that now only runs at migration time. |
| `packages/engine/test/types.test.ts` | **New**, tiny — asserts `Workout` accepts `note` and it survives `sanitizeDB` unchanged. |

---

### Task 1: Engine — give `Workout` a home for the coach's note

**Files:**
- Modify: `packages/engine/src/types.ts` (the `Workout` interface)
- Test: `packages/engine/test/types.test.ts` (new)

**Interfaces:**
- Produces: `Workout<S>.note?: string` — later tasks read/write `sess.note` directly on a `Workout`-shaped object.

- [ ] **Step 1: Write the failing test**

Create `packages/engine/test/types.test.ts`:

```ts
/*
 * Workout.note — the field the coach app's "Coach instructions" needs.
 *
 * It travels with the session (sessionToWorkout used to bolt it on via an
 * untyped `extra` param), but nothing reads it on the athlete side today —
 * that surfacing is a separate, later feature. This test only proves the
 * field has a typed home and survives the same trust boundary every other
 * workout field does.
 */
import { describe, expect, it } from 'vitest';
import { sanitizeDB } from '../src/db';
import type { Workout } from '../src/types';

describe('Workout.note', () => {
  it('is a real field, not a bag-on-the-side property', () => {
    const w: Workout = { id: 'w1', name: 'Session', blocks: [], note: 'Warm up thoroughly today.' };
    expect(w.note).toBe('Warm up thoroughly today.');
  });

  it('survives sanitizeDB unchanged', () => {
    const db = sanitizeDB({ workouts: [{ id: 'w1', name: 'S', blocks: [], note: 'hello' }], sessions: [], settings: {} });
    expect(db.workouts[0].note).toBe('hello');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hybrid/engine test -- types.test.ts`
Expected: FAIL — TypeScript error, `note` does not exist on type `Workout`.

- [ ] **Step 3: Add the field**

In `packages/engine/src/types.ts`, find the `Workout` interface:

```ts
export interface Workout<S extends AnySet = LoggedSet> {
  id: string;
  name?: string;
  blocks: Block<S>[];
  /** recurring weekday slots, 0=Sunday */
  days?: number[];
  /** one-off YYYY-MM-DD dates */
  dates?: string[];
  updatedAt?: number;
  origin?: 'coach' | 'local';
  assignmentId?: string;
  _rev?: string;
  sample?: boolean;
}
```

Add `note` alongside the other optional extras:

```ts
export interface Workout<S extends AnySet = LoggedSet> {
  id: string;
  name?: string;
  blocks: Block<S>[];
  /** recurring weekday slots, 0=Sunday */
  days?: number[];
  /** one-off YYYY-MM-DD dates */
  dates?: string[];
  updatedAt?: number;
  origin?: 'coach' | 'local';
  assignmentId?: string;
  _rev?: string;
  sample?: boolean;
  /** Coach instructions, written once and carried with the session. */
  note?: string;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hybrid/engine test -- types.test.ts`
Expected: PASS, both cases.

- [ ] **Step 5: Commit**

```bash
cd /workspace/the-hybrid-engine1
git add packages/engine/src/types.ts packages/engine/test/types.test.ts
git commit -m "Give Workout a typed home for the coach's note"
```

---

### Task 2: model.ts — the type alias and the new migration

This is the core task. It replaces `migrateLib`'s session-shape conversion and deletes everything that only existed to translate `CoachSession` into engine shape.

**Files:**
- Modify: `apps/coach/src/model.ts` (whole-file rewrite of the sections below)
- Test: `apps/coach/test/model.test.ts` (rewrite fixtures + new migration tests)

**Interfaces:**
- Consumes: `@hybrid/engine`'s `newBlock`, `newEx`, `newSet`, `newCondBlock`, `isCond`, `CON_EFFORTS`, `emit.assertWorkout`, and types `Workout`, `PlannedSet`, `StrengthBlock`, `CondBlock`, `Block`, `CondFmtKey`, `EffortKey`, `ModeKey`.
- Produces: `type CoachSession = Workout<PlannedSet>` (so every other coach file's `CoachSession` references keep compiling). `emptyLib(): CoachLib`. `newSession(title?: string): CoachSession`. `migrateLib(raw: unknown): CoachLib` (behavior changes: converts the current blocks-shaped legacy data; drops the pre-blocks path). `assertPublishable(sess: CoachSession): Workout<PlannedSet>`.

- [ ] **Step 1: Write the failing tests**

Replace the top of `apps/coach/test/model.test.ts` (imports and fixtures) and add new `describe` blocks. The file becomes:

```ts
import { describe, expect, it } from 'vitest';
import {
  isLiftMode,
  isText,
  isWarmupBlock,
  newEx,
  newTextBlock,
  newWarmupBlock,
  ssGroups,
  type Block,
  type StrengthBlock,
  type Workout,
} from '@hybrid/engine';
import { assertPublishable, migrateLib, newSession, type CoachSession } from '../src/model';

/*
 * model.ts is the only pure module in the coach app, and it is the one that
 * decides what an athlete actually receives. `CoachSession` is now a type
 * alias for the engine's own `Workout<PlannedSet>` — these fixtures build
 * real engine shapes, not a coach-only translation of them.
 */

const session = (
  ex: { name: string; sets: { t: string; rpe?: string }[] }[],
): CoachSession => ({
  id: 'w1',
  name: 'Session',
  blocks: [
    {
      id: 'b1',
      heading: 'Main',
      minutes: '',
      format: '',
      superset: false,
      exercises: ex.map((e, i) => ({
        id: 'e' + i,
        name: e.name,
        mode: 'reps_kg',
        tempo: '',
        rest: 90,
        sets: e.sets.map((s) => ({ t: s.t, rpe: s.rpe ?? '' })),
      })),
    } as StrengthBlock,
  ],
});

const firstEx = (s: CoachSession) => {
  const w = assertPublishable(s);
  const b = w.blocks[0] as StrengthBlock;
  return b.exercises[0];
};

describe('assertPublishable is now a thin validation pass, not a translation', () => {
  it('passes an authored mode straight through', () => {
    expect(firstEx(session([{ name: 'Plank', sets: [{ t: '60' }] }])).mode).toBe('reps_kg');
  });

  it('passes an authored tempo straight through', () => {
    const s = session([{ name: 'Bench Press', sets: [{ t: '5', rpe: '8' }] }]);
    (s.blocks[0] as StrengthBlock).exercises[0].tempo = '3-1-1-0';
    expect(firstEx(s).tempo).toBe('3-1-1-0');
  });

  it('passes ssNext straight through, and ssGroups on the athlete side chains it', () => {
    const s = session([
      { name: 'Bench Press', sets: [{ t: '5', rpe: '8' }] },
      { name: 'Row', sets: [{ t: '8', rpe: '8' }] },
    ]);
    (s.blocks[0] as StrengthBlock).exercises[0].ssNext = true;
    const w = assertPublishable(s);
    const b = w.blocks[0] as StrengthBlock;
    expect(b.exercises[0].ssNext).toBe(true);
    expect(ssGroups(b)).toEqual([[0, 1]]);
  });

  it('a warm-up block survives publish and is still recognised as one', () => {
    const s: CoachSession = {
      id: 'w1',
      name: 'Session',
      blocks: [{ ...newWarmupBlock(), exercises: [{ ...newEx(), name: 'Empty bar bench', sets: [{ t: 'W10', rpe: '' }] }] }],
    };
    const w = assertPublishable(s);
    expect(isWarmupBlock(w.blocks[0])).toBe(true);
  });

  it('a text block survives publish with its body intact', () => {
    const s: CoachSession = { id: 'w1', name: 'Session', blocks: [{ ...newTextBlock(), body: 'AMRAP 12' }] };
    const w = assertPublishable(s);
    expect(isText(w.blocks[0])).toBe(true);
    expect((w.blocks[0] as { body?: string }).body).toBe('AMRAP 12');
  });

  it('throws on a set carrying a logger-owned field, same as the engine contract', () => {
    const s = session([{ name: 'Row', sets: [{ t: '5' }] }]);
    (s.blocks[0] as StrengthBlock).exercises[0].sets[0] = { t: '5', rpe: '8', done: true } as never;
    expect(() => assertPublishable(s)).toThrow(/logger field/);
  });

  it('falls back to one default block when a session has none', () => {
    const empty: CoachSession = { id: 'w1', name: 'Session', blocks: [] };
    const w = assertPublishable(empty);
    expect(w.blocks.length).toBe(1);
  });
});

describe('newSession', () => {
  it('produces a real, id-bearing engine workout with one starter block', () => {
    const s = newSession('My session');
    expect(s.id).toBeTruthy();
    expect(s.name).toBe('My session');
    expect(s.blocks.length).toBe(1);
    expect(isLiftMode((s.blocks[0] as StrengthBlock).exercises[0].mode)).toBe(true);
  });
});

/*
 * migrateLib's session conversion.
 *
 * The pre-blocks flat-exercise format (cols/sets rows, weight-column folding)
 * is GONE from this migration — there is no real coach programme data to
 * preserve (confirmed with the owner), so the elaborate legacy reconstruction
 * that used to live here is no longer worth its complexity. What remains is
 * the CURRENT on-disk shape (already blocks-based) converting into engine
 * shape, which is what anyone who has used the coach app recently actually
 * has stored.
 */
describe('migrateLib converts the current on-disk shape into engine shape', () => {
  const stored = (overrides: Record<string, unknown> = {}) => ({
    programs: [
      {
        id: 'p1',
        name: 'Block 1',
        weeks: [
          {
            days: [
              {
                title: 'Upper A',
                note: 'Bring straps',
                blocks: [
                  {
                    h: 'Main',
                    mins: '',
                    ss: false,
                    ex: [{ id: 'e1', name: 'Bench Press', rest: 90, cue: 'Pause each rep', sets: [{ t: '5', rpe: '8' }] }],
                  },
                ],
                ...overrides,
              },
              null, null, null, null, null, null,
            ],
          },
        ],
      },
    ],
  });

  it('maps h/mins/ss/ex onto heading/minutes/superset/exercises', () => {
    const lib = migrateLib(stored());
    const day = lib.programs[0].weeks[0].days[0] as Workout;
    const b = day.blocks[0] as StrengthBlock;
    expect(day.name).toBe('Upper A');
    expect(day.note).toBe('Bring straps');
    expect(b.heading).toBe('Main');
    expect(b.superset).toBe(false);
    expect(b.exercises[0].name).toBe('Bench Press');
    expect(b.exercises[0].sets[0]).toEqual({ t: '5', rpe: '8' });
  });

  it('infers a mode for migrated exercises, since the old shape never carried one', () => {
    const lib = migrateLib(
      stored({
        blocks: [{ h: 'Main', mins: '', ss: false, ex: [{ id: 'e1', name: 'Plank', rest: 90, cue: '', sets: [{ t: '60' }] }] }],
      }),
    );
    const day = lib.programs[0].weeks[0].days[0] as Workout;
    expect((day.blocks[0] as StrengthBlock).exercises[0].mode).toBe('seconds');
  });

  it('converts a conditioning block, keeping effort and zone in lockstep', () => {
    const lib = migrateLib(
      stored({ blocks: [{ kind: 'cond', h: 'Finisher', fmt: 'intervals', eff: 'hard' }] }),
    );
    const b = (lib.programs[0].weeks[0].days[0] as Workout).blocks[0] as Block & { targetZone?: string };
    expect(b.condFmt).toBe('intervals');
    expect((b as { effort?: string }).effort).toBe('hard');
    expect(b.targetZone).toBe('high');
  });

  it('never throws on malformed input — converts what parses, drops the rest', () => {
    for (const input of [null, [], 'nope', { programs: null }, { programs: [{ name: 'P' }] }]) {
      expect(() => migrateLib(input)).not.toThrow();
    }
  });

  it('clamps an out-of-range selection rather than indexing past the end', () => {
    const lib = migrateLib({ programs: [{ name: 'P', weeks: [] }], sel: { p: 99, w: -3, d: 12 } });
    expect(lib.sel.p).toBeGreaterThanOrEqual(0);
    expect(lib.sel.w).toBeGreaterThanOrEqual(0);
    expect(lib.sel.d).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hybrid/coach test`
Expected: FAIL to even compile/import — `model.ts` still exports the old shapes; several of the new assertions (e.g. `day.note`, mode inference, `condFmt`/lockstep zone) have no matching behavior yet.

- [ ] **Step 3: Rewrite `apps/coach/src/model.ts`**

Replace the entire file with:

```ts
import {
  CON_EFFORTS,
  emit,
  isCond,
  newBlock,
  newCondBlock,
  newEx,
  newSet,
  uid,
  type Block,
  type CondFmtKey,
  type EffortKey,
  type ModeKey,
  type PlannedSet,
  type StrengthBlock,
  type Workout,
} from '@hybrid/engine';

/*
 * The coach's day, now the engine's own type.
 *
 * `CoachSession` is an ALIAS, not a renamed clone: it IS `Workout<PlannedSet>`.
 * That is what makes `store.tsx` and `cloud.tsx` need no changes at all —
 * they only ever reference this name as a type annotation, never construct or
 * destructure an assumption about a shape the engine doesn't have.
 *
 * Only the programme scaffolding below is genuinely coach-only: the engine
 * has no concept of a programme, a week, or a day slot. Everything about what
 * a SESSION is now comes from the engine, which is the whole point — anything
 * the athlete app can express, the builder can now express too.
 */
export type CoachSession = Workout<PlannedSet>;

export interface CoachWeek {
  days: (CoachSession | null)[];
}

export interface CoachProgram {
  id: string;
  name: string;
  weeks: CoachWeek[];
}

export interface CoachLib {
  programs: CoachProgram[];
  sel: { p: number; w: number; d: number };
}

export const COACH_LS_KEY = 'hybrid-coach-v1';

export const LIBRARY = [
  'Back Squat', 'Front Squat', 'Romanian Deadlift', 'Conventional Deadlift', 'Barbell Hip Thrust',
  'DB Bench Press', 'Barbell Bench Press', 'Incline DB Press', 'Chest-Supported Row', 'Barbell Row',
  'Weighted Pull-up', 'Overhead Press', 'Walking Lunge', 'Bulgarian Split Squat', 'Farmer Carry', 'Plank',
];

/** A fresh, id-bearing session with one starter block — engine-shaped from the start. */
export function newSession(title = 'Session'): CoachSession {
  return { id: uid(), name: title, blocks: [newBlock()], updatedAt: Date.now() };
}

export function emptyWeek(): CoachWeek {
  return { days: [null, null, null, null, null, null, null] };
}

export function emptyLib(): CoachLib {
  return {
    programs: [{ id: uid(), name: 'Programme 1', weeks: [emptyWeek()] }],
    sel: { p: 0, w: 0, d: 0 },
  };
}

/* ---------- reading what is already on disk ----------
   A working coach has a library in localStorage under the SAME key. Its day
   objects are the OLD blocks-based CoachSession shape — h/mins/ss/ex, sets of
   {t, rpe} with no mode or tempo. Converting them is best-effort and lossy BY
   PERMISSION: there is no real coach programme data to preserve (confirmed
   with the owner), so the rule is convert what parses, drop what does not,
   never throw. The far older pre-blocks format (flat exercises, spreadsheet
   columns) is not read forward at all any more — reconstructing it cost real
   complexity for data that, by the same permission, is not worth it. */

const s0 = (v: unknown, dflt = '') => (typeof v === 'string' ? v : dflt);

/**
 * A set target read back off disk. `t`/`rpe` are contractually strings, but a
 * stored library does not have to agree — the vanilla builder coerced with
 * String(), so a numeric path could write `{t: 5, rpe: 8}`. Treating a
 * non-string as blank would silently empty every set in the programme.
 */
const sVal = (v: unknown): string =>
  typeof v === 'string' ? v
  : typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '')
  : typeof v === 'boolean' ? String(v)
  : '';

/**
 * Which mode a migrated exercise gets, since the old shape never authored one.
 *
 * Only used here, at migration time, for exactly that reason: a FRESH
 * exercise is authored with an explicit mode from the moment it exists
 * (defaulting to reps_kg via the engine's own `newEx`), so this heuristic —
 * the same one `toAthleteEx` used to run on every publish — only has
 * migrated data left to apply to.
 *
 * The `> 30` test is what separates a duration from a rep count: nobody
 * writes a bare "45" meaning forty-five reps, and nobody holds a plank for
 * eight seconds. `max` wins over it either way, since an AMRAP is about the
 * count regardless of how long it takes.
 */
function inferMode(sets: { t?: unknown }[]): ModeKey {
  const allSecs = sets.length > 0 && sets.every((st) => /^\s*\d+\s*$/.test(String(st.t)) && parseInt(String(st.t), 10) > 30);
  const anyMax = sets.some((st) => /^\s*max\s*$/i.test(String(st.t)));
  return anyMax ? 'amrap' : allSecs ? 'seconds' : 'reps_kg';
}

interface OldEx {
  id?: string;
  name?: string;
  rest?: unknown;
  cue?: unknown;
  sets?: { t?: unknown; rpe?: unknown }[];
}

interface OldBlock {
  kind?: string;
  h?: unknown;
  mins?: unknown;
  ss?: unknown;
  ex?: OldEx[];
  fmt?: unknown;
  eff?: unknown;
}

/** One migrated strength block — h/mins/ss/ex → heading/minutes/superset/exercises. */
function migrateBlock(b: OldBlock): Block<PlannedSet> {
  if (b.kind === 'cond') {
    const fmt = b.fmt as CondFmtKey;
    const eff = (b.eff as EffortKey) in CON_EFFORTS ? (b.eff as EffortKey) : 'medium';
    const cb = newCondBlock();
    cb.heading = s0(b.h, 'Finisher');
    cb.condFmt = fmt;
    cb.effort = eff;
    cb.targetZone = CON_EFFORTS[eff].zone;
    return cb;
  }

  const exercises = (Array.isArray(b.ex) ? b.ex : [])
    .filter((e): e is OldEx => !!e && typeof e === 'object')
    .map((e) => {
      const sets = (Array.isArray(e.sets) ? e.sets : []).map((st) => newSet(sVal(st?.t), sVal(st?.rpe)));
      const r = parseInt(String(e.rest), 10);
      const ex = newEx();
      ex.name = s0(e.name);
      ex.mode = inferMode(sets);
      ex.sets = sets.length ? sets : [newSet()];
      ex.rest = Number.isFinite(r) && r >= 0 ? Math.min(r, 3600) : 90;
      if (s0(e.cue)) ex.cue = s0(e.cue);
      return ex;
    });

  const sb: StrengthBlock<PlannedSet> = newBlock();
  sb.heading = s0(b.h, 'Main');
  sb.minutes = s0(b.mins);
  sb.superset = !!b.ss;
  sb.exercises = exercises.length ? exercises : [newEx()];
  return sb;
}

/** One migrated day. Anything that doesn't even look like a session is dropped. */
function migrateDay(raw: unknown): CoachSession | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as { title?: unknown; name?: unknown; note?: unknown; blocks?: unknown };
  const blocks = (Array.isArray(r.blocks) ? r.blocks : [])
    .filter((b): b is OldBlock => !!b && typeof b === 'object')
    .map(migrateBlock)
    .filter((b) => isCond(b) || (b as StrengthBlock).exercises.length);
  if (!blocks.length) return null;

  return {
    id: uid(),
    name: s0(r.name ?? r.title, 'Session'),
    note: s0(r.note),
    blocks,
    updatedAt: Date.now(),
  };
}

/** Read a whole stored library forward, clamping the selection to what exists. */
export function migrateLib(raw: unknown): CoachLib {
  const lib = raw as CoachLib | null;
  if (!lib || typeof lib !== 'object' || !Array.isArray(lib.programs) || !lib.programs.length) return emptyLib();

  const programs = lib.programs
    .filter((p): p is CoachProgram => !!p && typeof p === 'object')
    .map((p) => ({
      id: p.id || uid(),
      name: s0(p.name, 'Programme'),
      weeks: (Array.isArray(p.weeks) && p.weeks.length ? p.weeks : [emptyWeek()]).map((w) => ({
        days: (Array.isArray(w?.days) ? w.days : [])
          .concat([null, null, null, null, null, null, null])
          .slice(0, 7)
          .map(migrateDay),
      })),
    }));
  if (!programs.length) return emptyLib();

  const sel = lib.sel && typeof lib.sel === 'object' ? lib.sel : { p: 0, w: 0, d: 0 };
  const p = Math.max(0, Math.min(programs.length - 1, sel.p | 0));
  return {
    programs,
    sel: {
      p,
      w: Math.max(0, Math.min(programs[p].weeks.length - 1, sel.w | 0)),
      d: Math.max(0, Math.min(6, sel.d | 0)),
    },
  };
}

/**
 * Publish-time validation, so a bad session fails here and not on a phone.
 *
 * `sess` is already workout-shaped, so there is no translation left to do —
 * this is now the emit contract and nothing else. The empty-blocks fallback
 * is defensive: the UI unmounts the editor once a day's blocks hit zero (see
 * Editor.tsx's `requestRemove`), so this should not be reachable in practice.
 */
export function assertPublishable(sess: CoachSession): Workout<PlannedSet> {
  const blocks = sess.blocks.length ? sess.blocks : [newBlock()];
  return emit.assertWorkout({ ...sess, blocks });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hybrid/coach test`
Expected: PASS — all cases in `model.test.ts`.

- [ ] **Step 5: Typecheck (expect failures elsewhere — that's the next four tasks)**

Run: `pnpm --filter @hybrid/coach typecheck`
Expected: FAIL — `Editor.tsx`, `ExerciseCard.tsx`, `ConditioningCard.tsx`, `App.tsx` still reference deleted exports (`isCond`, `letters`, `summary`, `newSet`, `newEx`, `newBlock`, `newCond`, `duplicateCoachEx`, `fmtLabel`, `condSummary`, `COND_FORMATS`, `EFFORTS`). This is expected — those are Tasks 3–6.

- [ ] **Step 6: Commit**

```bash
git add apps/coach/src/model.ts apps/coach/test/model.test.ts
git commit -m "Coach model: alias CoachSession to the engine's Workout type"
```

---

### Task 3: ExerciseCard — real types, plus mode and tempo behind a disclosure

**Files:**
- Modify: `apps/coach/src/editor/ExerciseCard.tsx`

**Interfaces:**
- Consumes: `@hybrid/engine`'s `rxLine`, `MODE_KEYS`, `MODES` (label lookup), and type `Exercise<PlannedSet>` (aliased locally as needed).
- Produces: `ExCard` gains two new props: `onMode: (m: ModeKey) => void`, `onTempo: (v: string) => void`.

- [ ] **Step 1: Open the file and locate the two things to change**

`apps/coach/src/editor/ExerciseCard.tsx` currently:
- imports `type CoachEx` and `summary` from `../model` (line 2)
- the `ex: CoachEx` prop type (line 33)
- `{summary(ex)}` for the collapsed-card subtitle (line 62) and open-card subtitle (line 88)
- no mode/tempo controls at all

- [ ] **Step 2: Edit the imports and prop type**

Change:

```ts
import { isWarmup } from '@hybrid/engine';
import { fmtRest, summary, type CoachEx } from '../model';
import { IconCopy, IconRight, IconUp, Ltr, MICRO, WELL } from '../ui';
```

to:

```ts
import { isWarmup, rxLine, MODE_KEYS, MODES, type Exercise, type ModeKey, type PlannedSet } from '@hybrid/engine';
import { fmtRest } from '../model';
import { IconCopy, IconRight, IconUp, Ltr, MICRO, WELL } from '../ui';
```

- [ ] **Step 3: Swap the type and the two `summary(ex)` call sites**

Change the prop type:

```ts
export function ExCard({
  ex,
  letter,
  open,
  onToggle,
  onPick,
  onSet,
  onAddSet,
  onDelSet,
  onRest,
  onCue,
  onMove,
  onDuplicate,
  onDelete,
  deleteArmed,
  armedClass,
}: {
  ex: CoachEx;
```

to (adding the two new props):

```ts
export function ExCard({
  ex,
  letter,
  open,
  onToggle,
  onPick,
  onSet,
  onAddSet,
  onDelSet,
  onRest,
  onCue,
  onMode,
  onTempo,
  onMove,
  onDuplicate,
  onDelete,
  deleteArmed,
  armedClass,
}: {
  ex: Exercise<PlannedSet>;
```

and add to the type signature block (right after `onCue: (v: string) => void;`):

```ts
  onCue: (v: string) => void;
  onMode: (m: ModeKey) => void;
  onTempo: (v: string) => void;
```

Then change both:

```tsx
          <span className="num mt-0.5 block truncate text-3 text-muted">{summary(ex)}</span>
```

to:

```tsx
          <span className="num mt-0.5 block truncate text-3 text-muted">{rxLine(ex)}</span>
```

(there are two identical lines — the collapsed card at the top, and the open card's header — change both).

- [ ] **Step 4: Add the mode/tempo disclosure**

Find the "Prescription" section (starts `<div className={MICRO + ' mb-1'}>Prescription</div>`). Immediately AFTER the closing `</div>` of the sets table and its `<p>` hint (the block ending `A different number per set makes a ladder.</p>` — right before the `</div>` that closes the outer `<div>` wrapping "Prescription"), add a collapsible row. Use a local `useState` for the disclosure — add `useState` to the React import at the top of the file:

```ts
import { useState } from 'react';
import { isWarmup, rxLine, MODE_KEYS, MODES, type Exercise, type ModeKey, type PlannedSet } from '@hybrid/engine';
```

Inside the component body, before the `return`:

```ts
  const [advanced, setAdvanced] = useState(false);
```

Then, right after the sets table's closing `</p>` (the ladder hint) and before the `</div>` that ends the Prescription section:

```tsx
          <button
            onClick={() => setAdvanced((a) => !a)}
            aria-expanded={advanced}
            className="mt-1 text-2 font-[650] text-muted hover:text-gold2"
          >
            {advanced ? '▴ Fewer options' : '▾ Mode, tempo'}
          </button>
          {advanced ? (
            <div className="mt-1 flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-0.5">
                <span className={MICRO}>Mode</span>
                <select
                  value={ex.mode}
                  onChange={(e) => onMode(e.target.value as ModeKey)}
                  aria-label="exercise mode"
                  className={WELL + ' h-4 px-1 text-3'}
                >
                  {MODE_KEYS.map((m) => (
                    <option key={m} value={m}>
                      {MODES[m].label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-0.5">
                <span className={MICRO}>Tempo</span>
                <input
                  value={ex.tempo || ''}
                  onChange={(e) => onTempo(e.target.value)}
                  placeholder="3-1-1-0"
                  aria-label="tempo"
                  className={WELL + ' h-4 w-16 px-1 text-3'}
                />
              </label>
            </div>
          ) : null}
```

- [ ] **Step 5: Typecheck this file in isolation**

Run: `pnpm --filter @hybrid/coach typecheck`
Expected: still FAILS — `Editor.tsx` doesn't pass `onMode`/`onTempo` yet, and hasn't had its own casts updated. That's Task 6. This step is just to confirm `ExerciseCard.tsx` itself introduces no NEW errors beyond the ones already expected from Task 2 — read the error list and confirm every error is in `Editor.tsx`, `ConditioningCard.tsx`, or `App.tsx`, none in `ExerciseCard.tsx`.

- [ ] **Step 6: Commit**

```bash
git add apps/coach/src/editor/ExerciseCard.tsx
git commit -m "Coach ExerciseCard: real engine types, plus mode/tempo behind a disclosure"
```

---

### Task 4: ConditioningCard — read the engine's own format/effort data

**Files:**
- Modify: `apps/coach/src/editor/ConditioningCard.tsx`

**Interfaces:**
- Consumes: `@hybrid/engine`'s `CON_FORMATS`, `CON_EFFORTS`, `CON_FORMAT_KEYS`, `CON_EFFORT_KEYS`, `condEffortRpe`, and types `CondFmtKey`, `EffortKey`.
- Produces: `CondCard`'s props drop `summary`/`label` (now derived internally, matching `apps/web/src/screens/planner/CondBlockCard.tsx`'s own pattern) — keeps `fmt`, `eff`, `open`, `onToggle`, `onFmt`, `onEff`. The `Pill` sub-component and its HR-zone colouring (`zone` prop) are untouched.

- [ ] **Step 1: Read the current file for reference**

`apps/coach/src/editor/ConditioningCard.tsx` (112 lines) is exactly:

```tsx
import { type CondFmtKey, type EffortKey } from '@hybrid/engine';
import { COND_FORMATS, EFFORTS } from '../model';
import { IconRight, IconUp, Ltr, MICRO } from '../ui';

/*
 * One conditioning block, as a card. Split out of Editor.tsx.
 *
 * `Pill` lives here because this card is its only caller.
 */

export function CondCard({
  fmt,
  eff,
  open,
  summary: sum,
  label,
  onToggle,
  onFmt,
  onEff,
}: {
  fmt: CondFmtKey;
  eff: EffortKey;
  open: boolean;
  summary: string;
  label: string;
  onToggle: () => void;
  onFmt: (v: CondFmtKey) => void;
  onEff: (v: EffortKey) => void;
}) {
  return (
    <section
      className={
        'overflow-hidden rounded-md border bg-panel shadow-card ' + (open ? 'border-zone-green/40' : 'border-line')
      }
    >
      <button onClick={onToggle} className="flex w-full items-center gap-1 bg-panel2 px-1.5 py-1 text-left">
        <Ltr cond>♥</Ltr>
        <span className="min-w-0 flex-1">
          <b className="block text-5 font-[750]">{label}</b>
          <span className="block truncate text-3 text-muted">{sum}</span>
        </span>
        <span className="shrink-0 text-dim" aria-hidden="true">
          {open ? <IconUp /> : <IconRight />}
        </span>
      </button>

      {open ? (
        <div className="flex flex-col gap-2 border-t border-line p-2">
          <div>
            <div className={MICRO + ' mb-1'}>Format</div>
            <div className="flex flex-wrap gap-1">
              {COND_FORMATS.map(([k, name]) => (
                <Pill key={k} on={k === fmt} onClick={() => onFmt(k)}>
                  {name}
                </Pill>
              ))}
            </div>
          </div>
          <div>
            <div className={MICRO + ' mb-1'}>Effort</div>
            <div className="flex flex-wrap gap-1">
              {EFFORTS.map(([k, name, band]) => (
                <Pill key={k} on={k === eff} onClick={() => onEff(k)} zone={k}>
                  {name}
                  <i className="ml-0.5 text-1 font-[650] not-italic opacity-70">{band}</i>
                </Pill>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
```

(`Pill`, below this in the same file, is untouched by this task — leave it exactly as is.)

- [ ] **Step 2: Replace the import line**

Change:

```ts
import { type CondFmtKey, type EffortKey } from '@hybrid/engine';
import { COND_FORMATS, EFFORTS } from '../model';
```

to:

```ts
import { CON_EFFORTS, CON_EFFORT_KEYS, CON_FORMATS, CON_FORMAT_KEYS, condEffortRpe, type CondFmtKey, type EffortKey } from '@hybrid/engine';
```

(the `../model` import disappears entirely — `COND_FORMATS`/`EFFORTS` no longer exist there after Task 2).

- [ ] **Step 3: Replace the component signature and add internal derivation**

Change:

```ts
export function CondCard({
  fmt,
  eff,
  open,
  summary: sum,
  label,
  onToggle,
  onFmt,
  onEff,
}: {
  fmt: CondFmtKey;
  eff: EffortKey;
  open: boolean;
  summary: string;
  label: string;
  onToggle: () => void;
  onFmt: (v: CondFmtKey) => void;
  onEff: (v: EffortKey) => void;
}) {
  return (
```

to:

```ts
export function CondCard({
  fmt,
  eff,
  open,
  onToggle,
  onFmt,
  onEff,
}: {
  fmt: CondFmtKey;
  eff: EffortKey;
  open: boolean;
  onToggle: () => void;
  onFmt: (v: CondFmtKey) => void;
  onEff: (v: EffortKey) => void;
}) {
  const label = CON_FORMATS[fmt].name;
  const sum = `${CON_EFFORTS[eff].name} · ${CON_EFFORTS[eff].cue} · runs by heart rate`;

  return (
```

(keeping the local name `sum` for the summary variable means the JSX body below — `<span ...>{sum}</span>` — needs no further edit.)

- [ ] **Step 4: Swap the two `.map()` calls**

Change:

```tsx
              {COND_FORMATS.map(([k, name]) => (
                <Pill key={k} on={k === fmt} onClick={() => onFmt(k)}>
                  {name}
                </Pill>
              ))}
```

to:

```tsx
              {CON_FORMAT_KEYS.map((k) => (
                <Pill key={k} on={k === fmt} onClick={() => onFmt(k)}>
                  {CON_FORMATS[k].name}
                </Pill>
              ))}
```

and change:

```tsx
              {EFFORTS.map(([k, name, band]) => (
                <Pill key={k} on={k === eff} onClick={() => onEff(k)} zone={k}>
                  {name}
                  <i className="ml-0.5 text-1 font-[650] not-italic opacity-70">{band}</i>
                </Pill>
              ))}
```

to:

```tsx
              {CON_EFFORT_KEYS.map((k) => (
                <Pill key={k} on={k === eff} onClick={() => onEff(k)} zone={k}>
                  {CON_EFFORTS[k].name}
                  <i className="ml-0.5 text-1 font-[650] not-italic opacity-70">RPE {condEffortRpe(CON_EFFORTS[k])}</i>
                </Pill>
              ))}
```

(`condEffortRpe(CON_EFFORTS[k])` reproduces exactly what the coach's old hardcoded `'RPE 3-4'` etc. strings meant, computed from the engine's own `rpe` tuple instead of a second hand-written copy of it — the same reasoning as `Field 4` on the athlete side never hardcoding a zone name.)

- [ ] **Step 5: Update the call site in `Editor.tsx` (props only, for now)**

This will be fully wired in Task 6, but to keep this task's typecheck meaningful, open `apps/coach/src/Editor.tsx` and find the `<CondCard .../>` usage. Remove the `summary={condSummary(b)}` and `label={fmtLabel(b.fmt)}` props (leave everything else as-is for now — the rest of `Editor.tsx`'s changes land in Task 6):

Before:
```tsx
                <CondCard
                  fmt={b.fmt}
                  eff={b.eff}
                  open={open?.b === bi}
                  summary={condSummary(b)}
                  label={fmtLabel(b.fmt)}
                  onToggle={() => setOpen(open?.b === bi ? null : { b: bi, e: 0 })}
                  onFmt={(v) => edit((d) => void ((d.blocks[bi] as never as { fmt: CondFmtKey }).fmt = v))}
                  onEff={(v) => edit((d) => void ((d.blocks[bi] as never as { eff: EffortKey }).eff = v))}
                />
```

After:
```tsx
                <CondCard
                  fmt={b.condFmt}
                  eff={b.effort}
                  open={open?.b === bi}
                  onToggle={() => setOpen(open?.b === bi ? null : { b: bi, e: 0 })}
                  onFmt={(v) => edit((d) => void ((d.blocks[bi] as never as { condFmt: CondFmtKey }).condFmt = v))}
                  onEff={(v) =>
                    edit((d) => {
                      const cb = d.blocks[bi] as never as { effort: EffortKey; targetZone: string };
                      cb.effort = v;
                      cb.targetZone = CON_EFFORTS[v].zone;
                    })
                  }
                />
```

(Note the field renames — `b.fmt`→`b.condFmt`, `b.eff`→`b.effort` — matching the engine's `CondBlock` type. `CON_EFFORTS` needs importing into `Editor.tsx`; that happens as part of Task 6's import rewrite, so this step alone will still show a typecheck error until Task 6 completes — expected.)

- [ ] **Step 6: Commit**

```bash
git add apps/coach/src/editor/ConditioningCard.tsx apps/coach/src/Editor.tsx
git commit -m "Coach ConditioningCard: read format/effort straight from the engine"
```

---

### Task 5: TextBlockCard — new file, and the metcon add-block button

**Files:**
- Create: `apps/coach/src/editor/TextBlockCard.tsx`

**Interfaces:**
- Produces: `TextBlockCard({ body, onChange }: { body: string; onChange: (v: string) => void })` — a coach-styled twin of `apps/web/src/screens/planner/TextBlockCard.tsx`. No `readOnly` prop — unlike the athlete Planner, the coach editor never renders a read-only session.

- [ ] **Step 1: Create the file**

The coach app has no shared `Card` component (confirmed: `apps/coach/src/ui.tsx` exports only style-string constants — `MICRO`, `BRASS`, `GHOST`, `ADD`, `WELL` — plus small components `Ltr`/`Chip`/`Field`). Every card-like surface is a raw `<section>` styled inline, exactly as `ConditioningCard.tsx`'s own wrapper does (`overflow-hidden rounded-md border bg-panel shadow-card`) — this file matches that:

```tsx
import { WELL } from '../ui';

/*
 * Just words. A metcon is one prescription that does not decompose into sets
 * of a movement without inventing structure — see packages/engine/src/types.ts's
 * TextBlock doc. The coach types it, the athlete ticks it, and neither side
 * pretends it produced tonnage or an e1RM.
 *
 * No shared Card component exists in this app (see ExerciseCard.tsx and
 * ConditioningCard.tsx — both style their own section directly), so this one
 * does too, matching the same border/shadow treatment.
 */
export function TextBlockCard({ body, onChange }: { body: string; onChange: (v: string) => void }) {
  return (
    <section className="overflow-hidden rounded-md border border-line bg-panel p-2 shadow-card">
      <textarea
        value={body}
        onChange={(e) => onChange(e.target.value)}
        rows={5}
        placeholder={'AMRAP 12\n10 burpees\n15 KB swings\n200m run'}
        aria-label="what the block is"
        className={WELL + ' w-full resize-y px-1 py-1 text-4 leading-relaxed'}
      />
      <p className="mt-1 text-2 text-dim">
        The athlete ticks this when done. No tonnage, no e1RM — there is nothing here to measure.
      </p>
    </section>
  );
}
```

- [ ] **Step 2: Confirm `WELL` is exported from `../ui`**

Run: `grep -n "^export const WELL" apps/coach/src/ui.tsx`
Expected: one match (confirmed present — used throughout `Editor.tsx`'s sidecar already).

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @hybrid/coach typecheck`
Expected: no NEW errors from this file (it isn't imported anywhere yet, so it can't fail on its own missing wiring — that lands in Task 6).

- [ ] **Step 4: Commit**

```bash
git add apps/coach/src/editor/TextBlockCard.tsx
git commit -m "Coach: add TextBlockCard, the metcon/notes block"
```

---

### Task 6: Editor.tsx — the big rewire

This is where everything gets wired together: real engine casts, the warm-up and metcon block buttons, the per-exercise superset seam, and the new `ExCard` props.

**Files:**
- Modify: `apps/coach/src/Editor.tsx`

**Interfaces:**
- Consumes: Task 2's `assertPublishable`/`newSession`/`CoachSession`; Task 3's `ExCard` (now taking `onMode`/`onTempo`); Task 5's `TextBlockCard`; `@hybrid/engine`'s `newWarmupBlock`, `newTextBlock`, `newCondBlock`, `duplicateExercise`, `fillLinkedSets`, `isText`, `isWarmupBlock`, `blockExercises`, `sessionLetters`, and types `StrengthBlock<PlannedSet>`, `TextBlock`, `CondBlock`, `Block`.

- [ ] **Step 1: Rewrite the import block**

Current:

```ts
import { useEffect, useState } from 'react';
import { fillLinkedSets, ymd, type CondFmtKey, type EffortKey } from '@hybrid/engine';
import { useLib } from './store';
import { useCoachCloud } from './cloud';
import { assertPublishable, condSummary, duplicateCoachEx, fmtLabel, isCond, letters, newCond, newEx, newBlock, newSet, summary, type CoachBlock, type CoachSession } from './model';
import { ADD, BRASS, Field, IconLink, IconSend, MICRO, WELL } from './ui';
import { ExCard } from './editor/ExerciseCard';
import { CondCard } from './editor/ConditioningCard';
import { Picker } from './editor/MovementPicker';
import { Glance } from './editor/SessionGlance';
```

Replace with:

```ts
import { useEffect, useState } from 'react';
import {
  CON_EFFORTS,
  blockExercises,
  duplicateExercise,
  fillLinkedSets,
  isCond,
  isText,
  isWarmupBlock,
  newBlock,
  newCondBlock,
  newEx,
  newTextBlock,
  newWarmupBlock,
  sessionLetters,
  ymd,
  type Block,
  type CondFmtKey,
  type EffortKey,
  type ModeKey,
  type StrengthBlock,
  type TextBlock,
} from '@hybrid/engine';
import { useLib } from './store';
import { useCoachCloud } from './cloud';
import { assertPublishable, newSession, type CoachSession } from './model';
import { ADD, BRASS, Field, IconLink, IconSend, MICRO, WELL } from './ui';
import { ExCard } from './editor/ExerciseCard';
import { CondCard } from './editor/ConditioningCard';
import { TextBlockCard } from './editor/TextBlockCard';
import { Picker } from './editor/MovementPicker';
import { Glance } from './editor/SessionGlance';
```

(`newSession`/`newCond`'s old use in `App.tsx` — Task 7 — will need `newSession` from `./model` still, which stays exported; `newCond` is gone, replaced by the engine's own `newCondBlock`.)

- [ ] **Step 2: Fix `s.title`/`s.note` → `s.name`/`s.note`**

`s.note` is unchanged (Task 1 added it to `Workout`). Find:

```ts
        <input
          value={s.title}
          onChange={(e) => edit((d) => void (d.title = e.target.value))}
```

Change to:

```ts
        <input
          value={s.name || ''}
          onChange={(e) => edit((d) => void (d.name = e.target.value))}
```

- [ ] **Step 3: Fix `LTR`/letters**

Find:

```ts
  const LTR = letters(s);
```

Change to:

```ts
  const LTR = sessionLetters({ id: s.id, date: '', status: 'completed', blocks: s.blocks });
```

(This is the exact same call the athlete Planner already makes — `sessionLetters` takes a `Session`-shaped object structurally, and a `Workout<PlannedSet>` satisfies it because every extra `LoggedSet` field it might read is optional.)

- [ ] **Step 4: Fix the block-kind branch — cast types and add text/warmup rendering**

Find the block map's cast:

```tsx
              {isCond(b) ? (
                <CondCard
```

The condition and everything through the strength-block branch needs a third arm for text blocks, and the strength-block wrapper needs a warm-up visual treatment. Change the whole `{isCond(b) ? (...) : (...)}` ternary to:

```tsx
              {isText(b) ? (
                <TextBlockCard
                  body={(b as TextBlock).body || ''}
                  onChange={(v) => edit((d) => void ((d.blocks[bi] as TextBlock).body = v))}
                />
              ) : isCond(b) ? (
                <CondCard
                  fmt={b.condFmt}
                  eff={b.effort}
                  open={open?.b === bi}
                  onToggle={() => setOpen(open?.b === bi ? null : { b: bi, e: 0 })}
                  onFmt={(v) => edit((d) => void ((d.blocks[bi] as never as { condFmt: CondFmtKey }).condFmt = v))}
                  onEff={(v) =>
                    edit((d) => {
                      const cb = d.blocks[bi] as never as { effort: EffortKey; targetZone: string };
                      cb.effort = v;
                      cb.targetZone = CON_EFFORTS[v].zone;
                    })
                  }
                />
              ) : (
                <div className={(b as StrengthBlock).warmup ? 'rounded-lg border border-dashed border-line2 p-1' : undefined}>
                  {blockExercises(b as StrengthBlock).map((ex, ei, exs) => {
                    const next = exs[ei + 1];
                    return (
                      <div key={ex.id}>
                        <ExCard
                          ex={ex}
                          letter={LTR[bi + '-' + ei] || '?'}
                          open={open?.b === bi && open?.e === ei}
                          onToggle={() => setOpen(open?.b === bi && open?.e === ei ? null : { b: bi, e: ei })}
                          onPick={() => setPick({ b: bi, e: ei })}
                          onSet={(si, key, v) =>
                            edit((d) => {
                              const target = (d.blocks[bi] as StrengthBlock).exercises[ei];
                              target.sets = fillLinkedSets(target.sets, si, key, v);
                            })
                          }
                          onAddSet={() => edit((d) => void (d.blocks[bi] as StrengthBlock).exercises[ei].sets.push({ t: '', rpe: '' }))}
                          onDelSet={(si) => edit((d) => void (d.blocks[bi] as StrengthBlock).exercises[ei].sets.splice(si, 1))}
                          onRest={(delta) =>
                            edit((d) => {
                              const e2 = (d.blocks[bi] as StrengthBlock).exercises[ei];
                              e2.rest = Math.max(0, Math.min(3600, (e2.rest || 0) + delta));
                            })
                          }
                          onCue={(v) => edit((d) => void ((d.blocks[bi] as StrengthBlock).exercises[ei].cue = v))}
                          onMode={(m: ModeKey) => edit((d) => void ((d.blocks[bi] as StrengthBlock).exercises[ei].mode = m))}
                          onTempo={(v) => edit((d) => void ((d.blocks[bi] as StrengthBlock).exercises[ei].tempo = v))}
                          onMove={(dir) =>
                            edit((d) => {
                              const arr = (d.blocks[bi] as StrengthBlock).exercises;
                              const j = ei + dir;
                              if (j < 0 || j >= arr.length) return;
                              [arr[ei], arr[j]] = [arr[j], arr[ei]];
                            })
                          }
                          onDuplicate={() => {
                            setOpen({ b: bi, e: ei + 1 });
                            edit((d) => void ((d.blocks[bi] as StrengthBlock).exercises = duplicateExercise((d.blocks[bi] as StrengthBlock).exercises, ei)));
                          }}
                          deleteArmed={armed === 'e' + bi + '-' + ei}
                          armedClass={ARMED_BTN}
                          onDelete={() =>
                            requestRemove('e' + bi + '-' + ei, (d) => void (d.blocks[bi] as StrengthBlock).exercises.splice(ei, 1))
                          }
                        />
                        {next ? (
                          <Seam
                            on={!!ex.ssNext}
                            onClick={() =>
                              edit((d) => {
                                const t = (d.blocks[bi] as StrengthBlock).exercises[ei];
                                t.ssNext = !t.ssNext;
                              })
                            }
                          />
                        ) : null}
                      </div>
                    );
                  })}
                  <button
                    onClick={() => edit((d) => void (d.blocks[bi] as StrengthBlock).exercises.push(newEx()))}
                    className={ADD + ' mt-1 h-5 text-3'}
                  >
                    ＋ Exercise
                  </button>
                </div>
              )}
```

Note what changed from the original:
- The `Seam` between cards now toggles `ex.ssNext` (per-exercise), not `d.blocks[bi].ss` (whole block). The block-level `superset` field still exists on `StrengthBlock` and still reconciles through `ssGroups` if ever set, but there is no longer a UI control setting it directly here — a coach chaining exercises now does it one seam at a time, exactly like the athlete Planner.
- `onSet`'s target is now `StrengthBlock`'s real `.sets` (`PlannedSet[]`), through `fillLinkedSets` — same call shape as before, just against the real type.
- `onAddSet` pushes a literal `{t:'', rpe:''}` rather than calling a coach-local `newSet()` — this matches the engine's own `newSet()` from `session.ts` exactly (`{ t: '', rpe: '' }`), so either works; the literal avoids one more import for a one-line object.

- [ ] **Step 5: Fix the `removeThenPrune`/`destroysDay` block-pruning predicate**

Find:

```ts
      target.blocks = target.blocks.filter((b) => isCond(b) || b.ex.length);
```

Change to:

```ts
      target.blocks = target.blocks.filter((b) => isCond(b) || isText(b) || blockExercises(b as StrengthBlock).length);
```

(A text block has no `.exercises` at all — it must never be pruned for having zero exercises, since having none is what a text block IS.)

Find the matching line in `destroysDay`:

```ts
    return probe.blocks.filter((b) => isCond(b) || b.ex.length).length === 0;
```

Change to:

```ts
    return probe.blocks.filter((b) => isCond(b) || isText(b) || blockExercises(b as StrengthBlock).length).length === 0;
```

- [ ] **Step 6: Add the warm-up and metcon block buttons**

Find the existing add-block row:

```tsx
        <div className="mt-2 flex flex-wrap gap-1">
          <button onClick={() => edit((d) => void d.blocks.push(newBlock('New block')))} className={ADD}>
            ＋ Block
          </button>
          <button onClick={() => edit((d) => void d.blocks.push(newCond()))} className={ADD}>
            ♥ Conditioning
          </button>
        </div>
```

Change to:

```tsx
        <div className="mt-2 flex flex-wrap gap-1">
          <button onClick={() => edit((d) => void d.blocks.push(newBlock()))} className={ADD}>
            ＋ Block
          </button>
          <button onClick={() => edit((d) => void d.blocks.push(newWarmupBlock()))} className={ADD}>
            ☀ Warm-up / Cooldown
          </button>
          <button onClick={() => edit((d) => void d.blocks.push(newCondBlock()))} className={ADD}>
            ♥ Conditioning
          </button>
          <button onClick={() => edit((d) => void d.blocks.push(newTextBlock()))} className={ADD}>
            ✎ Metcon / notes
          </button>
        </div>
```

(`newBlock()` — the engine's version takes no heading argument, unlike the deleted coach-local one which took `'New block'`; the engine's own default heading is already `'New block'`.)

- [ ] **Step 7: Update the `edit`/`update` type parameters**

Find:

```ts
  const edit = (fn: (sess: CoachSession) => void) =>
```

No change needed here — `CoachSession` still resolves correctly via the Task 2 alias. Confirm this compiles once everything else above is in place.

- [ ] **Step 8: Update the block-adding button's typing for `d.blocks.push`**

`Block<PlannedSet>` is a union (`StrengthBlock<PlannedSet> | CondBlock | TextBlock`), and `d.blocks` is typed as `Block<PlannedSet>[]`. `newBlock()`, `newWarmupBlock()`, `newCondBlock()`, `newTextBlock()` each return one member of that union directly — no `as never` cast should be needed pushing them (unlike the old coach-local `newBlock('New block') as never` workaround). If TypeScript still complains about a push call, check that the imported type is `Block` from `@hybrid/engine` (not a narrower one) and that `d` is typed as `CoachSession` (`Workout<PlannedSet>`) inside `edit`.

- [ ] **Step 9: Run the full workspace typecheck**

Run: `pnpm --filter @hybrid/coach typecheck`
Expected: FAIL only on `App.tsx` (Task 7). Every error must be inside `App.tsx` — if any error remains in `Editor.tsx`, `ExerciseCard.tsx`, or `ConditioningCard.tsx`, fix it before continuing; do not proceed to Task 7 with unresolved errors elsewhere.

- [ ] **Step 10: Commit**

```bash
git add apps/coach/src/Editor.tsx
git commit -m "Coach Editor: real engine types, warm-up/metcon blocks, per-exercise supersets"
```

---

### Task 7: App.tsx — the last call sites

**Files:**
- Modify: `apps/coach/src/App.tsx`

- [ ] **Step 1: Fix the import**

Current:

```ts
import { fmtLabel, isCond, newSession, type CoachSession } from './model';
```

Change to:

```ts
import { CON_FORMATS, blockExercises, isCond } from '@hybrid/engine';
import { newSession, type CoachSession } from './model';
```

- [ ] **Step 2: Fix `preview()`**

Current:

```ts
function preview(s: CoachSession) {
  const names: string[] = [];
  const cond: string[] = [];
  let sets = 0;
  for (const b of s.blocks) {
    if (isCond(b)) {
      cond.push(fmtLabel(b.fmt));
      continue;
    }
    for (const e of b.ex) {
      if (e.name.trim()) names.push(e.name.trim());
      sets += e.sets.length;
    }
  }
```

Change to:

```ts
function preview(s: CoachSession) {
  const names: string[] = [];
  const cond: string[] = [];
  let sets = 0;
  for (const b of s.blocks) {
    if (isCond(b)) {
      cond.push(CON_FORMATS[b.condFmt].name);
      continue;
    }
    for (const e of blockExercises(b)) {
      if (e.name.trim()) names.push(e.name.trim());
      sets += e.sets.length;
    }
  }
```

(`b` is already `Block<PlannedSet>` here — `s.blocks` is typed that way via the `CoachSession = Workout<PlannedSet>` alias — so `blockExercises(b)` needs no cast at all, unlike the deleted coach-local `b.ex` access.)

- [ ] **Step 3: Fix `DayRow`'s title reference**

Current:

```tsx
          <b
            className={
              'block truncate text-5 leading-tight font-[750] ' +
              (on ? 'text-gold2' : sess ? 'text-text' : 'text-dim')
            }
          >
            {sess ? sess.title || 'Session' : 'Rest day'}
          </b>
```

Change to:

```tsx
          <b
            className={
              'block truncate text-5 leading-tight font-[750] ' +
              (on ? 'text-gold2' : sess ? 'text-text' : 'text-dim')
            }
          >
            {sess ? sess.name || 'Session' : 'Rest day'}
          </b>
```

- [ ] **Step 4: Run the full typecheck across the workspace**

Run: `pnpm run typecheck`
Expected: PASS across every package and app — `packages/config`, `packages/design`, `packages/engine`, `apps/coach`, `apps/mobile`, `apps/web`.

- [ ] **Step 5: Commit**

```bash
git add apps/coach/src/App.tsx
git commit -m "Coach App.tsx: read previews through the engine's own blockExercises/CON_FORMATS"
```

---

### Task 8: Full verification and push

**Files:** none (verification only)

- [ ] **Step 1: Run every test suite**

Run: `pnpm run test`
Expected: PASS — `packages/engine` (including the new `types.test.ts`), `apps/coach` (rewritten `model.test.ts`), `apps/mobile`.

- [ ] **Step 2: Bundle the mobile app**

Run: `pnpm --filter @hybrid/mobile bundle`
Expected: succeeds. (This task touches no mobile files, but the engine's `Workout` type change is shared — confirm nothing downstream broke.)

- [ ] **Step 3: Run the full verify chain**

Run: `pnpm run verify`
Expected: PASS — typecheck, test, `build:site`, `check:csp`, `smoke` (react-smoke), `smoke:deploy` (deploy-smoke). Pay particular attention to the existing react-smoke assertions `"coach builder mounts"` and `"a session can be authored and validates against the emit contract"` — these exercise exactly what this plan changed, in a real browser.

- [ ] **Step 4: Run the checks `verify` doesn't cover**

```bash
node checks/contrast.mjs
node checks/web-touch.mjs
node checks/docs.mjs
```

Expected: all PASS. `docs.mjs` in particular catches a stale README reference if any renamed export is mentioned there (it currently isn't, but confirm).

- [ ] **Step 5: Grep for any straggler references to deleted exports**

```bash
grep -rn "duplicateCoachEx\|CoachEx\b\|CoachBlock\b\|CoachCond\b\|AnyBlock\b\|fmtLabel\|condSummary\|effLabel\|effBand\|COND_FORMATS\|sessionToWorkout\|toAthleteEx" apps/coach/src apps/coach/test
```

Expected: no output. If anything remains, it is either a dead import to remove or a call site this plan missed — fix before continuing.

- [ ] **Step 6: Commit and push**

```bash
git add -A
git commit -m "$(cat <<'EOF'
Coach builder authors engine types — sub-project C, complete

Full parity with the athlete Planner: warm-up blocks, text blocks,
per-exercise supersets, explicit mode, tempo. CoachSession is now a type
alias for the engine's Workout<PlannedSet>, not a parallel shape translated
at publish time — sessionToWorkout/toAthleteEx are gone, and
assertPublishable is a one-line call into the engine's own emit.assertWorkout,
because the object it validates is already workout-shaped.

PlannedSet stays exactly {t, rpe}. A prescribed load still lives in cue.

migrateLib's ancient pre-blocks migration (flat exercises, spreadsheet
columns, weight-column folding) is gone — no real coach programme data
exists to preserve. What remains converts the CURRENT on-disk shape
(h/mins/ss/ex, already blocks-based) into engine shape, inferring a mode
only for migrated data, since freshly authored exercises choose one
explicitly from the start.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push origin main
```

- [ ] **Step 7: Confirm CI and OTA, the way every prior push in this session has been confirmed**

Poll `GET /repos/reflectprotect123-max/THE-HYBRID-ENGINE1/actions/runs` for the new commit SHA. Confirm CI reaches `completed`/`success`. This commit touches `packages/engine/src/types.ts`, so the mobile OTA workflow (`mobile-ota.yml`) will fire — confirm its `Publish EAS Update` step specifically executed and succeeded, not merely that the run's overall conclusion is green (per this repo's own documented trap: a skipped run and a real publish report identically).
