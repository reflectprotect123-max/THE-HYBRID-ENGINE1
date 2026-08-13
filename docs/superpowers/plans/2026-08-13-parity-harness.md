# Parity Harness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the two gates that decide whether the rebuilt app is a mirror of the prototype — before the app exists, so they cannot be written to fit whatever got built.

**Architecture:** One driver script, many targets. Both the prototype and every app surface expose the same stable `data-parity` hooks, so a single tap script drives all of them and no per-target adapter exists to rot. The behaviour gate records a trace and diffs it; the visual gate records screenshots at 412px and diffs them pixel-wise. The prototype's run is the baseline both are measured against.

**Tech Stack:** Node ESM, Playwright, the repo's existing `checks/` conventions.

This is slice 3 of `docs/superpowers/specs/2026-08-12-round-major-logger-design.md`. It is independent of slice 2 and may run alongside it.

## Global Constraints

- Follow `checks/` conventions: a check is a `.mjs` under `checks/`, launched via `launchChromium` from `checks/_chromium.mjs`, wired into `package.json` as `check:<name>`, and it exits non-zero on failure.
- A missing Chromium is a SKIP with a reason, never a silent pass and never a crash — `launchChromium` already returns `{ skip }` for this; honour it.
- No placeholders — no TODO, no stub, no mock data.
- Tests colocated where the repo has tests; these checks are scripts, not unit tests, and live in `checks/` like their siblings.
- Ends green on the FULL suite: `pnpm run typecheck && pnpm run test`. The repo is currently green with **no** known-red exceptions, so any failure is yours or a real regression.

## The design decision this slice rests on

A parity script has to drive two implementations that share no markup: a hand-written HTML prototype and, later, React DOM and React Native screens. Two ways to do that:

- **Per-target adapters** — each target ships a module mapping abstract actions to its own selectors. Every new surface adds an adapter, every refactor breaks one silently, and an adapter that drifts makes the gate pass while the thing it guards is broken.
- **A shared hook contract** — every target labels the same elements with the same `data-parity` value, and one script drives them all.

This plan takes the second. The cost is a real obligation on slices 4, 5 and 6: their screens must carry these attributes, and a missing one fails the gate loudly rather than quietly. That obligation is the point — it is what makes the gate impossible to satisfy by accident.

**The hook vocabulary**, fixed here and binding on every later surface:

| `data-parity` | On | Meaning |
| --- | --- | --- |
| `add-block` | button | start adding a block |
| `kind-<warm\|lift\|ss\|cool>` | button | choose a block kind |
| `name` | text input | the name field on the current step |
| `equip-<barbell\|dumbbell\|machine\|bodyweight>` | button | equipment choice |
| `scheme-<straight\|ladder\|custom>` | button | set-shape choice |
| `next` | button | advance the builder |
| `back` | button | go back a step |
| `add-piece` | button | add a warm-up/cool-down piece |
| `done-block` | button | commit the block being authored |
| `start` | button | leave the builder, begin the session |
| `hot-name` | element | the live card's movement or set name |
| `hot-presc` | element | the live card's prescription line |
| `hot-why` | element | the coaching message — the string the gate asserts on |
| `hot-kg` | element | the live card's weight |
| `reps-up` / `reps-down` | button | rep stepper |
| `rpe-<n>` | button | rating chip, `n` being 7, 7.5 … 10 with the dot removed: `rpe-75` |
| `log` | button | log the set |
| `grip` | button | the superset rotate handle |
| `seg-<i>` | button | block strip segment `i` |
| `rest-dial` | element | the rest countdown |
| `rest-go` | button | leave the rest takeover |
| `receipt-<i>` | element | a logged set's receipt row |

React Native has no DOM attributes; on `apps/mobile` these map to `testID`, with the same values. Slice 6 owns that translation.

---

### Task 1: Pin the coaching messages the gate will assert on

