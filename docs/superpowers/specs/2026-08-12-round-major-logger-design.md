# Round-major logger and guided builder

**Date:** 12 August 2026
**Status:** design approved, implementation not started
**Prototype:** `https://claude.ai/code/artifact/08c70f5e-f2af-488a-a9b6-48671966b761`

The prototype is the specification. The app must come back as a mirror of it,
proven by check rather than by eye.

This document is in two halves. The first states the constraints that hold
across the whole job. The second cuts it into six slices, each one small enough
to plan, build and verify on its own, and each one leaving the repo green.

---

# Part one — the constraints

## 1. UI cannot be shared. A hook can.

`apps/web` is React DOM. `apps/mobile` is React Native under Expo 54. A `<div>`
does not render on Android; a `<View>` does not render in a browser. Any design
that claims to share screens between them is wrong before it starts.

What both apps already depend on is `react` itself. Hooks contain no JSX and
touch no DOM, so a hook is portable where a component is not.

**One engine, two bodies.** The engine is a hook in a shared package. The bodies
are per-app screens that render what the hook returns.

## 2. The engine is `@hybrid/session-authoring`

New package. Pure TypeScript. Depends on `react` and `@hybrid/engine`, and on
nothing that resolves to `react-dom` or `react-native`.

It owns:

- the block model — prep blocks (warm-up, cool-down) and strength blocks
  (single movement, or a superset of two)
- the round queue — which set is live, in which order, across a superset's
  interleaved rounds
- superset rotation
- the coaching fold — plan-anchored e1RM, the adjustment, and the message shown
  on the live card
- draft state — weight, reps and RPE being entered but not yet logged

Its entire public surface is one hook:

```ts
useSession(session: Session): {
  hot: { exercise: Exercise<LoggedSet>; setIndex: number; coach: Coach } | null;
  rounds: RoundView[];
  rest: { left: number; total: number; kind: 'set' | 'block' } | null;
  draft: Draft | null;
  setDraft(patch: Partial<Draft>): void;
  logSet(): void;
  rotate(blockId: string): void;
  skipSet(): void;
  addSet(exerciseId: string): void;
  goToBlock(index: number): void;
  finish(): void;
}
```

Anything an app needs that is not on this list is a change to the package, not a
local workaround in a screen.

## 3. Nothing is half-replaced

Every old screen is deleted in the same commit that switches its callers over.
There is never a commit in which the app cannot log a set, and never one in
which two authoring screens both exist.

| App | Deleted |
| --- | --- |
| `apps/web` | `screens/Logger.tsx`, `screens/Planner.tsx`, `screens/planner/*`, `screens/guided/*` |
| `apps/mobile` | `screens/Logger.tsx`, `screens/Planner.tsx`, `screens/guided/*` |
| `apps/web/src/coach` | `CoachAuthoring.tsx`'s imports of `Planner` and `GuidedBuilder` |

## 4. The lane contract closes

`checks/lane-contract.mjs` has exactly two entries left in `ALLOWED`, both
because the coach bench imports the athlete's `Planner` and `GuidedBuilder`.
Its own comment names the fix: promote them into a shared authoring package.

That is this package. When the bench renders its own screens on the hook, both
entries are deleted and the list is empty — and the athlete/coach rule becomes
absolute, exactly as `CLAUDE.md` says it should.

## 5. Storage keeps its shape

`Session` and `Block<LoggedSet>` in `packages/engine/src/types.ts` are unchanged.
Nutrition and coach partitions are untouched.

Two additions to the block model:

- a piece list on prep blocks — name plus seconds or reps, so "90 s cardio of
  choice" is expressible at all
- a per-round order on superset blocks, recording which movement led each round

## 6. Superset rotation is per round, not per block

- Grab the partner movement's grip in the round you are on, pull up ~22px, and
  the pair rotates.
- Rotation applies to every round that has **not started**.
- A round with at least one set already logged keeps the order it happened in.
  That is history, not a preference, and it is not editable.
- The grip is a real button: tap and keyboard Enter both rotate. A drag-only
  affordance is unreachable without a pointer.

A rotation changes nothing else — not the ladder, not the targets, not each
movement's own opener, increment or rest.

## 7. Carried over from the old Logger

Re-implemented against the new screens, not dropped: screen wake lock, the
per-set timer, the affordances row (swap, skip, add set), the sets table, and
session stats and progress.

## 8. The wipe

Existing logged sessions are **deleted**, on device and in Supabase. Taken as an
explicit product decision on 12 August 2026.

Stated plainly because it cannot be undone:

- training history is destroyed for every athlete on every device
- e1RM anchors and progression history restart from zero, so the first session
  after the wipe has no coaching memory to work from
- rollback would require a Supabase point-in-time recovery taken *before* the
  release

It reuses the existing "Start fresh" clear, which already handles both the
training records and the sync scaffolding (commits `9829e6c`, `52401bc`), rather
than a new destructive migration. It runs once, on first launch of the new
version.

