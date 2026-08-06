# Deep-research brief v2: coaching platform landscape

> Copy everything below the line into ChatGPT (deep research mode). It is
> self-contained — it does not assume access to our repository. The output
> feeds the coaching front end design in `docs/superpowers/specs/` and the
> phase plan that follows it. If the full brief exceeds one research run,
> run Part I first, then the drill-down prompts in the appendix as separate
> runs.

---

## Your mission

You are researching the entire coaching-platform market so we can build a
coaching front end that beats it on **experience quality and simplicity** —
not feature count. Extract what works, what users hate, what "premium"
mechanically consists of, and how the best products handle complexity
without exposing it — with sources, so we design against evidence instead
of instinct.

The governing thesis: **premium and simple are the same goal, not a
trade-off.** The platforms that feel cheap are the cluttered ones. I want
the mechanics of how the best stay simple under real coaching complexity,
and the precise failure points of everyone who didn't.

I would rather have 8 platforms torn down to the click level than 25
platforms summarized from their marketing pages. Depth beats coverage
everywhere they conflict.

## What we are building (context — design around it, do not research it)

- A **coach's bench**: desktop-first web view where one coach authors
  multi-week strength + conditioning programs for their athletes.
- It sits on an existing athlete-facing training PWA (athletes log there).
- A deterministic engine (the "Coordinator") holds final authority over
  the weekly plan: the coach **proposes**, the system **resolves**
  proposals against recovery/readiness and safety constraints, and the
  coach sees what resolved and why. This is fixed — never recommend
  designs where the coach bypasses safety logic. Instead, find every
  precedent for making that relationship feel empowering rather than
  obstructive.
- Shipping order: multi-week program grid → session editing → resolution
  preview ("what will my proposed week become, and why").
- Solo coach first; teams later. Billing, marketplace, messaging, and
  nutrition prescription are out of scope except where their UI teaches a
  simplicity or trust lesson.

## Platform roster, by required depth

**Tier 1 — full teardown (every dimension below, click-level):**
TrueCoach, Everfit, CoachRx (OPEX), TrainHeroic, TeamBuildr,
TrainingPeaks (its calendar and workout builder are the industry's most
mature), Intervals.icu (free but beloved — establish mechanically why),
TrainerRoad (its Adaptive Training accept/decline flow is the closest
thing on the market to our propose→resolve model — go deepest here).

**Tier 2 — targeted study (dimensions 1–5, 8, 10 only):**
Trainerize (ABC), My PT Hub, Bridge Athletic, Volt Athletics, Fitr,
PushPress Train, Hevy Coach, Exercise.com, WeStrive, Juggernaut AI,
Boostcamp (its program-template UX drives huge organic adoption — why?),
Liftosaur (open-source, scriptable progression DSL — study the language),
Final Surge, Athletica.ai, JOIN.cc (AI plan + human oversight precedents).

**Tier 3 — pattern extraction only (steal interactions, ignore domain):**
Linear (density, keyboard, command palette), Notion (progressive
disclosure), Figma (canvas + inspector layout), Google Calendar and
Fantastical (week grids, drag-drop rescheduling), Airtable (grid editing),
Superhuman (opinionated simplicity as premium positioning), Cron/Notion
Calendar (keyboard-first scheduling).

**Graveyard tier — autopsy:** identify 3–5 dead or pivoted coaching
platforms (candidates: Fitocracy, BTWB's decline, Stacked, others you
find). For each: what they bet on, why it failed, and what the survivors
learned. Discontinued features on living platforms count too — a feature
a company *removed* is stronger evidence than one it shipped.

If coaches consistently praise a platform I missed, add it at the
appropriate tier and say why.

## Research dimensions

For Tier 1, all of these. Numbers 1–5, 8, 10 for Tier 2.

1. **Object model & information architecture.** What are the nouns —
   program / phase / block / week / day / session / exercise / set — and
   how do they nest? Draw each platform's object tree. Where does the
   model leak into the UI and confuse people (evidence from reviews and
   support docs)? This comparison matters more to us than any feature
   list.
