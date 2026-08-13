# Coach Redesign Stage 2 — Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/coach/settings` in the workspace redesign's own styling, and bring it under the phone check — the last `/coach` route with neither.

**Architecture:** Stage 1 ported the mockup's stylesheet whole, and 34 `st-` rules for this screen have been sitting in `coach/coach-redesign.css` unused ever since. There is no mockup HTML left in the repo, so **that rule set IS the specification**: the grid, the tab column, the panels, the row shapes, the toggle, the advanced disclosure, the warning line, the save row and its confirmation note are all already described there, phone block included (`coach-redesign.css:689`). Every task writes JSX against existing class names and adds NO CSS. If a task finds itself wanting a new rule, that is the signal to stop and ask, not to write one.

This is stage 2 of `docs/superpowers/specs/2026-08-11-coach-workspace-redesign-design.md`. Stage 1 and stage 3a are shipped.

## What must not change

`CoachSettings` is not a mock. Four preferences round-trip through
`CoachWorkspaceRepository`, and the existing colocated suite pins them:

| Setting | Repository field |
|---|---|
| Training week begins | `weekStartsOn` (`'monday'` / `'sunday'`) |
| Default load unit | `defaultLoadUnit` (`'kg'` / `'lb'`) |
| Priority notifications | `priorityNotifications` |
| Three library toggles | `visibleLibraries.{strength,conditioning,beginnerFoundations}` |

The five tests in `CoachSettings.test.tsx` are the contract: five tabs with
Workspace active, switching tabs, loading saved settings on mount, saving
through the repository with a success message, and keeping defaults with a
failure message when `getSettings` rejects. **They may be rewritten to find
elements the new way, but not one of them may be deleted, and none of their
assertions may be weakened.** A test that stops asserting the repository call
is a test that stops protecting the only real behaviour on this screen.

The read-only rows are also not decoration. They state where authority sits —
"Pain or illness · Hold and human review", "Authoritative receipts · Backend
required" — and this stage restyles them, it does not edit what they claim.

## Global Constraints

- No new CSS. The `st-` rules are the spec; `.rd-select`, `.rd-btn` and the
  other shared redesign atoms are already there for the controls.
- **A task gate is `typecheck` AND tests, never tests alone.**
- Ends green: `pnpm run typecheck`, `pnpm run test`, `node checks/lane-contract.mjs`.
- No placeholders, no `TODO`, no stubbed row.
- Tests colocated, per the repo rule.

---

### Task 1: The shell — grid, tabs, panels

**Files:** Modify `apps/web/src/coach/CoachSettings.tsx`, `apps/web/src/coach/CoachSettings.test.tsx`

- [ ] **Step 1: Frame and tab column**

Replace the Tailwind `<main>`/`<header>`/grid with the redesign's own frame,
matching what the pillar screens already do (read `CoachCommandCenter.tsx` or
any pillar for how a stage-1 screen is framed — do not invent a second
convention). The section list becomes `.st-tabs` of `.st-tab`, with `.active`
on the current one, inside `.st-grid`.

- [ ] **Step 2: Panels**

One `.st-panel` per section. The stylesheet hides an inactive panel with
`display: none` and shows `.st-panel.active`; rendering only the active panel
is equally correct in React and is preferred — but then the active one must
still carry `.active`, or it inherits `display: none` and the screen goes
blank. That is the one trap in this task.

- [ ] **Step 3: Keep the tab tests passing, adapted**

The first two tests find tabs and assert which section shows. Update how they
query, keep what they assert.

- [ ] **Step 4: Gate** — `pnpm --filter @hybrid/web test -- CoachSettings` and `pnpm run typecheck`.

---

### Task 2: The rows

**Files:** Modify `apps/web/src/coach/CoachSettings.tsx`, `apps/web/src/coach/CoachSettings.test.tsx`

- [ ] **Step 1: The three row shapes**

`.st-row` carries `.st-row-text` (`.st-row-label` + `.st-row-sub`) and then
one of: a `select.rd-select`, an `.st-toggle`, or an `.st-row-value`. A
read-only row adds `.st-row.readonly`. `.st-row-value.alert` exists for a
value that should read as a warning — use it only where the current screen
already says something is unavailable or blocked, not to editorialise.

- [ ] **Step 2: The toggle**

`.st-toggle` with `.st-toggle-knob` inside, `.on` when checked. It is a
`<button>` in the stylesheet's shape, so it needs `role="switch"`,
`aria-checked`, and an accessible name — a bare styled div is not a control.
The old markup used a real `<input type="checkbox">`; do not lose what that
gave for free without replacing it deliberately.

- [ ] **Step 3: Advanced disclosure and warning**

`.st-advanced` is a `<details>` with a `summary`; `.st-warning` is the
owner-policy line in Decisions & safety.

- [ ] **Step 4: The honesty rows tell the truth**

Per the spec's "Settings says where the data actually lives" amendment
(13 August 2026), which was written after scoping found this screen asserting
the OPPOSITE of the truth. Read it before touching these rows.

The short version: the workspace is Supabase-backed (eight tables, RLS) and
the four editable preferences are the only device-local thing on the screen,
so "Coach workspace · Local demonstration" and "Multi-client data · Synthetic
fixtures only" are simply wrong.

