# Stage 3b — Programs, and making a program contain real sessions

**Status:** design, approved 11 August 2026 · Part of the coach workspace
redesign (`2026-08-11-coach-workspace-redesign-design.md`)

## Goal

Turn the Programs tab into what the mockup describes — "build a program once,
assign it to any athlete; every row is a reusable plan — tap one to see the
week broken down day by day" — and make that day-by-day view real rather than
decorative.

## The decision that shaped this

Asked how a program gets chosen, the owner said: *see all my programs and pick
myself*. Asked whether the day-by-day breakdown should be faked, shown as
whatever is true today, or built for real, the owner chose **build the real
thing**.

## Two things the current screen gets wrong

**It claims an opinion it does not have.** `CoachLibrary.tsx:49` reads:

```ts
const selected = templates.find((item) => item.id === selectedId) ?? recommended;
```

The coach already picks by clicking a row; the recommender only pre-selects
when nothing is clicked. But the panel is hardcoded to the label "ARC
recommends", so the instant a coach picks a program themselves, the app tells
them ARC recommended their own choice. The recommendation framing goes. If a
suggestion is ever shown again it is labelled for what it is — the closest
match to the current filters — and a coach's own pick is never relabelled as
the system's.

**It cannot show what a program contains.** `ProgramTemplate`
(`apps/web/src/coach/contracts.ts:58`) carries name, category, level,
`sessionsPerWeek`, `weeks`, a summary, progression stages, status and source.
There is no list of what happens on which day. "3× per week for 8 weeks" is a
label, not a plan.

## The data already has a home — no migration in phase 1

This was checked before designing, and it moves the estimate a long way:

- `program_template_versions.body` is jsonb, documented in the migration as
  "the engine-shaped body: **sessions per week, weeks, progression model,
  blocks**". The place for a program's sessions already exists.
- `coach-repository.ts:214` already selects
  `program_template_versions(version, body)`, reduces to the latest version,
  and reads `sessionsPerWeek`, `weeks`, `summary` and `progression` out of it.
  It never reads sessions only because the contract has no field for them.
- `arc-athlete-sync.ts:385` records that the body is "unconstrained,
  coach-written jsonb".

So phase 1 is a **contract + repository + UI** change. No migration, no staging
apply, nothing touching the cross-app boundary in
`20260804_fitness_ecosystem_contracts.sql`.

## Phase 1 — read, render, assign

**Contract.** `ProgramTemplate` gains the program's sessions, read from the
latest version body. The shape reuses the engine's existing `Workout` rather
than inventing a parallel one — `coach_workout_drafts.body` already stores
"the real Workout shape (name, blocks, days, dates, folderIds) from
packages/engine/src/types.ts", and a second shape for the same idea is how two
screens start disagreeing about what a block is.

**Repository.** `listProgramTemplates` reads the sessions out of the body it
already fetches. A body without sessions yields an empty list, not a
fabricated week.

**Programs tab.** A table of every program: name, category, level, dose
(`sessionsPerWeek` × `weeks`), and draft status. The training-system filter
(strength / conditioning) stays — it is a genuine filter, not a recommender.
The sidebar configurator goes.

**Expanding a row** shows that program's real sessions, and — per the owner's
choice — the assign controls sit with it: which client, preferred start date,
preferred training days, and the action. Everything about one program in one
place.

**A program whose body carries no sessions says so.** "No sessions recorded for
this program yet" — never an invented week, and never a silent empty box that
reads as a rendering bug. Existing programs will be in exactly this state until
phase 2 gives them a way to gain sessions, and that must not look broken.

**Assignment must survive the sidebar's removal.** `prepareAssignment`
(`CoachLibrary.tsx:52`) is the **only** program-assignment path in the app and
it needs three inputs that currently live in the sidebar: client, preferred
start date, preferred weekdays. They move into the expanded row. Its existing
semantics are kept exactly: it writes an assignment draft in state
`ready-for-coordinator`, and its message already says the right thing —
"preferred days are inputs; the Coordinator still resolves the week".

Deleting a sidebar and taking the only assign path with it is precisely the
defect Stage 1 shipped with roster approve/decline. The plan's verification
step for this task is a navigation walk that assigns a program end to end, not
a grep for a button.

## Phase 2 — programs that hold more than one session

Phase 1 renders whatever sessions a program's body holds. Something has to put
them there, and today one constraint prevents it.

`coach_workout_drafts` carries `unique (template_id)` — **one editable draft
per program template**. Since `publishWorkoutDraft` snapshots a draft into an
immutable version, a published program's body can only ever contain the single
session its one draft held. A program with three sessions a week cannot be
authored.

Phase 2 relaxes that so a template can hold several session drafts — the
natural key being `(template_id, workout_id)`, which `coach_workout_drafts`
already stores and already uses in its other unique constraint — and extends
the publish snapshot to carry all of a template's sessions into the version
body.

**This is a migration, and it is the one piece of Stage 3 that touches the
database.** Per `CLAUDE.md` it is applied in staging first, never run against
production without explicit approval and a rollback plan, and the existing
single-draft data must survive it unchanged. The plan treats applying it as an
owner action, not an implementer action.

Phase 1 ships and is useful without phase 2: it makes the table real, fixes the
false recommendation, and keeps assignment working. Phase 2 is what lets a
program become more than one session.

## Rules that do not move

- Behind `ClientDetailGate`, as every coach route is.
- Assignment proposes; the Coordinator resolves placement. Preferred days and
  start dates are inputs, and the UI says so.
- Every number from real data; an absent one is stated, never faked.
- Tests colocated.

## Testing

- The version-body reader is a pure function with its own tests: latest
  version wins, a missing body yields an empty session list, a malformed body
  does not throw.
- A test that a program with no sessions renders its honest empty state rather
  than a blank panel.
- An end-to-end walk that expands a program and assigns it, asserting the
  assignment draft was written — the guard against phase 1 quietly removing
  the only assign path.
- Programs at 420px in `checks/screens.mjs`, with a content assertion.

## Out of scope

- Editing a program's sessions in place. Phase 2 makes multi-session programs
  possible; authoring them richly is 3c and later.
- The recommender. It is removed, not rebuilt.
- Sessions, Exercises and Circuit tabs (3c).
