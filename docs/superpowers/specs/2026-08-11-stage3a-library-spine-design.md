# Stage 3a — the Library spine

**Status:** design, approved 11 August 2026 · Part of the coach workspace
redesign (`2026-08-11-coach-workspace-redesign-design.md`)

## Goal

Build the Library's spine: its tab shell, the Calendar month view, and the day
builder that the guided wizard finishes into. Everything here is already drawn
in the approved mockup (`#view-library`) or already decided; nothing in 3a
needs new visual design.

## Why this is 3a and not "Stage 3"

The original spec called the Library "the largest piece by a wide margin", and
it was right for a reason it did not state: only one of the mockup's five tabs
has a panel drawn. Splitting it:

- **3a (this spec)** — tab shell, Calendar, day builder, wizard rewire.
- **3b** — Programs, reworking today's assignment flow into the mockup's table.
- **3c** — Sessions, Exercises, Circuit. These have no desktop design at all and
  need their own brainstorm first. Exercises should absorb the deferred tagged
  exercise catalogue rather than duplicating it.

## Tabs: two now, not five

`CoachLibrary.tsx` has two tabs today — `templates` and `calendar`. 3a keeps
two: **Programs** (today's assignment flow, renamed; redesigned in 3b) and
**Calendar** (rebuilt here). Sessions, Exercises and Circuit appear when 3b and
3c build them.

The mockup draws all five. Shipping five with three empty is rejected
deliberately: Stage 1's whole-branch review found three routes that existed
with no way to reach them, and a tab that opens onto nothing is the same defect
in a different place. A tab appears when it has something behind it.

## Calendar

Month grid, Monday–Sunday, previous/next month, the month named ("August
2026"). Days outside the month render dimmed.

- An **empty day** offers **Create session** and **Add from library**.
- A **filled day** shows what is on it and opens the day builder.

The mockup exposes those two actions on `:hover`. Hover does not exist on a
phone, and this workspace is now a supported phone surface, so they must also
be reachable by tap. Hover may remain as a desktop affordance; it may not be
the only one.

**Cut from the mockup's toolbar**, with reasons:

- *Message team* — messaging is a feature this product has never designed. A
  button is not a feature.
- *Publish all* — a bulk write across an athlete's plan. It deserves its own
  design, not inheritance from a drawing. Publishing one day at a time is the
  3a scope.

Both may return later; neither is refused on principle.

## The day builder: one screen, two modes

The mockup's `#cal-session-builder` is the coach's authoring screen for one
day. It ships as a single component with two modes:

| | From the Calendar | From the wizard |
|---|---|---|
| Date heading | yes | no |
| Status dot | Unpublished / published | no |
| Coach instructions | yes | yes |
| Blocks | yes | yes |
| Primary action | **Publish session** | **Save to library** |

One screen rather than two, so the blocks-and-notes half is built and fixed
once.

**Block and set editing reuses the existing shared editor.** `Planner.tsx`
already isolates every mutation behind one `edit(fn)` closure, which is exactly
how `RosterPlanner` reuses it today with different save behaviour. The day
builder does the same. It does not reimplement block editing — a third copy is
how three screens start disagreeing about what a superset is.

## What "Publish" means, and the honesty rule it must obey

Publish calls the existing `repository.publishWorkoutDraft`, whose contract is
already the right one: it snapshots the draft into an immutable assignable
version and creates the assignment through "the same Coordinator-placement path
as assigning a shared template". It takes a **preferred** start date and
**preferred** weekdays.

So publishing **proposes**. The Coordinator remains the only writer of a weekly
plan, exactly as `CLAUDE.md` requires, and a coach pressing Publish has not
placed anything.

This creates the one real design problem in 3a. A screen headed "Tuesday,
August 11" with a Publish button implies the session will happen on Tuesday. It
will not necessarily: the coach states a preference and the Coordinator
resolves placement against readiness, conflicts and the rest of the week.

The app already refuses to blur this elsewhere — `CoachAuthoring` labels its
day toggles "PREFERRED DAYS · INPUT, NOT PLACEMENT" and notes that
"preferences are not resolved calendar positions". The Calendar must not
quietly contradict its sibling screen. Therefore:

- The day builder states that the date is a preferred day, not a placement.
- After publishing, the day reflects what the Coordinator actually resolved,
  not what the coach asked for. If those differ, the difference is visible
  rather than hidden.
- An unresolved day is shown as unresolved. It is never drawn as if placed.

This is the same rule the rest of the system already follows: an absent or
undecided fact is stated, never faked.

## Wizard rewire

`GuidedBuilder` currently ends by handing off to `Planner` — its header comment
says it "hands off to the existing Planner for anything beyond a session's
first pass". It ends at the day builder instead, in library mode.

That is what the 2026-07-29 builder design asked for and never received:
"coach instructions and Deliver/publish become the final full-screen step in
the flow, rather than a permanently-visible right-side panel". The carry-over
note (`2026-08-11-stage3-library-builder-carryover.md`, item 4) records it as
an unbuilt design item; 3a builds it.

Coach-side "Edit workout structure" (`CoachAuthoring.tsx:284`) also points at
the day builder. The dense `Planner` remains for the athlete app and as the
shared editing internals underneath both.

The carry-over's items 1 and 2 — the week grid and its cell affordances — are
resolved by this stage rather than deferred. The grid is superseded: the
mockup's month Calendar occupies its role, and the empty-cell actions the grid
was going to carry ("Create a session" / "Add from library") are exactly the
Calendar's empty-day actions. The grid is not built, and the carry-over item is
closed rather than carried.

## Rules that do not move

- Every route stays behind `ClientDetailGate` without `layer3Ready` unless it
  has a real layer-3 backend, exactly as Stage 1 established.
- The Coordinator is the only writer of a weekly plan.
- Nutrition is untouched by this stage.
- Decision logic stays in engines. The Calendar renders resolved state; it does
  not decide placement.
- Tests are colocated.

## Testing

- A colocated test per new component.
- The Calendar's month maths (which cells are in-month, week start, month
  boundaries) is a pure function with its own tests, not logic embedded in JSX.
- The day builder's mode switch is tested in both directions: dated mode
  renders Publish and the status; library mode renders neither.
- A test that the empty-day actions are reachable **by tap**, not only by
  hover — the phone case is the one a desktop reviewer will miss.
- `checks/screens.mjs` gains the Library at 420px, with a content assertion, as
  Stage 1's routes have.
- `checks/coach-contract.mjs` stays green.

## Out of scope

- Programs, Sessions, Exercises, Circuit panels (3b, 3c).
- Messaging, and bulk publish.
- Multiple sessions in one day. The mockup itself defers this ("multiple
  sessions in one day is next on the list — for now this day holds one").
- The athlete app.
