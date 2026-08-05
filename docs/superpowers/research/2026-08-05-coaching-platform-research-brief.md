# Deep-research brief: coaching platform landscape

> Copy everything below the line into ChatGPT (deep research mode). It is
> self-contained — it does not assume access to our repository. The output
> feeds the coaching front end design in
> `docs/superpowers/specs/` and the phase plan that follows it.

---

## Your mission

You are researching every serious coaching platform on the market so we can
build a coaching front end that beats them on **experience quality and
simplicity** — not feature count. I need you to extract what actually works,
what users actually hate, and what "premium" actually feels like, with
sources, so we can design against evidence instead of instinct.

The single most important framing: **premium and simple are the same goal,
not a trade-off.** The platforms that feel cheap are the cluttered ones. I
want to know, mechanically, what the best products do to stay simple while
handling real coaching complexity — and exactly where each competitor failed
at it.

## What we are building (context — do not research this, design around it)

- A **coach's bench**: a desktop-first web view where one coach authors
  multi-week training programs (strength + conditioning) for their athletes.
- It sits on top of an existing athlete-facing training PWA. Athletes log
  workouts there; the coach authors in the bench.
- A deterministic engine (the "Coordinator") has final authority over the
  weekly plan — the coach *proposes*, the system resolves proposals against
  recovery/readiness constraints. This is fixed. Do not recommend designs
  where the coach's word bypasses safety logic.
- First shipping slice is a **multi-week program grid** (weeks × days,
  sessions as cells), then session editing, then a "what will my proposal
  resolve to" preview.
- Solo coach first; multi-coach/teams later. No billing, no marketplace, no
  nutrition prescription — out of scope, ignore those features entirely
  except where their UI teaches a simplicity lesson.

## Platforms to study

**Core coaching platforms (study every one):**
TrueCoach, TrainHeroic, CoachRx (OPEX), Everfit, TeamBuildr, Fitbod for
Coaches / Fitbod, Bridge Athletic, Volt Athletics, Fitr, PushPress Train,
Trainerize (ABC), My PT Hub, Exercise.com, WeStrive, Hevy Coach, Alpha
Progression coach tools, Juggernaut AI (as engine-plus-coach hybrid),
TrainingPeaks (endurance — study its calendar deeply), Final Surge,
Intervals.icu (free but beloved — find out why).

**Adjacent products to steal interaction patterns from (UI only):**
Linear (density + keyboard speed), Notion (progressive disclosure),
Figma (multiplayer canvas), Google Calendar / Fantastical (week grids,
drag-drop scheduling), Airtable (grid editing), Superhuman (opinionated
simplicity as premium positioning).

If you find a platform I missed that coaches genuinely praise, add it and
say why.

## Research dimensions — extract these for every core platform

1. **Program builder mechanics.** How is a multi-week program authored?
   Grid, calendar, list, or document metaphor? Drag-drop? Copy week /
   repeat week / progression templates? How many clicks from blank page to
   a filled 4-week block? What's the fastest path they offer, and what's
   the slowest thing coaches complain about?
2. **The week/multi-week view.** Information density per session cell.
   What do they show at program zoom vs week zoom vs session zoom? How do
   they handle the zoom transitions? Screenshots or precise descriptions.
3. **Session/workout editing.** Exercise entry speed (search, autocomplete,
   recents, favorites?), set/rep/load notation (free text vs structured
   fields vs hybrid), supersets/circuits UI, copy-paste of exercises and
   days, keyboard support.
4. **Progression handling.** How do they express "add 2.5kg each week" or
   percentage-based waves? Templates? Formulas? Manual? Where do coaches
   say this breaks down?
5. **Coach ↔ athlete review loop.** How does a coach see compliance,
   results, readiness? What does the "Monday morning review of all my
   athletes" flow look like? What gets surfaced vs buried?
6. **Onboarding & time-to-first-value.** What happens in the first 10
   minutes? When does a new coach first feel competent? What do trials get
   wrong?
7. **What makes it feel premium (or cheap).** Typography, motion, speed,
   empty states, copywriting tone, pricing-page positioning. Be specific:
   "TrueCoach does X on the session card" not "it feels polished."
8. **Complaint mining — the most valuable section.** Go through app-store
   reviews, Reddit (r/personaltraining, r/strength_training, coaching
   subreddits), Trustpilot/G2/Capterra, coach forums and YouTube reviews.
   Catalogue *recurring* complaints per platform, verbatim quotes where
   possible. Especially: "too complicated", "too many clicks", "my athletes
   couldn't figure out", "switched away because" patterns.
9. **Pricing & tier structure** — only as evidence for what the market
   considers premium and which features gate at which price. One short
   table.

## Synthesis deliverables — the actual output I need

Produce these five artifacts, in this order, after the per-platform notes:

**A. Pattern catalogue.** Every interaction pattern worth stealing, one
per row: pattern → which platform does it best → why it works → effort
guess (S/M/L). Aim for 30+ rows spanning the dimensions above.

**B. Anti-pattern list.** Every recurring failure, one per row: what →
who does it → the complaint evidence → the design rule that avoids it.
This becomes our "never do" list. Aim for 20+ rows.

**C. Table stakes vs differentiators.** Two short lists: what every
credible platform has (we must too, eventually) vs what almost nobody
does well (our opening). Mark each table-stake item with the *minimum*
version that satisfies coaches — not the maximal one.

**D. Simplicity principles.** 8–12 concrete, mechanical rules extracted
from the evidence (e.g. "default every new week to a copy of the last
one — every platform where blank-week is the default gets complained
about"). Each rule must cite which platforms' success/failure it comes
from. No platitudes — nothing like "keep it intuitive."

**E. Ranked recommendations for our build.** Given our context and our
phase order (program grid → session editing → resolution preview), the
top 10 things the evidence says to get right, ranked by impact on
perceived quality × simplicity. For each: what, evidence, and which of
our phases it lands in.

## Rules of engagement

- **Cite sources** for every claim — link reviews, docs, videos, forum
  threads. Distinguish "observed in the product/docs" from "inferred from
  reviews" from "your speculation" (mark speculation explicitly, use it
  sparingly).
- Prefer evidence dated 2024–2026; flag anything older.
- Verbatim user quotes beat paraphrase. Include the ugly ones.
- Do not pad. If a platform is irrelevant on a dimension, one line saying
  so is correct.
- Do not recommend features outside our scope (billing, marketplace,
  nutrition, messaging can appear in per-platform notes but not in
  deliverable E).
- Format everything in Markdown with tables where specified, so it can be
  committed to a repository and diffed.

## Final sanity check before you answer

Re-read deliverables A–E. If any row could have been written without doing
the research — delete it. Every surviving row should trace to a named
platform or a quoted user.
