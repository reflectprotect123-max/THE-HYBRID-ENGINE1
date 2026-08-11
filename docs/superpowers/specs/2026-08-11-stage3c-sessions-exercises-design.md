# Stage 3c — Sessions and Exercises (and why Circuit is not built)

**Status:** design, approved 11 August 2026 · Part of the coach workspace
redesign (`2026-08-11-coach-workspace-redesign-design.md`)

## Goal

Complete the Library's tabs with the two that have real content behind them,
and say plainly why the third does not ship.

Of the mockup's five tabs, 3a builds Calendar, 3b builds Programs. This stage
covers what is left: **Sessions**, **Exercises**, **Circuit**. Unlike 3a and
3b, none of these has a desktop design in the mockup, so this spec makes the
calls rather than transcribing them. Each is stated with its reasoning so the
owner can overturn any of them.

## Sessions

**What it is.** The individual sessions a coach has authored — the things
Programs are made of and the Calendar's "Add from library" pulls from. Where
Programs answers "which plan", Sessions answers "which single workout".

**Data.** It already exists: `coach_workout_drafts` stores the real engine
`Workout` shape per template, and `listWorkoutDrafts` already feeds
`CoachAuthoring`. Sessions is a second, better-organised view of drafts the
coach can already see — not a new store.

**Desktop.** A table consistent with Programs: name, kind (strength /
conditioning), block count, when it was last edited, and draft status.
Selecting one opens the day builder in library mode — the same screen 3a
builds, reached a second way. No new editor.

**Phone: the mockup's clone is not adopted.** The mockup contains a
mobile-only Sessions view (`th-*`) described in its own comment as a "literal
clone of a reference app's screen per explicit request", carrying its own
accent colour and its own nav break pattern.

It is not built as drawn, for a stated reason: Stage 1 established one visual
language across `/coach` and a phone-width standard proven per route by
`checks/screens.mjs`. Importing a second app's accent colour and navigation
into one tab breaks both, and the workspace would have exactly one screen that
looks like somewhere else. Sessions gets the same responsive treatment as
every other tab.

This is the one place 3c overrides an explicit request in the mockup, so it is
flagged rather than buried. If the owner wants the clone, it is a small,
contained change — the tab, not the architecture — and this section is where
the decision should be recorded when it changes.

## Exercises

**What it is.** The movements that appear across the coach's sessions, with
enough structure to find one.

**Built from real usage, not a seeded list.** `knownMovements(db.workouts,
db.sessions)` already derives exactly this in the athlete Library, from
authored workouts and logged sessions. Exercises reuses it rather than
introducing a parallel catalogue that could disagree with it.

**Amended 11 August 2026: the catalogue itself moves to 3a.** This section
originally absorbed the deferred tagged exercise catalogue. After the owner
chose to build the day builder as the mockup draws it, that builder's
"+ Add exercise from library" picker needs the tagged catalogue to exist, so
the catalogue — the derivation, the tags, the counts — is built in 3a.

What remains here is the **tab**: a browsable view of the catalogue 3a
produces, with search and tag filtering. It consumes; it does not define. A
second catalogue built here would be exactly the duplicate this section was
written to prevent.

Tagging is still what makes this worth a tab rather than a scrolling list —
finding by pattern, hinge or squat or press or pull, rather than by
remembering a name.

**Scope discipline.** The tab lists movements, shows where each is used, and
supports search and tag filtering. It does not become an exercise database
with demo videos, coaching cues, or per-movement analytics. Those are a
product, not a tab.

## Circuit — not built

The mockup gives Circuit a tab and nothing else. There is no panel, no data
model, and no definition of what a circuit is in this system beyond a
free-text option inside the day builder.

**A tab is not a feature.** Stage 1's whole-branch review found three routes
that existed with no way to reach them, and this stage's sibling spec (3a)
already rejects shipping five tabs with three empty for the same reason: a
surface that opens onto nothing is a defect regardless of how it got there.

So Circuit does not ship as a tab. The day builder keeps its free-text circuit
option, which is what actually exists today. When a circuit has a definition —
what it holds, how it differs from a conditioning block, whether it is
reusable — it gets a brainstorm and its own spec, and the tab arrives with
something behind it.

## Ordering

Sessions before Exercises. Sessions closes the loop 3a and 3b open — the
Calendar's "Add from library" and a program's composition both want a place
that lists sessions — while Exercises is genuinely standalone and can slip
without blocking anything.

## Rules that do not move

- Behind `ClientDetailGate`.
- Every number from real data; absent data stated, never faked. A coach with
  no authored sessions sees an honest empty state that says how to make one.
- One editor: Sessions opens the day builder, it does not grow its own.
- Tests colocated.

## Testing

- A colocated test per tab.
- A test that selecting a session opens the day builder in library mode —
  the guard against a second editor appearing by accident.
- Exercises: a test that the movement list comes from real workouts and
  sessions, and that a coach with neither sees the empty state rather than a
  seeded list.
- Both tabs in `checks/screens.mjs` at 420px, with content assertions, as
  Stage 1's routes have.

## Out of scope

- The Circuit tab, per above.
- Any second editor.
- Exercise media, cues or analytics.
