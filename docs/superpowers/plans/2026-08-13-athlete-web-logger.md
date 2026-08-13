# Athlete Web Logger — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `apps/web`'s session logger with the round-major one, rendered on `@hybrid/session-authoring`, and prove it a mirror of the prototype with both parity gates.

**Architecture:** One new screen directory rendering the shared hook. The hook owns every decision; the screen owns markup and the app's own side effects — wake lock, and the rest store that fires the rest-complete notification. Nothing about which set is live, what it should weigh, or what order a superset runs in lives in `apps/web`.

**Tech Stack:** React 19, React Router, Vite, Vitest, Playwright for the gates.

This is slice 4 of `docs/superpowers/specs/2026-08-12-round-major-logger-design.md`.

## Scope — deliberately narrow

**This slice replaces the LOGGER only.** `Planner.tsx`, `screens/planner/*` and `screens/guided/*` are not touched and not deleted. The old builder writes the same `Session` shape the new logger reads, so after this slice the app works end to end: author with the existing builder, log with the new logger. The builder replacement is its own slice, and separating them takes the blast radius from 14 files to 1.

That also means the two coach crossings in `checks/lane-contract.mjs` stay for now. They retire with the builder, not here.

## Two decisions taken before planning

**The prototype wins on the extras.** Spec constraint 7 lists five things carried over from the old Logger. Three survive because the prototype or the hook already has a home for them: the screen wake lock, the per-set timer (the warm-up piece's countdown), and skip / add-set (`skipSet` and `addSet` are already reducer actions). Two are dropped — the sets table and session stats — because the prototype has neither, so building them means inventing UI no parity gate can judge. Decided 13 August 2026.

**The rest notification is bridged, not reimplemented.** `apps/web/src/store/rest.tsx:92` fires a `Rest complete` Notification when its timer ends. The hook has its own rest model for the UI. The screen drives BOTH: the hook's rest paints the takeover, and starting it also calls the rest store so the notification and the global `RestChip` keep working. Reimplementing the notification in the new screen would leave two things that both think they own it.

## Global Constraints

- Every element the parity vocabulary names must carry its `data-parity` attribute. A missing one fails the gate loudly, which is the point. The vocabulary is the table in `docs/superpowers/plans/2026-08-13-parity-harness.md`.
- No decision logic in `apps/web`. If a diff in this slice computes a weight, picks the next set, or decides a superset's order, it is wrong — that belongs to `@hybrid/session-authoring` or `@hybrid/engine`.
- **A task gate is `typecheck` AND tests, never tests alone.** Vitest does not typecheck.
- Ends green on the full suite: `pnpm run typecheck && pnpm run test`. There is no known-red list; any failure is yours or a real regression.
- No placeholders — no `TODO`, no stub, no mock data.
- Tests colocated: `src/x.tsx` is tested by `src/x.test.tsx`, same directory.
- Follow the existing design system. Import from `../ui` (`Button`, `Card`, `Kicker`, `LetterChip`, `Meter`, `cx`) and the tokens in `@hybrid/design` rather than inventing colours. The prototype's palette was taken FROM those tokens, so they should already agree.

## A note on how this plan specifies UI

For the pure-logic slices this plan's predecessors gave complete code, because there was one right answer and it could be written down. Here the tasks give the component structure, the exact `data-parity` attributes, the props, the state each piece may touch, and the acceptance the gates apply — but not finished JSX. The implementer can read the design system and the prototype; a plan that pasted invented JSX against a design system it had not read would be guessing, and the gates are what decide correctness anyway. Where a specific string or number matters, it is given exactly.

---

### Task 1: Split the parity script into a build phase and a run phase

The script currently authors a session through the builder, then runs it. This slice replaces only the logger, so the app cannot satisfy the build half. Split it, and give the run phase a way to start from a known session.

**Files:**
- Modify: `checks/parity/script.mjs`, `checks/parity/drive.mjs`, `checks/parity-behaviour.mjs`, `checks/parity-visual.mjs`
- Modify: `checks/fixtures/prototype/trace.json`, `checks/fixtures/prototype/shots/`
- Create: `checks/fixtures/session.json`

**Interfaces:**
- Produces: `--phase=build|run|all` on both gates, defaulting to `all`; `checks/fixtures/session.json`, the exact session the run phase expects.

- [ ] **Step 1: Extract the session the build phase produces**

Drive the prototype through the existing build steps and dump the `session` object it produced. Write it to `checks/fixtures/session.json`. This is the contract between the two phases: the build phase must END at this session, and the run phase must START from it.

- [ ] **Step 2: Tag every step with its phase**

In `script.mjs`, mark each step `phase: 'build'` or `phase: 'run'`. The boundary is the `start` tap — that step belongs to `build` as its last action.

- [ ] **Step 3: Teach the driver to seed**

The run phase against a `--target=<url>` app needs the app to be holding that session. Add a seeding step: before navigating, write `checks/fixtures/session.json` into the target's storage under the key `apps/web` uses (`LS_KEY` from `@hybrid/engine` — read it rather than hardcoding the string), then navigate straight to the logger route. Against `--target=prototype` there is nothing to seed; the prototype builds its own session, so the run phase there simply replays the build steps first without recording them.

- [ ] **Step 4: Re-record and verify both phases**

```
node checks/parity-behaviour.mjs --record
node checks/parity-behaviour.mjs                 # all
node checks/parity-behaviour.mjs --phase=run     # run only
node checks/parity-visual.mjs --record
node checks/parity-visual.mjs
```

The full-phase trace must be UNCHANGED from the committed one — you are only labelling steps, not altering them. `git diff checks/fixtures/prototype/trace.json` should be empty. If it moved, say precisely why before going further.

- [ ] **Step 5: Commit**

```bash
git add checks
git commit -m "Split the parity run from the build, so a logger-only rebuild can be judged"
```

---

### Task 2: The screen shell, and the state bridge

**Files:**
- Create: `apps/web/src/screens/logger/SessionLogger.tsx`
- Test: `apps/web/src/screens/logger/SessionLogger.test.tsx`

**Interfaces:**
- Consumes: `useSession` from `@hybrid/session-authoring`; `useDb`, `useRest` from the app's stores; `requestWakeLock`/`releaseWakeLock` from `apps/web/src/native/wakeLock`.
- Produces: `SessionLogger`, the component the route will render in Task 7.

What it does, and nothing more:

- reads the active session from `useDb()` and hands it to `useSession`
- persists back: whenever the hook's session changes, call `updateSession(id, …)` so the store and cloud sync see it. Debounce or write on change — match how the existing `Logger.tsx` writes, at `updateSession` call sites around lines 262-432, rather than inventing a new cadence
- holds the wake lock while the session is running, releasing on unmount — port the effect at `Logger.tsx:151-166`
- bridges rest: when the hook's `rest` becomes non-null with a `'set'` kind, call the rest store's start with the same seconds, so the existing rest-complete Notification and `RestChip` fire. When the hook's rest clears, clear the store's
- renders the block strip, the current block, and the rest takeover — all from Task 3-5, stubbed in this task ONLY as far as the structure needs, with no placeholder text reaching the DOM
- carries `data-parity` on nothing yet; the pieces own their own hooks

Tests: that it renders a seeded session without crashing, that a session change reaches `updateSession`, and that the wake lock is requested on mount and released on unmount.

- [ ] Steps: write the failing test, run it, implement, run it, run the full gate, commit.

---

### Task 3: The block strip and the block screens

**Files:**
- Create: `apps/web/src/screens/logger/BlockStrip.tsx`, `apps/web/src/screens/logger/BlockScreen.tsx`
- Test: colocated `.test.tsx` for each

`BlockStrip`: one segment per block, each `data-parity="seg-<i>"` where `i` is the block's index in the session, globally. A segment shows the block's title and its progress fill, and tapping it dispatches `goToBlock`. The current block is marked.

`BlockScreen`: the rounds of one block. For each round in the order the hook reports (never recomputed locally):
- a logged set renders a receipt, `data-parity="receipt-<i>"`, `i` counting within THIS block in DOM order
- the live set renders the hot card from Task 4
- an unstarted set renders a future row

For a superset, each round carries its label, and the partner row in the round currently live carries the rotate grip, `data-parity="grip"`, which dispatches `rotate`. The grip must be a real `<button>` — tap and keyboard Enter both rotate. A drag-only affordance is unreachable without a pointer, and the prototype's own note says so.

Tests: receipts number within a block rather than across the session; a rotated round renders in its new order; the grip appears only on a round that has not started.

---

### Task 4: The hot card

**Files:**
- Create: `apps/web/src/screens/logger/HotCard.tsx`
- Test: `apps/web/src/screens/logger/HotCard.test.tsx`

The live set. Hooks, exactly:

| element | `data-parity` |
| --- | --- |
| movement or set name | `hot-name` |
| prescription line | `hot-presc` |
| coaching message | `hot-why` |
| weight | `hot-kg` |
| rep stepper | `reps-up`, `reps-down` |
| rating chips | `rpe-70`, `rpe-75`, `rpe-80`, `rpe-85`, `rpe-90`, `rpe-95`, `rpe-100` |
| log button | `log` |

The rating chip values are 7, 7.5, 8, 8.5, 9, 9.5, 10 with the dot removed and a trailing zero — `rpe-75` is 7.5. Take the chip list from the prototype rather than inventing it.

`hot-why` renders the hook's message verbatim. It must not be reworded, truncated, or conditionally hidden — the behaviour gate asserts on that exact string, and every branch of it is pinned in `packages/engine/test/golden/foldExercise.json`.

The log button is disabled until `draftReady`. Weight is editable; a bodyweight exercise shows no weight control at all.

Tests: the coaching message renders verbatim; log is disabled without a rating; a bodyweight exercise renders no weight field; the rep stepper floors at zero.

---

### Task 5: The rest takeover

**Files:**
- Create: `apps/web/src/screens/logger/RestTakeover.tsx`
- Test: `apps/web/src/screens/logger/RestTakeover.test.tsx`

Covers the screen while resting. `data-parity="rest-dial"` on the countdown, `data-parity="rest-go"` on the button that leaves it.

The distinction that matters, and which the prototype had to be fixed to get right: a rest with a clock shows the dial; a block turn (`kind: 'block'`, total 0) shows NO dial. A spent 0:00 dial reads as a timer that ran out rather than as a block ending.

It also shows what is next — the next set's movement and weight during a rest, the next block's name on a turn — and offers +15 seconds during a timed rest only.

Tests: a block turn renders no dial; a timed rest does; +15 extends both left and total.

---

### Task 6: Warm-up pieces, the finish card, and skip / add set

**Files:**
- Create: `apps/web/src/screens/logger/PieceCard.tsx`, `apps/web/src/screens/logger/FinishCard.tsx`
- Test: colocated

`PieceCard`: a warm-up or cool-down piece. A timed piece runs a countdown and carries `data-parity="piece-done"` on its Done control; a rep piece just has Done. This is where the per-set timer carried over from the old Logger lives.

`FinishCard`: the session receipt at the end — blocks, sets logged, best e1RM, and a comment box. Numbers come from the hook's view, not recomputed here.

Skip and add-set: two controls dispatching `skipSet` and `addSet`. These are the surviving half of the old Logger's affordances row. Place them where the prototype's layout allows without inventing a new region; if there is genuinely nowhere, say so in your report rather than forcing them somewhere the gate will then pin.

---

### Task 7: Switch the route, delete the old Logger, and pass both gates

The commit where it becomes real.

**Files:**
- Modify: `apps/web/src/App.tsx:95` — the `/log/:bi/:ei` route renders `SessionLogger`
- Delete: `apps/web/src/screens/Logger.tsx` and its colocated test
- Modify: `package.json` if the gate scripts need a target argument

- [ ] **Step 1: Switch the route and delete, in ONE commit**

`Logger.tsx` has exactly one importer, `App.tsx:17`. Change the import and the route, delete the file, in the same commit. There must be no commit where both exist and none where neither does.

- [ ] **Step 2: Run the app and point both gates at it**

Start the dev server, then:

```
node checks/parity-behaviour.mjs --phase=run --target=http://localhost:5173
node checks/parity-visual.mjs --phase=run --target=http://localhost:5173
```

- [ ] **Step 3: Fix what they find — and read what they say**

Expect failures on the first run; that is what the gates are for. For each:
- a missing hook means the screen is incomplete — add it
- a differing coaching message means the screen is rewording what the engine said — stop rewording it
- a visual difference means the markup differs from the prototype — look at the diff image the gate names, and fix the screen

Do NOT re-record the baselines to make failures go away. The baselines describe the prototype, which is the specification. Re-recording is how a parity gate becomes decorative. If you believe a baseline is genuinely wrong, stop and report it rather than overwriting it.

- [ ] **Step 4: Full gate**

`pnpm run typecheck && pnpm run test && pnpm run check:lanes && node checks/screens.mjs`

- [ ] **Step 5: Commit**

---

## Self-Review

Against slice 4 of the spec:

- *"New builder and logger screens in `apps/web`, rendering `useSession`"* — the logger half only, by the surgical scoping above. The builder half moves to its own slice and the spec's slice list should be updated when this lands.
- *"Routes switched"* — Task 7.
- *"`screens/Logger.tsx` … deleted in the same commit"* — Task 7 Step 1. `Planner.tsx`, `screens/planner/*` and `screens/guided/*` deliberately survive this slice.
- *"Carries the items in constraint 7"* — three of five carried, two dropped with the decision recorded above.
- *"Done when all three gates pass for the web athlete surface"* — Task 7, run phase only, because this slice does not rebuild the builder.

Known consequence, stated rather than hidden: until the builder slice lands, `apps/web` contains one authoring UX and one running UX from different designs. The spec's "never two authoring screens at once" rule is about not having two screens for the SAME job, and this does not breach it — but the app will look inconsistent to you in the meantime, and that is the price of getting a working logger sooner.