Slice 1 shipped `packages/engine/test/golden/foldExercise.json` with six vectors. Four message branches have no golden behind them, and this slice's behaviour gate asserts on message strings. Pinning them first means the gate is measuring against something already agreed, rather than against whatever the code happened to emit on the day.

**Files:**
- Modify: `packages/engine/test/golden/foldExercise.json`
- Modify: `packages/engine/src/golden.test.ts` if the added vectors need it

**Interfaces:**
- Consumes: `foldExercise` from `@hybrid/engine`.
- Produces: golden coverage for every branch of `foldExercise`'s message.

- [ ] **Step 1: Find the unpinned branches**

Read `packages/engine/src/fold.ts` and list every distinct string `foldExercise` can return. Compare against the `message` values already in `foldExercise.json`. The four believed unpinned are:
- `'holding — the next jump is N kg, chase clean reps instead'`
- `'holding — one easy set is not evidence yet'`
- `'two easy sets — full correction'`
- `'one jump up — your R @ F was easy'`

Confirm that list yourself rather than trusting it, and report what you actually found.

- [ ] **Step 2: Compute a vector for each, by hand**

For each branch, construct an input that reaches it and work out the expected `setIndex`, `kg` and `message` **by hand** from the rule. Do not run the code and copy its output — a golden vector generated by the thing it tests proves nothing, and this file is the record of a deliberate behaviour change.

The arithmetic, from `packages/engine/src/fold.ts`:
- `repsToFailure(reps, rpe) = min(12, reps + (10 - rpe))`
- `e1rmOf(kg, reps, rpe) = kg * (1 + repsToFailure/30)`
- `anchor = e1rmOf(opener, first.reps, first.rpe)`; `plannedKg = anchor / (1 + repsToFailure(target)/30)`
- walk: `deviation = target.rpe - effective`, effective = `felt` unless `reps < rep floor`, then `10.5`. `kFor` = 3 for reps ≤ 3, 2.5 for reps ≤ 7, 2 above. Hard (dev ≤ −1): apply `clampPct(k*dev)` in full and lock. Easy (dev ≥ 1): apply `clampPct(k*dev/2)`, only when not locked.
- `want = planned * adj`, capped at `planned + inc` when `easyRun === 1` and not locked
- `roundToIncrement(v, inc) = Math.round(v / inc) * inc`

Note that the two `'holding'` variants are separated by increment: the "next jump is N kg" wording is used when `|want − planned| < inc` **and** `inc ≥ 2`; below that it says "one easy set is not evidence yet". Reaching the second needs a sub-2 increment — a 1.5 kg step reaches it with planned 63 and want 63.63, both rounding to 63.

- [ ] **Step 3: Add the vectors and run**

Run: `pnpm --filter @hybrid/engine exec vitest run src/golden.test.ts`
Expected: PASS. If a vector fails, your hand arithmetic and the code disagree — work out which is wrong and say so. Do NOT adjust the vector to match the code without establishing that the code is right.

- [ ] **Step 4: Full gate and commit**

Run: `pnpm run typecheck && pnpm run test`

```bash
git add packages/engine/test/golden/foldExercise.json packages/engine/src/golden.test.ts
git commit -m "Pin every coaching message, before a gate starts asserting on them"
```

---

### Task 2: Bring the prototype into the repository

The prototype is the specification, and it currently exists only in an ephemeral scratchpad directory that will not survive this session. A gate whose reference disappears is not a gate.

**Files:**
- Create: `checks/fixtures/prototype/rolling-logger.html`
- Modify: `docs/superpowers/specs/2026-08-12-round-major-logger-design.md` — point at the committed copy
- Create: `checks/fixtures/prototype/README.md`

- [ ] **Step 1: Copy it in**

Copy `/tmp/claude-0/-home-user-THE-HYBRID-ENGINE1/d30b5cca-0c7a-5866-8a26-5d3b78a831cf/scratchpad/rolling-logger.html` to `checks/fixtures/prototype/rolling-logger.html`, byte for byte. Do not reformat it, do not "improve" it, do not strip its comments — its comments record why each decision was made, and the file is a reference document as much as a fixture.

