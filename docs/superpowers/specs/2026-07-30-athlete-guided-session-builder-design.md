# A guided session builder for the athlete apps

**Status:** design, approved in outline · **Date:** 2026-07-30

---

## The problem

Today, "＋ New session" in both `apps/web/src/screens/Library.tsx` and
`apps/mobile/src/screens/Library.tsx` does the same thing: it creates a
blank `Workout` with one empty block and drops the athlete straight into
the dense Planner (`apps/web/src/screens/Planner.tsx` /
`apps/mobile/src/screens/Planner.tsx`) to fill it in by hand — a
prescription table, a name field with a typeahead of past movements, sets,
reps, RPE, rest, all visible at once.

The now-deleted coach builder replaced exactly this kind of dense editor
with a full-screen, one-step-at-a-time guided flow, and it worked well.
This spec brings that same guided-flow *style* into the athlete apps, for
an athlete building their own session, rather than a coach publishing one
to someone else.

## What stays, what changes

The Planner is not going away — it remains the screen for editing an
existing session, and for anything beyond a session's first pass (adding
a second block, chaining two exercises into a superset via
`apps/web/src/screens/planner/SupersetSeam.tsx`, reordering). What changes
is the *entry point*: "＋ New session" starts the guided flow instead of
opening a blank session directly in the Planner.

**The flow, block by block:**

Every screen keeps a persistent header showing progress — "Session ·
block 2" or similar — the same persistent-header pattern the coach
builder used. A multi-step flow with no sense of where you are in it is
a known, avoidable source of confusion.

1. **"What are we doing?"** — Lift / Warm-up-Cooldown / Conditioning /
   Metcon-notes, as big tappable choices — same four choices the coach
   builder offered.
2. **Lift** walks: movement (type a name or pick one already known —
   reusing each app's existing typeahead: web's `<input>` + `<datalist>`
   fed by `knownMovements`, mobile's `Suggest` chip list in
   `apps/mobile/src/screens/planner/ExerciseCard.tsx`) → sets (stepper,
   default 3) → reps (chips: 5 / 8 / 10 / 12 / max / custom, plus a
   "this is a warm-up" checkbox) → RPE (chips 6–10, skipped entirely when
   the set is marked warm-up).
3. **Conditioning** walks the same detail questions the coach builder's
   conditioning block did: format, target zone/effort, minutes.
4. **Warm-up/Cooldown** is a single open text box — "What's the warm-up?"
   — and produces a `TextBlock` (`packages/engine/src/session.ts` →
   `newTextBlock()`) with `heading: 'Warm-up / Cooldown'`, the same engine
   shape Metcon/notes already uses, just a different heading. It is
   **not** the existing `newWarmupBlock()` (a `StrengthBlock` with
   `warmup: true` and real loggable sets) — that shape still exists and
   is still what the Planner's own "+ Warm-up/Cooldown" button creates,
   for anyone who wants a real tick-off warm-up. The guided flow's
   version is deliberately lighter: a note to read, not sets to log.
5. **Metcon/notes** is a single open text box, unchanged from what exists
   today (`newTextBlock()`).

   (These are two separate warm-up concepts, both already in the engine
   and both kept: a *set* inside an ordinary Lift block can be flagged as
   warm-up via step 2's checkbox — a ramp before your work sets, same
   exercise. A whole *block* chosen as Warm-up/Cooldown in step 1 is the
   text-box version above — separate prep, its own row. Neither replaces
   the other.)
6. After a block is saved to the session, **"Add another block?"** —
   shown with a one-line running summary of what's already in the session
   ("Back Squat, Conditioning added") so an athlete interrupted mid-flow
   doesn't lose track of what they've built so far. *Yes* loops back to
   step 1 for a new block; *no* opens the session in the existing
   Planner, for final polish (superset-chaining a pair of exercises,
   reordering, or just reviewing before training).

**Back navigation and interruption.** Each step's back control (and the
platform back button/gesture) goes to the previous step within the
current block, never straight out of the flow — consistent with
"back should work predictably" everywhere else in these apps. Leaving
the flow entirely (closing the tab, backgrounding the app, navigating
away) can lose the in-progress, not-yet-completed block — a gym is a
constant source of interruptions, so this is worth being an explicit,
stated decision rather than an accidental gap: a completed block is
saved to the session immediately (matches "saves as you go" everywhere
else in these apps), but a block still mid-steps is only committed once
its last step is answered, the same way the coach builder's flow worked.
No draft-persistence beyond that is in scope here — if it turns out to
matter in practice, it's a small, separate follow-up.

There is no separate review/chain/split screen in the guided flow itself
— that machinery already exists and works in the Planner, and this spec
does not rebuild it. The guided flow's job is getting from "nothing" to
"a real first pass at a session," one plain question at a time; the
Planner's job — editing what's already there — is unchanged.

**Both apps get this natively.** The step-sequencing logic (what question
comes next, when a step is satisfied enough to advance, when RPE is
skipped) is one shared, framework-free module — the same kind of pure
function the coach builder's `flowSteps.ts` was — reused by both apps.
Each actual screen is a separate, small component per app, since
`apps/web` (React/Vite) and `apps/mobile` (Expo/React Native) share no UI
code, only `packages/engine`.

**Touch targets and chip accessibility.** Web keeps this app's existing
44×44px minimum. Android's own guideline is a stricter ≥48×48dp, so
mobile's step components target 48dp, not a straight port of web's
number — using RN's `hitSlop` to pad any control whose visual size stays
smaller than that. A reps/RPE chip's selected state must not be color
alone (add a border, checkmark, or weight change too), both for
colorblind athletes and because a training app is routinely used in
direct sunlight, where color-only state is the first thing to wash out.

## Explicitly out of scope

- Any change to the Planner itself. It keeps every button and behavior it
  has today (add exercise, add warm-up, add cond block, add metcon/notes,
  chain into a superset).
- A review/chain/split screen inside the guided flow — deferred to the
  Planner, as decided above.
- Any change to how a coach-assigned session behaves, or to the
  now-dormant coach-side plumbing (`Workout.origin`, `assignmentId`) —
  untouched by this work.
- iOS. There is no iOS app; "both platforms" means web and Android.

## Testing

The shared step-sequencing module is pure logic and gets real unit tests,
written first, the same way the coach builder's did. Each app's guided
flow gets an end-to-end check that actually drives it: web via a real
headless-browser run (extending `checks/react-smoke.mjs`) through
block-type → movement → sets → reps → RPE → "add another?" → Planner
handoff; mobile via its existing component-test harness
(`apps/mobile/test/harness.tsx`), the same pattern
`apps/mobile/test/training.test.tsx` already uses to mount a real screen
against a seeded store.

No new error-handling surface: the guided flow writes to the same
`Workout`/session shape the Planner already writes to, through the same
per-app store (`apps/web/src/store/db.tsx`, `apps/mobile/src/store/db.tsx`),
so the existing save-failure banner already covers it.
