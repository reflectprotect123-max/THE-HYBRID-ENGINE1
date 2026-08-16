# Exercise Wizard design

16 August 2026

## Why

The coach bench's block/exercise builder (`BlockEditor.tsx`, `ExerciseItem`,
`ExercisePicker.tsx`) works, but a coach described actually using it as "very
very clunky" — not slow, but too many steps and too confusing a layout for
what should be a quick, repeated action: adding an exercise to a block. The
four bug reports fixed earlier the same day (duplicate-exercise-on-second-click,
the buried second-column dropdown, the unreachable block heading field, the
missing tempo slot) were symptoms of the same root cause — a single busy form
with everything visible at once, where it's easy to leave a field in a bad
state or miss one entirely.

This spec replaces how a coach *adds* and *edits* one exercise inside a
Strength/Power (or other non-conditioning) block with a guided, one-question-
at-a-time flow. It does not touch conditioning blocks, the day-level flow
(instructions, templates, add block), or anything about which block a coach
is working in.

## Where this came from

This repository had almost exactly this shape once: `GuidedBuilder.tsx` and
its step components (`BlockTypeStep`, `MovementStep`, `SetsStep`, `RepsStep`,
`RpeStep`, `CondDetailStep`, `TextStep`), deleted 14 August 2026 with the old
authoring chain because it walked a coach through *authoring a whole week*
for the Coordinator regime — a regime that no longer exists (see CLAUDE.md,
"The old authoring chain is deleted"). Reproduced faithfully from git history
(commit `5415dbe1^`) as a reference during this design, it confirmed two
things: the one-question, glyph-tile/chip/stepper visual language is worth
keeping, and its step *count* (7, including a block-type step this design
doesn't need) and total lack of a review step are not.

Nothing about the deleted package (`@hybrid/guided-flow`), its `Workout`
schema, or its hand-off to the deleted `Planner` is reused. This is a fresh
component against today's `BlockValue`/`BlockExercise` model, wearing the old
component's look.

## Scope

Exercise add/edit only, inside a non-conditioning block (`CondBlockFields` and
its data shape are untouched). Block-level fields (name, kind, minutes,
superset) stay exactly as they are — a block's kind is chosen before this
wizard ever opens.

## The flow

A full-screen takeover (`ExerciseWizard`), same component at phone and
desktop width, replacing the block's exercise-list view while it's open:

1. **Exercise** — search/pick from the library, or "+ New exercise". Reuses
   today's `ExercisePicker` unchanged.
2. **Measure** — what the sets track: Reps + Weight, Reps only, Seconds, or
   Distance. Glyph tiles, in the old wizard's style. This step didn't exist
   before today — it's today's `columnA`/`columnB` dropdown pair, moved to
   the front instead of being reachable only after adding the exercise.
3. **Sets** — how many, via the old wizard's circular +/− stepper.
4. **Values** — the reps/seconds/weight number(s), one shared value applied
   to every set (not stepped through per-set — most sessions in this app
   program one shared value per exercise, and per-set overrides remain
   available afterward via the review card or the block's own set table).
   Reps/seconds/distance use the old wizard's preset chips (5/8/10/12/max)
   plus a custom box; weight — a field the old wizard never had at all — is
   a plain labelled number input, shown only when Measure is Reps + Weight.
5. **Review** — one card: the exercise name and shape at a glance, plus the
   optional extras that already exist on `BlockExercise` (rest/pacing,
   target RPE, tempo) to fill in or skip. "Add exercise" commits it and
   returns to step 1, ready for the next one. The old wizard committed
   blind, with no look-back — this step is new, specifically to catch the
   kind of mistake the four bug reports were.

Each step (after the first) has Back; the first step's Back reads "Back to
block" and closes the wizard with nothing added. A "Skip to review" link is
available from step 2 onward for a coach who already knows every value.

## Speed features

- **Remembers the last shape.** After the first exercise added in a block,
  Measure/Sets/Values default to whatever was just used, so steps 2–4 become
  a confirming tap each for the common case of several similar exercises in
  one block.
- **Skip to review**, pre-filled with defaults/remembered values, editable
  there — the fast path for a coach who doesn't need to be walked through it.
- **Editing** an existing exercise (tapping its row in the block's list)
  opens the same wizard pre-filled with its current values. The skip-to-
  review shortcut is what keeps "change one number" from becoming a full
  re-walk.

## Presentation

Full-screen takeover, not a modal or drawer — the same component renders at
both 420px and 1440px, per CLAUDE.md's standing requirement that every
`/coach` route hold at both widths. A 44×44px minimum touch target applies to
every tile, chip, stepper button and pick-row (checked against
`ui-ux-pro-max`'s touch-target guideline, which the first draft of the review
card's chip row missed). A visible step count and a single-line progress fill
sit at the top of every screen — deliberately not a five-dot chrome bar
(dropped after a coach reaction that the flow "already feels like a lot");
one thin bar and a "2 of 5" line is the minimum wayfinding that still counts
as an indicator per that same guideline's "Progress Indicators" rule.
Committing an exercise shows a brief confirmation (a checkmark and the
exercise's shape) before returning to step 1, rather than silently closing —
per the same guideline's "Success Feedback" rule.

## Implementation notes

- New component `ExerciseWizard.tsx` in `apps/web/src/coach/library/`,
  replacing the inline `<ExercisePicker>` + always-expanded `<ExerciseItem>`
  combo inside `BlockEditor.tsx`'s strength body. `ExercisePicker` is reused
  unchanged as the wizard's step 1.
- **No data-model change.** `BlockExercise`, `SetRow`, `NONE_COLUMN` all stay
  exactly as they are (including the same day's tempo/rest/every additions).
  This is purely how a coach *arrives* at that same shape, not a new shape.
  Measure step 2 writes `columnA`/`columnB` using the existing
  `availableSecondColumns`/`NONE_COLUMN` machinery from `setColumns.ts`.
- `ExerciseItem`'s collapsed row (letter chip, name, "N Sets" pill, remove)
  stays as the block's list view; only what happens on click changes — opens
  the wizard instead of expanding in place.
- Testing: new `ExerciseWizard.test.tsx` covering the step sequence, the
  Measure→Values field wiring, skip-to-review, and remember-last-shape;
  `BlockEditor.test.tsx` updated for the new click behaviour. No routing
  changes, so `checks/screens.mjs`'s existing `/coach/day/:date` and
  `/coach/week/...` shots (required to hold at both 1440px and 420px per
  CLAUDE.md) are the phone/desktop proof — re-run, not extended.

## What this deliberately does not do

- No weight *editing* per set beyond the shared Values-step number — a coach
  who wants a genuine wave (e.g. 10/8/6 at three different loads) still uses
  the block's own set table after the wizard closes, exactly as today.
- No block-type step — the old wizard's first question doesn't apply here;
  a block's kind is a `BlockEditor`-level field, chosen elsewhere.
- No change to conditioning blocks, day-level template application, or the
  block-heading/rest-timer/tempo work already shipped earlier the same day.