2. **Program builder mechanics — time-and-motion.** Walk the exact path
   from blank page to a filled 4-week block: count the clicks, fields,
   and context switches. Use YouTube walkthroughs (cite with timestamps),
   demo videos, docs, and trial accounts where accessible. Record the
   fastest path each platform offers (bulk paste? duplicate week?
   templates? AI draft?) and the slowest thing coaches complain about.
3. **The multi-week view.** Information density per session cell at
   program zoom vs week zoom vs session zoom, and how the transitions
   work. What is visible without clicking? What is one click deep? What
   is buried?
4. **Session editing & notation.** Exercise entry speed (search,
   autocomplete, recents, favorites), set/rep/load notation — free text
   vs structured fields vs hybrid, and where each breaks. How do they
   express %1RM, RPE, tempo, AMRAP, EMOM, supersets, circuits,
   conditioning intervals? Compare the text DSLs specifically:
   Liftosaur's language, TrainingPeaks' workout builder syntax,
   Intervals.icu's interval syntax, Zwift's ZWO format. Which notations do
   users actually learn, and which get abandoned?
5. **Progression & periodization encoding.** Linear, wave, block,
   undulating: how are they templated? "Add 2.5 kg each week" — formula,
   template, or manual? Where does autoregulation enter (RPE-adjusted,
   readiness-adjusted)? Where do coaches say the encoding breaks down and
   they fall back to spreadsheets? The spreadsheet-fallback evidence is
   gold — collect every instance.
6. **Algorithmic-adjustment trust UX — study this hardest.** Every
   platform where software modifies a human's plan: TrainerRoad
   adaptations (accept/decline UI), JuggernautAI readiness adjustments,
   Athletica/JOIN plan regeneration, Whoop recommendations. For each: how
   is the change surfaced, how is *why* explained, what agency does the
   human keep, what do users say builds or destroys trust? Collect
   verbatim reactions — this maps directly onto our propose→resolve
   preview and is the dimension we can least afford to get wrong.
7. **Coach ↔ athlete review loop.** The "Monday morning, review all my
   athletes" flow: what is surfaced vs buried, how compliance and
   readiness are shown, how many athletes a coach can triage per minute.
   Also the athlete side: how does an authored program *render* to the
   athlete, and what do athletes complain about?
8. **Onboarding & time-to-first-value.** First 10 minutes. When does a
   coach first feel competent? Sample data or blank slate? What do trials
   get wrong? Cite first-run walkthrough videos with timestamps.
9. **State craft.** Catalogue empty states, loading behavior, error
   handling, and offline behavior per Tier 1 platform. Premium lives
   here; collect specifics, not impressions.
10. **What makes it feel premium (or cheap).** Typography, motion, speed,
    copywriting tone, pricing-page positioning. Specific: "TrueCoach does
    X on the session card," never "it feels polished." Check Mobbin,
    Page Flows, and similar UI galleries for captured flows and link
    them in a visual reference index.
11. **Complaint mining — the highest-value dimension.** App-store
    reviews, Reddit (r/personaltraining, coaching and S&C subreddits),
    G2/Capterra/Trustpilot, coach forums, YouTube comment sections.
    Catalogue *recurring* complaints per platform with verbatim quotes.
    Separately: **switching evidence** — every "moved from X to Y
    because Z" you can find, tabulated. Migration reasons are the
    market's honest revealed preferences.
12. **Evolution archaeology.** Changelogs, archive.org snapshots, funding
    and acquisition history. What did each Tier 1 platform add, remove,
    or rebuild over the last ~5 years? Removals and rebuilds are
    confessions — treat them as such.
13. **Segmentation & whitespace.** Map the market: team/college S&C
    (TeamBuildr, Volt, Bridge) vs online PT volume (Trainerize) vs
    premium remote 1:1 (CoachRx) vs endurance (TrainingPeaks) vs
    self-coached-with-tools (Boostcamp, Liftosaur). Where does "solo
    premium coach, strength + conditioning, safety-engine-backed" sit,
    and who is closest to occupying it?
14. **Pricing structure** — one table, only as evidence of what the
    market gates as premium.

