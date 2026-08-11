# Stage 3 carry-over: the guided builder's unbuilt half

**Status:** notes for Stage 3 (Library) · **Date:** 2026-08-11

Recorded during the Stage 1 handoff, when the owner asked what happened to
the builder designed in `2026-07-29-coach-builder-guided-redesign-design.md`.
This is the diff between that design and what actually shipped, so Stage 3
starts from facts rather than from the same question again.

## Not a gap: the routing

Checked first and found correct, contrary to an initial reading of it:

- `CoachAuthoring.tsx:236` — "Build {domain} session" creates and opens
  `/coach/build/:id`, the guided flow. The coach-side CREATE path is wired.
- `CoachAuthoring.tsx:284` — "Edit workout structure" opens
  `/coach/planner/:id`, the dense Planner. This is correct by design, not a
  miswire: `GuidedBuilder.tsx`'s own header states it authors a session's
  first pass one block at a time and "hands off to the existing Planner for
  anything beyond" — there is no review/chain/split screen in the flow.
  Pointing Edit at the builder would drop a coach who wants to change
  existing structure into an append-only flow.

Anyone tempted to "fix" that link should read the header comment first.

## Built as designed

Full-screen one-step-at-a-time flow; Lift/Warm-up/Conditioning/Metcon block
choice; movement picker reused unchanged; sets stepper defaulting to 3
(`GuidedBuilder.tsx:42`); the per-SET warm-up/working flag that replaced the
`W10` string convention; RPE skipped on warm-up sets (explicit in `stepsFor`,
because nothing in a warm-up feeds `packages/engine/src/autoreg.ts`); step
logic pure and tested in `packages/guided-flow` (15 tests) rather than
embedded in JSX, as the design demanded; an end-to-end scenario in
`checks/react-smoke.mjs`.

## Never built — Stage 3 scope

1. **The week grid.** Days as columns, exercises as rows. The design named
   this a deliberate exception to the one-thing-at-a-time treatment: judging
   a week's balance is an overview task and wants density. Nothing like it
   exists — the `grid-cols-7` occurrences in the coach files are day-of-week
   toggles on a card, not a planning surface.
2. **The grid's cell affordances.** Empty cell offering "Create a session" /
   "Add from library"; a filled cell offering "Edit". Neither string exists
   anywhere in the repository. Note this is where the builder's create path
   was supposed to live — today it lives on a per-engine header button, which
   works but is not the designed entry.
3. **The "more" step** holding rest / tempo / notes. `flowSteps.ts` mentions
   neither tempo nor rest, so they cannot be authored in the guided flow at
   all — only later, in the Planner.
4. **Coach instructions and Deliver/publish as the final full-screen step.**
   No publish or deliver step exists in `GuidedBuilder.tsx`. The design
   wanted this to stop being a permanently-visible side panel.

   **Corrected 11 August 2026:** this is a CODE gap, not a design gap. The
   Stage 1 mockup already draws it — `#cal-session-builder`'s `cb-instructions`
   textarea ("Use this area to help the athlete understand goals for today's
   session") and its `cb-publish` "Publish session" CTA, alongside a
   duplicate action and an Unpublished/published status dot. Stage 3 should
   build that, not redesign it.

## Built but drifted — decide in Stage 3

5. **The persistent header.** Designed `Day 1 · Session · 2 of 4 exercises`;
   ships as `Session · block N`. It says where you are but not how far is
   left, which was the stated point of having it.
6. **Reps presets.** Designed `5 / 8 / 8-12 / max / custom`; ships
   `5 / 8 / 10 / 12 / max` plus a custom box, so the `8-12` range is typed
   rather than tapped.

## Sequencing note

**Corrected 11 August 2026.** This section first said the mockup "left its
Library view blank and marked awaiting redesign". That is false — a stale
comment inside the mockup says it, but `#view-library` carries ~212 lines of
real design. What it actually contains:

- a Library header and FIVE tabs — Programs, Sessions, Exercises, Circuit,
  Calendar — with a note that panels are "built one tab at a time";
- the **Calendar** month view in full (`cal-*`): toolbar, month nav, grid,
  day cells with hover links — the only tab panel drawn;
- a **session builder** (`cb-*`), described as "the coach's real authoring
  screen for one day", explicitly replacing an athlete-facing set logger
  because "that screen is for LOGGING a workout, not authoring one";
- a **mobile-only Sessions view** (`th-*`), a deliberate literal clone of a
  reference app with its own accent colour and nav break pattern.

So Programs, Sessions (desktop), Exercises and Circuit are the genuinely
undesigned panels. Items 1 and 2 above — the week grid and its cell
affordances — have no counterpart in the mockup either, and the mockup's
Calendar occupies the space the grid was meant to fill. Whether the grid
survives at all is a Stage 3 decision, not a foregone one.

Items 3, 5 and 6 sit inside the guided flow and are independent of the
Library; they could ship earlier if Library work slips.

## The question Stage 3 has to answer first

There would be THREE authoring surfaces if the mockup's builder is built as
drawn: `GuidedBuilder` (the guided first-pass flow), `Planner` (the dense
editor it hands off to), and the mockup's `cb-*` day builder. That is one
more than any coach needs, and deciding which survives — or how they
compose — comes before any of the tab panels.