- Multi-client data is **counted**, from the `listClients()` already on the
  contract — a derived number cannot go stale, and a written one always does,
  which is how these rows got here.
- Authoritative receipts says neither "backend required" nor "backed": the
  `autocoach_receipts` table exists and the bench does not read it. Say that.
- Add the row the screen is missing — the preferences are this-device-only
  (`localStorage`, `hybrid-arc-settings-v1`). Right now the screen blames the
  whole workspace for what is true of these four settings alone.
- "Offline replay · Not implemented" and "Assistant coaches · 0 invited" stay:
  both are still true, and there is no invite mechanism to count.
- The three Decisions & safety rows are NOT rewritten. They describe the live
  auto-coach policy and are exactly right.
- **No new contract methods.** `listClients` is the only thing already there
  and the only thing derived. Wanting another one is the signal to stop and
  ask, not to build backend to satisfy a label.

A test pins the counted row against a stubbed `listClients`, and pins that the
three safety rows still read what they read today.

- [ ] **Step 5: Gate** — the full `CoachSettings` suite, plus `pnpm run typecheck`.

---

### Task 3: Save row and the confirmation note

**Files:** Modify `apps/web/src/coach/CoachSettings.tsx`, `apps/web/src/coach/CoachSettings.test.tsx`

- [ ] **Step 1: `.st-save-row`**

The note becomes `.st-save-note`, which the stylesheet fades in with `.show`.
Every message the screen currently emits — save success, load failure, and
both demo buttons — routes through it, so there is one place a message
appears rather than two.

- [ ] **Step 2: A message that is not a success must not look like one**

`.st-save-note` is styled with `--color-ok`. The load-failure message
("Saved settings could not be loaded") is not a success, and the existing
test asserts it appears. Give it the failing treatment the stylesheet already
has (`.st-row-value.alert`'s `--color-zone-red`) via an existing class, or
keep the two messages in separate elements. Do NOT ship a red-meaning message
in green ink; if neither existing class fits, stop and report.

- [ ] **Step 3: Gate** — full suite, `pnpm run typecheck`.

---

### Task 4: The phone check, and the boundary it moves

**Files:** Modify `checks/screens.mjs`, `CLAUDE.md`

- [ ] **Step 1: Shoot it at 420px**

Add `/coach/settings` to `COACH_SHOTS` in `checks/screens.mjs`, with wait
patterns naming text only this screen shows. Run `node checks/screens.mjs`.
It fails on horizontal overflow, which is the point.

- [ ] **Step 2: Fix what it finds, in the stylesheet's own terms**

`coach-redesign.css:689` already has the phone rules for this screen — the
grid collapses to one column, the tabs turn into a wrapping row, and a row's
select goes full width. If those hold, the shot passes with no change. If it
overflows anyway, the repair belongs in the JSX or in the mockup's existing
responsive rules; a NEW rule means stop and report which element needed it
and why, exactly as stage 3a did for the calendar's hover-only affordance.

- [ ] **Step 3: Move the boundary in `CLAUDE.md`**

The coach-workspace section names the six routes covered at 420px and says
`/coach/settings` "is NOT yet covered — it is its own stage and joins
`checks/screens.mjs` when that stage lands and is verified the same way."
That stage is this one. Update the list, and follow the section's own
standing instruction: state the real boundary rather than leaving stale
wording. `/coach/review/:weekStart` remains untested and remains the named
candidate — do not guess its outcome.

- [ ] **Step 4: Gate** — `node checks/screens.mjs` green, `pnpm run typecheck`, `pnpm run test`.

---

### Task 5: Correct the record

Housekeeping, but the kind this repo treats as real: two documents currently
describe work that has shipped as unbuilt, and `CLAUDE.md` is explicit that a
stale statement must not be left standing.

- [ ] **Step 1:** `handoff.md`'s checkpoint says "Stage 3 (the Library) is specced in three parts; none of it is built." Stage 3a shipped on 11 August — `apps/web/src/coach/library/` holds the calendar, day builder, block editor, exercise picker and set rows, and `CLAUDE.md` already records `/coach/library` passing at 420px. Correct it, and add this stage.
- [ ] **Step 2:** `docs/superpowers/plans/2026-08-11-coach-redesign-stage3a.md` has 51 unticked boxes for shipped work. Tick them, or mark the plan complete at its head with the commit that landed it. An unticked plan for finished work is how the next reader concludes it is theirs to build.
- [ ] **Step 3: Gate** — no code changed; re-read both documents and confirm nothing else in them contradicts the tree.

---

## Self-Review

Against stage 2 of the spec: "the tabbed settings screen", in the mockup's
styling, arriving with its phone layout because the mockup's own rules carry
it (Task 1–3 and Task 4).

The risk worth naming: this screen's four real settings are easy to lose while
restyling, because nothing about the layout depends on them working. That is
why the repository contract is written out above and why the five existing
tests are protected by name rather than left to judgement.

Task 5 is not padding. The two stale documents were found while establishing
what stage 2 even was, and left alone they would cost the next reader the same
hour.