If that source path no longer exists, STOP and report BLOCKED. Do not reconstruct it from memory: a reconstructed reference silently redefines what the app is being measured against.

- [ ] **Step 2: Add the parity hooks**

Add `data-parity` attributes to the prototype per the vocabulary table in this plan's preamble. This is the only edit permitted to the file. Every hook in the table that the prototype has an element for must be present; a hook with no counterpart (there should be none) must be reported rather than skipped.

- [ ] **Step 3: Write the README**

`checks/fixtures/prototype/README.md` explains: that this file is the specification the rebuilt app is measured against, that the parity checks load it as their baseline, that `data-parity` attributes are a contract shared with the app and not decoration, and that changing this file changes what "correct" means — so it is edited only by a deliberate design decision, never to make a check pass.

- [ ] **Step 4: Update the spec's pointer**

In `docs/superpowers/specs/2026-08-12-round-major-logger-design.md`, the header currently points only at a hosted artifact URL. Add the in-repo path beside it, noting that the committed copy is the one the gates use.

- [ ] **Step 5: Verify it still runs**

Open the copied file in Chromium via a short throwaway script and confirm it loads with no page errors and the builder renders. Report what you did.

- [ ] **Step 6: Commit**

```bash
git add checks/fixtures/prototype docs/superpowers/specs/2026-08-12-round-major-logger-design.md
git commit -m "Commit the prototype: a gate whose reference is ephemeral is not a gate"
```

---

### Task 3: The behaviour gate

**Files:**
- Create: `checks/parity/script.mjs` — the tap script, shared by every target
- Create: `checks/parity/drive.mjs` — runs the script against a target, returns a trace
- Create: `checks/parity-behaviour.mjs` — the check
- Create: `checks/fixtures/prototype/trace.json` — the recorded baseline
- Modify: `package.json` — add `check:parity-behaviour`

**Interfaces:**
- Produces: `runScript(page): Promise<Trace>` from `drive.mjs`; a `Trace` is an ordered array of `{ step, hot: { name, presc, why, kg }, receipts: string[] }` records.

- [ ] **Step 1: Write the tap script**

`checks/parity/script.mjs` exports an ordered list of abstract steps. Each step is `{ label, actions }` where an action names a `data-parity` hook and what to do to it. It must build and then run this session, chosen because it exercises every branch the gate cares about:

1. a warm-up with two pieces, one timed and one reps
2. a superset of a barbell movement on a ladder and a dumbbell movement straight — the ladder gives a `max` set, the pair gives rotation
3. a bodyweight straight lift — exercises the no-weight path
4. a cool-down

Then run it: complete the warm-up, rotate the superset once, log every set rating a mix of on-target, easy and hard so the coaching message moves through several branches, and finish.

Record after every step: the live card's name, prescription, coaching message and weight, plus every receipt on screen.

- [ ] **Step 2: Write the driver**

`checks/parity/drive.mjs` executes the script against a Playwright page using only `[data-parity="…"]` selectors. When a hook is missing it must fail with the hook's name and the step label — "missing hook `hot-why` at step `log set 3`" is actionable; a timeout is not.

- [ ] **Step 3: Write the check**

`checks/parity-behaviour.mjs`:
- takes a target: `--target=prototype` (default) loads the committed HTML from `file://`; `--target=<url>` loads a running app
- with `--record`, writes the trace to `checks/fixtures/prototype/trace.json` and exits 0
- without it, runs the target and diffs against the recorded trace, printing every difference as `step → field: expected X, got Y`, and exits non-zero if any exist
- skips with a reason when `launchChromium` returns `{ skip }`

- [ ] **Step 4: Record the baseline**