Because nothing old is ever read, `sanitizeDB` gains no compatibility branch for
the previous block shapes, and none should be written "just in case".

**It is the last slice.** Data is not destroyed until the thing replacing it is
proven.

## 9. The greenlight gates

Nothing ships on inspection by eye. Three surfaces, not four — the coach bench
is web-only and there is no native coach app, per the coach-workspace rule in
`CLAUDE.md`.

| Surface | Where |
| --- | --- |
| Athlete app | `apps/web` |
| Athlete app | `apps/mobile` |
| Coach bench | `apps/web` only |

Three gates:

1. **Behaviour parity.** One script drives the prototype and the built surface
   through an identical sequence of taps, and asserts identical results: the
   same logged sets, the same coaching messages, the same rotation outcomes.
2. **Visual parity.** Screenshots of prototype and surface in the same states at
   412px, diffed pixel-wise.
3. **Repo gates.** `pnpm run typecheck`, the full test run,
   `pnpm run check:ecosystem`, `checks/screens.mjs`, and `check:lanes`.

A failing gate is never waived. The cause is found, the cause is fixed, the gate
is re-run. "Probably fixed" is not a state that exists — the check says so or it
does not.

## 10. No placeholders

Shipped code carries no `TODO`, no stub screen, no mock data, no "wire this up
later". A thing is either built or it is not in the diff.

## 11. Tests are colocated

`src/x.ts` is tested by `src/x.test.ts`, in the same directory, per the repo
rule. No `*.test.ts` under `test/`.

---

# Part two — the six slices

Each slice leaves the repo green and is independently revertable. The order is
not arbitrary: the engine is built before anything renders it, the gates exist
before the thing they judge, and the irreversible step is last.

## Slice 1 — the package

Build `@hybrid/session-authoring`: block model, round queue, rotation, coaching
fold, draft state, and `useSession`. No app touches it yet.

The coaching fold is ported from the prototype's arithmetic, which is itself the
existing engine behaviour: plan-anchored e1RM, `k` by rep range, the ±7.5% clamp,
lock-on-underperformance, and the two-easy-sets full correction.

**Tests** — colocated, and this slice carries the bulk of the suite:

- round queue across supersets with unequal set counts
- rotation: un-started rounds move, started rounds do not
- the coaching fold: hold, back-off, one jump, full correction, `max` sets
- draft state and the log transition

**Done when** typecheck and tests pass and the package is in the workspace.
Nothing user-visible changes.

## Slice 2 — the parity harness

Build the two parity gates as runnable checks, before there is an app screen to
point them at.

- `checks/parity-behaviour.mjs` — drives a target through a fixed tap script and
  emits a result trace (logged sets, coaching messages, rotation outcomes).
- `checks/parity-visual.mjs` — shoots a target at 412px in a fixed set of states
  and diffs against a baseline.

Both take a target so they can be pointed at the prototype or at any of the
three surfaces.

**Done when** both run against the prototype and record its trace and shots as
the baseline every later slice is measured against.

## Slice 3 — the athlete app on web

New builder and logger screens in `apps/web`, rendering `useSession`. Routes
switched. `screens/Logger.tsx`, `screens/Planner.tsx`, `screens/planner/*` and
`screens/guided/*` deleted in the same commit.

Carries the items in constraint 7 — wake lock, set timer, affordances, sets
table, stats.

**Done when** all three gates pass for the web athlete surface.

## Slice 4 — the coach bench

The bench renders its own authoring screens on the hook. `CoachAuthoring.tsx`'s
imports of `Planner` and `GuidedBuilder` are deleted, and with them the last two
entries in `checks/lane-contract.mjs`'s `ALLOWED`.

**Done when** all three gates pass for the coach surface **and** `check:lanes`
passes with an empty `ALLOWED` list. Per the check's own ratchet rule, a stale
entry is itself a failure, so this is self-proving.

## Slice 5 — the athlete app on mobile

React Native screens in `apps/mobile` on the same hook. `screens/Logger.tsx`,
`screens/Planner.tsx` and `screens/guided/*` deleted in the same commit.

**Done when** all three gates pass for the mobile athlete surface. Visual parity
is judged against the same 412px baseline as web — the prototype was drawn at a
real Android viewport for this reason.

## Slice 6 — the wipe, and release

The one-time "Start fresh" clear on first launch of the new version, per
constraint 8.

**Done when** all three gates pass on all three surfaces, `CLAUDE.md` is
corrected — `apps/mobile` is live and shipping via EAS, which the current text
denies — and the lane-contract section is rewritten to record that the list is
empty and the rule absolute.

---

## Out of scope

- the exercise catalogue behind the movement-name field
- editing a block after it is added; the builder reopens it as a fresh add
- conditioning, which is not a block kind here and stays with the conditioning
  engine
