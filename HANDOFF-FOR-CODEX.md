# Handoff pack — THE Hybrid System

Generated 13 August 2026 from branch `claude/handoff-md-review-z00wqf`
(commit `86da3bf`, 67 commits ahead of `main`, not merged, no PR open).

## Read these, in this order

1. **`handoff.md`** — the authoritative checkpoint is the block at the very
   top, dated 13 August. Everything below it is history and is marked as
   superseded. This is the fastest way to know what is true today.
2. **`CLAUDE.md`** — the operating contract. Product ownership (which package
   is allowed to decide what), the athlete/coach lane rule, where a test goes,
   the coach-workspace phone boundary. It is not documentation of intent; the
   rules in it are enforced by checks.
3. **`AGENTS.md`**, **`README.md`**, **`DEBUG_ORIENTATION.md`**,
   **`PRODUCT_NOTES.md`** — supporting context.
4. **`docs/superpowers/specs/`** and **`docs/superpowers/plans/`** — the specs
   are the design decisions with their reasoning; the plans are the
   task-by-task execution records. The live one is
   `plans/2026-08-13-coach-redesign-stage2.md` (task 1 done, tasks 2–5 open).

## What is in this zip

The complete working tree **and `.git`**, so the history comes with it.
Excluded: `node_modules`, build output (`apps/web/dist*`,
`apps/mobile/.expo-export`), Expo and Metro caches, and check output
directories. Nothing source-shaped is missing.

The history is not padding — it is where the reasoning is. Sixty-eight commits
explain why most of this code is shaped the way it is, and the commit messages
carry the argument that the files themselves only carry the conclusion of.
`git log` before you change anything load-bearing.

Two things to know about the repository you are unzipping:

- It is a **shallow** clone (`.git/shallow`). Recent history is complete;
  the earliest commits are grafted. `git fetch --unshallow` against the remote
  fills it in if you need the full record.
- `git worktree list` names three worktrees at paths that will not exist on
  your machine. They are stale registrations, harmless, and
  `git worktree prune` clears them.

The checked-out branch is `claude/handoff-md-review-z00wqf`. It is 68 commits
ahead of `main`, unmerged, with no PR open. Remote:
`https://github.com/reflectprotect123-max/THE-HYBRID-ENGINE1`.

## Getting it running

```bash
pnpm install
pnpm run typecheck        # clean as of this pack
pnpm run test             # 617 passing / 2 skipped across 91 files
pnpm run check:ecosystem
node checks/lane-contract.mjs
```

Product builds:

```bash
pnpm --filter @hybrid/web build:strength
pnpm --filter @hybrid/web build:conditioning
```

## The two parity gates — read before touching the logger

The mobile logger is judged against a committed HTML prototype at
`checks/fixtures/prototype/`. Both gates drive Chromium.

```bash
pnpm run check:parity-mobile          # behaviour + visual, against the harness
node checks/parity-behaviour.mjs --target=proto
node checks/parity-visual.mjs --target=proto
```

- **Behaviour gate PASSES.** 19 steps against the prototype, 18 against the
  harness; the missing step is a prototype-only affordance and the driver says
  so at the point it is skipped.
- **Visual gate: four of eight shots still fail, and this is accepted.**
  live-superset 7.33%, finish-card 2.85%, rest-takeover 2.00%, block-done
  1.30%, against a 0.1% threshold. Element-by-element measurement shows
  identical tops and heights — the residual is glyph rasterisation between
  Chromium's own text rendering and React Native Web's. The owner reviewed the
  four images and chose to accept it. **Do not close this by raising the
  threshold.** If you improve it, improve it with measurement.

The harness (`apps/mobile/parity/Harness.tsx`) is reached only through
`apps/mobile/src/root.web.tsx`. Metro's platform extensions keep it out of the
native bundle, and `node checks/parity-harness.mjs --android` proves that by
grepping the Hermes bytecode.

## Rules that are enforced, not advisory

- **The athlete and the coach never import each other.**
  `node checks/lane-contract.mjs` resolves every relative import under
  `apps/web/src` into a graph and asserts it. The allow-list is EMPTY.
- **Tests are colocated.** `src/lift.ts` is tested by `src/lift.test.ts`, same
  directory, no exceptions. `test/` directories hold fixtures and golden
  vectors only. Both trees are collected — do not "tidy" either half away, or
  a test silently stops running and the suite still reports green.
- **One owner per decision domain.** The Coordinator is the only layer that
  picks a weekly plan. Nutrition never edits one. Pain and illness are safety
  flags that outrank every readiness or nutrition signal, and they never move
  into a specialist engine.
- **`runtimeVersion` in `apps/mobile/app.json` is bumped BY HAND**, only for a
  native change, in the same commit. Read the `//runtimeVersion` note there
  before changing it — the reason it is a fixed string and not `fingerprint`
  is written out, and it cost a release to learn.

## Known open items

- The four visual-parity shots above (accepted, not fixed).
- The owner installed the APK and reported it "doesn't look any different".
  The build is confirmed correct — EAS run `31676133660` on commit `00a27498`,
  success — and only the logger screen changed, reached by opening a session
  and tapping an exercise. Unresolved.
- Coach redesign stage 2, tasks 2–5.
- Stage 3b (Programs) and stage 4 (responsive close-out) are not started.
- `/coach/review/:weekStart` has never been checked at phone width.