## Synthesis deliverables — produce all of these, in order

**A. Object-model comparison.** Tier 1 object trees side by side, plus
one paragraph: which model coaches find most natural, per the evidence.

**B. Pattern catalogue.** 50+ rows: pattern → who does it best → why it
works (evidence) → effort guess (S/M/L).

**C. Anti-pattern list.** 35+ rows: what → who does it → complaint
evidence (quote or link) → the design rule that avoids it. This becomes
our "never do" list.

**D. Notation comparison.** The set/rep/load/interval notations and DSLs
side by side, with learnability evidence, and a recommendation for the
hybrid our coach bench should use.

**E. Trust-UX playbook.** From dimension 6: the specific mechanics that
make algorithmic plan-modification feel like a copilot rather than an
adversary — surfacing, explanation, agency, tone. 10+ concrete rules,
each citing its source platform and user reactions.

**F. Click-path benchmark.** Blank-to-filled-4-week-block for every Tier
1 platform: clicks, fields, minutes (estimated from walkthroughs, cited).
Set the bar our builder must beat.

**G. Table stakes vs differentiators.** What every credible platform has
(with the *minimum* version that satisfies coaches) vs what almost nobody
does well.

**H. Simplicity principles.** 10–15 mechanical rules, each citing the
platforms whose success or failure it derives from. Nothing a person
could write without having done the research; "keep it intuitive"-grade
platitudes are banned.

**I. Graveyard lessons.** The autopsies, and the standing rule each one
implies for us.

**J. Visual reference index.** Links: Mobbin/PageFlows captures, YouTube
teardowns with timestamps, notable screenshots — organized by our three
phases (grid, editing, resolution preview).

**K. Ranked recommendations.** Top 15 things the evidence says to get
right, ranked by impact on perceived quality × simplicity, each mapped
to grid / editing / preview / later, each with its evidence trail.

**L. Gaps and confidence.** What you could not verify, where evidence is
thin, which claims are inference vs observation. An honest gaps list
makes everything above more usable, not less.

## Rules of engagement

- **Cite everything.** Reviews, docs, videos (with timestamps), forum
  threads, archive.org. Tag each claim: [observed] in product/docs,
  [inferred] from user reports, [speculation] — and use the last
  sparingly.
- Prefer 2024–2026 evidence; flag anything older. For evolution
  archaeology, older sources are expected.
- Verbatim user quotes beat paraphrase. Include the ugly ones.
- One line of "irrelevant on this dimension" is a valid finding. Padding
  is not.
- Markdown throughout, tables where specified — the output gets committed
  to a repository and diffed against later revisions.

## Final sanity check

Re-read deliverables A–L. Delete any row that could have been written
without doing the research. Every survivor traces to a named platform, a
quoted user, or a cited artifact.

---

## Appendix: drill-down prompts for follow-up runs

Run these as separate deep-research sessions after Part I, pasting the
"What we are building" context block with each:

1. **Trust UX:** "Deep-dive TrainerRoad Adaptive Training, JuggernautAI
   readiness adjustments, Athletica and JOIN plan regeneration: every UI
   detail of how plan changes are surfaced, explained, accepted, or
   declined, and every user reaction you can find, 2023–2026."
2. **Notation:** "Compare Liftosaur's programming DSL, TrainingPeaks'
   structured workout builder, Intervals.icu syntax, and ZWO: grammar,
   learnability evidence, community adoption, failure modes. Recommend a
   hybrid text+structured notation for strength and conditioning."
3. **The Monday review:** "How do TrueCoach, Everfit, CoachRx, and
   TeamBuildr handle a coach reviewing 20 athletes' past week? Screens,
   sort orders, what's surfaced, coach complaints about the flow."
4. **Program-grid interaction:** "Click-level teardown of the multi-week
   calendar/grid in TrainingPeaks, TeamBuildr, and Google Calendar:
   drag-drop semantics, copy semantics, zoom transitions, keyboard
   support."
5. **Graveyard:** "Dead and pivoted fitness-coaching platforms 2015–2026:
   what they bet on, funding history, why they died, features removed by
   surviving platforms and the stated reasons."
