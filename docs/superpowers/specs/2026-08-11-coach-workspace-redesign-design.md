# Coach workspace redesign

## Goal

Rebuild every screen under `/coach` to match the approved design mockup
(artifact `d7069c12-1ed1-4402-bec9-5efbcd2ede46`, "Command Center — Coach
Workspace Redesign"), wire every number in it to real data, and make the
workspace usable on a phone.

The mockup is the specification for how these screens look. This document
records what it means for the code: what replaces what, where each number
comes from, the one place the design outruns the data, and the rules that do
not move.

## Why now

The coach workspace is the screen a coach lands on, and it is the one part of
this app that has never been designed as a whole — it grew a screen at a time.
The mockup redesigns it as one surface: a Command Center that is a launcher,
four pillar screens that hold the detail, and a Library and Settings rebuilt
around them.

It also, for the first time, has a phone layout. That is the change that
matters most day to day: the workspace is currently desktop-only by policy,
and its owner uses a phone.

## Approach: ship the mockup's own styling

The mockup carries a complete stylesheet, written from this repository's real
design tokens (`packages/design/src/tokens.css`) — same greys, same brass,
same radii. It is imported nearly verbatim as
`apps/web/src/coach/coach-redesign.css`, and the markup is ported to JSX
keeping its class names.

The alternative — retranslating every element into the app's Tailwind
utilities — was rejected deliberately. Translation is where "close but not
quite" enters, and the whole reason this redesign exists is that the shipped
screens drifted from what was intended. Importing the approved CSS removes the
translation step: what was approved is what renders.

The cost is that `/coach` carries its own styling, separate from the athlete
screens. That cost is contained: `/coach` is already a separate visual world
with its own stylesheet (`coach.css`) and its own review width, and the
mockup's tokens are this app's tokens, so it is one design language written
two ways — not two design languages.

## Scope

Everything in the mockup, built in four stages. Each stage is verified, and
seen by the owner on a real device, before the next begins.

1. **Command Center and the four pillar screens** — Readiness, Strength,
   Conditioning, Nutrition. First, because it is what a coach lands on.
2. **Settings** — the tabbed settings screen.
3. **Library** — Programs/Sessions tabs, the program table, the calendar view,
   and the block editors. The largest piece by a wide margin.
4. **Responsive close-out** — a phone-width pass over all of the above, the
   screenshot check extended to coach routes, and `CLAUDE.md`'s desktop-only
   rule rewritten.

The phone layout is part of the mockup's own styling, so it arrives with each
stage rather than waiting for stage 4. Stage 4 is a verification-and-repair
pass, not net-new work.

## What the Command Center becomes

Today it is a single long screen: a client strip, a decision queue, a
collapsed overview, and a row of system links.

It becomes a launcher. A client selector, the client's identity and program
week, and four tiles — Readiness, Strength, Conditioning, Nutrition. Each tile
carries an eyebrow naming what the pillar *is* in this system ("Athlete
state", "Specialist input", "Context engine"), the pillar name, and a live
status: a readiness band, a pending-proposal count, or an exception badge.

Everything the Command Center shows today moves into the pillar screen it
belongs to. Nothing is deleted; it is relocated.

## Routes

Four new routes, each behind `ClientDetailGate`:

| Route | Screen |
|---|---|
| `/coach/readiness` | Readiness pillar (new) |
| `/coach/strength` | Strength pillar (new) |
| `/coach/conditioning` | Conditioning pillar (new) |
| `/coach/nutrition` | Nutrition pillar (**replaces** `CoachNutrition`) |

`/coach/nutrition` keeps its address and changes its screen. The Nutrition
pillar shows what `CoachNutrition` showed, rearranged — so the path stays,
`CoachNutrition.tsx` is replaced, and every existing link to it keeps working
with no redirect needed.

`/coach/progression` is retired and redirects to `/coach/strength`. It cannot
simply become a pillar, because it covers both domains: its strength
proposals move to the Strength pillar's queue and its conditioning proposals
to the Conditioning pillar's. Strength is the larger half, so it is where the
old address lands. It redirects rather than 404s so existing links and
bookmarks still arrive somewhere correct.

`/coach/library`, `/coach/settings`, `/coach/review/:weekStart`,
`/coach/author`, `/coach/legacy`, `/coach/build/:id`, `/coach/planner/:id` and
`/coach/roster-plan/:workoutId` are untouched by stage 1.

`/coach/library`, `/coach/settings`, `/coach/review/:weekStart`,
`/coach/author`, `/coach/legacy`, `/coach/build/:id`, `/coach/planner/:id` and
`/coach/roster-plan/:workoutId` are untouched by stage 1.

## Where every number comes from

The mockup's numbers are invented placeholders. Every one is replaced by a
real source. All of these already exist; this is wiring, not new domain logic,
with the single exception called out under "The one gap" below.

**Command Center tiles**

| Tile | Source |
|---|---|
| Readiness band | `athleteState.readiness.band` |
| Strength pending | real pending strength proposals (local ledger, or the repository's roster proposals) |
| Conditioning pending | the same, filtered to conditioning |
| Nutrition exceptions | `buildCoachNutritionReview(...).exceptions.length` |

**Readiness pillar** — the recovery ring and its band from the stored WHOOP
daily series and `athleteState.readiness`; the trend cards from that same
series (HRV, resting HR, sleep). With no WHOOP data connected the screen shows
the mockup's "Connect WHOOP" prompt rather than a fabricated percentage, and a
stale-data note when the most recent reading is not from today.

**Strength pillar** — the progression queue from real pending proposals; the
lift trend cards from `liftTrends`; the weekly hard-session budget from
`weeklyHardBudget`.

**Conditioning pillar** — the queue from real conditioning proposals; the erg
trend cards from `ergTrend`; the Easy/Moderate/Hard bar from `CondResult.zsec`,
the per-zone seconds the app already banks on every logged session.

**Nutrition pillar** — days logged, weigh-in coverage, estimate confidence,
macro progress bars and the weight trend, all from `@hybrid/nutrition-adapter`
and the existing coach nutrition review.

## The one gap: the 5-zone heart-rate donut

The Conditioning hero shows two visuals: an Easy/Moderate/Hard bar, and a
five-zone donut labelled "% of max HR".

The bar is real. The donut is not: this app is a three-zone system throughout
(`ZoneKey = 'low' | 'mod' | 'high'`, `Zones.list` is a three-tuple,
`CondResult.zsec` banks three buckets). Nothing records Z1–Z5. The mockup
half-admits it, inventing a colour token for "Z4" because none existed.

It is built for real rather than dropped, because sessions already store what
it needs: `CondResult.trace` is a downsampled series of heart-rate samples,
and `conMaxHr` already derives the athlete's maximum.

Rules for it:

- The calculation lives in `packages/engine` — a new export deriving time in
  five %HRmax bands from a session's trace and max HR — never in a screen.
  Computing a zone inside a component is exactly what this repository's
  conventions forbid.
- It is **additive**. The three-zone model still drives every prescription,
  every progression and every adaptation. The five-zone breakdown is
  coach-facing context and nothing reads it as an instruction.
- It renders only for sessions that actually recorded a heart-rate trace.
  Sessions without one are excluded from the donut, and the donut states that
  it covers only HR-recorded sessions — an absent trace is unknown, never
  zero.

## Rules that do not move

- **Pillar screens read the signed-in athlete's own stores**, so every one
  sits behind `ClientDetailGate`, exactly as `legacy`, `build` and `planner`
  do today. A roster client is refused, not shown the coach's own records
  under their name.
- **The Command Center keeps its `isLocalClient` gating.**
  `checks/coach-contract.mjs` statically enforces this and must stay green.
- **Nutrition remains context.** It never edits a weekly plan, and nothing in
  the Nutrition pillar writes to training.
- **Pain and illness outrank readiness.** The mockup's "Pain flag active"
  alert on the Readiness screen is kept as designed — it is a safety flag
  surfaced above the score, not a penalty folded into it.
- **The Coordinator remains the only writer of a weekly plan.** No pillar
  screen proposes or applies progression on its own; the Strength and
  Conditioning queues display proposals and route approval to the existing
  decision path.

## Mobile

The coach workspace is currently desktop-first by written policy, with a phone
layout explicitly marked "exploration until a design is explicitly approved
for implementation". This mockup is that exploration, and it is approved.

Consequences, all of which are part of this work:

- The mockup's responsive rules ship with the screens they belong to.
- `checks/screens.mjs` gains the coach routes at phone width. It currently
  shoots the athlete app only at 420px, which is precisely why a desktop-only
  coach surface could regress on a phone unnoticed.
- `CLAUDE.md`'s "desktop-first, mobile is open for exploration" section is
  rewritten to state the real boundary. The default this work commits to is
  that **every** `/coach` route is usable at phone width. If stage 4 finds a
  screen that genuinely cannot work there — the Library calendar and the
  week-review ledger are the two candidates, both being wide tables — it is
  named explicitly in that section as desktop-only, with the reason. What is
  not acceptable is leaving the old absolute wording standing once it is
  false, which is what that section itself warns against.

`1440px` remains the design width the layouts are composed at. Phone is a
supported viewport, not the primary one.

## Testing

- A colocated test per screen, following this repository's rule that tests sit
  beside the module they exercise.
- `CoachCommandCenter.test.tsx` is updated, not weakened: it currently asserts
  roster-versus-local gating and per-client counts, and must still assert both
  against the new markup.
- The five-zone engine function gets its own tests with fixed inputs and known
  outputs, including a trace-absent case.
- `checks/coach-contract.mjs` and the other contract suites stay green.
- Every stage ends with a real-device look by the owner before the next
  begins. This is a gate, not a courtesy: the failure this redesign is
  correcting was invisible to every automated check that passed.

## Out of scope

- The athlete app. Nothing outside `/coach` changes, except the shared
  screenshot check gaining coach routes.
- The three-zone prescription model. The five-zone derivation is display-only
  and additive.
- Re-theming the athlete screens to match. The coach workspace keeps its own
  visual world, as it already does.