Run: `node checks/parity-behaviour.mjs --record`
Then run it again without `--record` and confirm it passes against itself. A gate that does not pass against its own baseline is broken before it has judged anything.

Read the recorded trace before committing it. Every coaching message in it should be one of the strings pinned in Task 1; if one is not, either Task 1 missed a branch or the prototype and the engine disagree — report which.

- [ ] **Step 5: Wire it up and commit**

Add to `package.json`: `"check:parity-behaviour": "node checks/parity-behaviour.mjs"`.

```bash
git add checks/parity checks/parity-behaviour.mjs checks/fixtures/prototype/trace.json package.json
git commit -m "Record what the prototype does, so the rebuild can be measured against it"
```

---

### Task 4: The visual gate

**Files:**
- Create: `checks/parity-visual.mjs`
- Create: `checks/fixtures/prototype/shots/*.png` — the baseline
- Modify: `package.json` — add `check:parity-visual`

- [ ] **Step 1: Write the check**

`checks/parity-visual.mjs` drives the same script from `checks/parity/script.mjs`, shooting the device viewport at **412×915** at a named subset of steps — the states worth pinning, not every step: the empty builder, the block-kind picker, the review list, the running warm-up, the live superset card, the rest takeover, the block-done takeover, and the finish card.

Comparison is pixel-wise with a small per-pixel tolerance for antialiasing, and a failure threshold on the proportion of differing pixels. Choose both numbers, state them in the file with the reasoning, and make them constants at the top rather than magic numbers inline. On failure it writes the actual and a diff image beside the baseline so the difference can be looked at, and names the paths in its output — a visual check that reports only a percentage is unusable.

Do not add an image-diff dependency without checking what is already available; if a suitable one is not present, compare raw pixel buffers directly, which for this purpose is a few lines.

- [ ] **Step 2: Record the baseline**

Run: `node checks/parity-visual.mjs --record`, then run it again without the flag and confirm it passes against itself.

Then run it a third time. Any state carrying a live clock (the rest dial, the session timer, a running warm-up countdown) will differ between runs and make the gate flap. Find them and neutralise them — freeze or mask the clock — rather than raising the threshold until the flapping stops. Raising the threshold to absorb a moving clock blinds the gate to real differences of the same size. Report what you found and what you did.

- [ ] **Step 3: Wire it up and commit**

Add to `package.json`: `"check:parity-visual": "node checks/parity-visual.mjs"`.

```bash
git add checks/parity-visual.mjs checks/fixtures/prototype/shots package.json
git commit -m "Pin how the prototype looks, at a real phone viewport"
```

---

## Self-Review

Checked against slice 3 of the spec:

- *"`checks/parity-behaviour.mjs` — drives a target through a fixed tap script and emits a result trace"* — Task 3.
- *"`checks/parity-visual.mjs` — shoots a target at 412px in a fixed set of states and diffs against a baseline"* — Task 4.
- *"Both take a target so they can be pointed at the prototype or at any of the three surfaces"* — Task 3 Step 3 and Task 4, via `--target`.
- *"Done when both run against the prototype and record its trace and shots as the baseline"* — Task 3 Step 4, Task 4 Step 2.

Two things this slice adds that the spec did not anticipate, both load-bearing:

- **Task 1** pins the four coaching messages that had no golden vector. Carried out of slice 1 as its recommended first task here, because the behaviour gate asserts on exactly those strings.
- **Task 2** commits the prototype. The spec treats it as the specification but it lives only in an ephemeral scratchpad, so every later slice would have been measured against a file that had ceased to exist.

The `data-parity` vocabulary is an obligation this slice places on slices 4, 5 and 6, and it is written into the spec's slice descriptions by Task 2's edit so those slices inherit it rather than discovering it.

Type consistency: a `Trace` record is `{ step, hot: { name, presc, why, kg }, receipts }` in Tasks 3 and 4; `runScript(page)` has the same signature at both call sites; `--target` and `--record` mean the same thing in both checks.
