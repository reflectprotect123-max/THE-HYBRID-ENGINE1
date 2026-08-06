# Deep-research brief: athlete onboarding, A to Z

> Copy everything below the line into ChatGPT (deep research mode). It is
> self-contained — it does not assume access to our repository. Its output
> feeds the onboarding system in an existing coach's bench; commit the
> results next to this brief when they come back.

---

## Your mission

Research **athlete onboarding** end to end — how coaching platforms,
consumer training apps, and adjacent products take a person from "signed
up" to "training inside the system and trusting it" — and return an
exhaustive, evidence-cited playbook. I want the full alphabet of the
problem: every step, every form field, every drop-off point, every trust
moment, every mistake the market has already made for us.

Depth rule from our previous brief still stands: **a teardown of 8
onboarding flows at the screen level beats 25 marketing-page summaries.**
Complaint evidence (reviews, Reddit, forums) outranks vendor claims.

## Context — design around this, do not research it

We have a working, desktop-first **coach's bench** on top of an
athlete-facing training PWA (strength + conditioning). One account today:
the coach IS athlete zero. A deterministic engine (the "Coordinator")
resolves the coach's proposed week against recovery/readiness and safety
constraints — the coach proposes, the system resolves, and the bench
shows why. Whoop and Concept2 integrations exist. There is already an
**athlete-zero checklist** derived from live state:

1. Athlete profile (shared core)
2. Weekly schedule (available days)
3. Primary goal (strength-led / conditioning-led / hybrid)
4. Connect Whoop (skippable)
5. Connect Concept2 (skippable)
6. Plan the first week
7. Log the first session

The research question is what this must grow into when **real athletes
join**: separate people, separate logins, invited by their coach, most of
them non-technical, some of them migrating from another platform or a
spreadsheet. Multi-athlete data sharing is a later engineering phase —
design the *experience* now so the engineering serves it.

One moment is uniquely ours and matters most: **the consent-and-trust
moment where an athlete learns that software may adjust their coach's
plan.** Collect every precedent for how that is (or fails to be)
explained, consented to, and softened.

## Where to look

**Coach-invites-athlete flows (primary):** TrueCoach, Everfit, CoachRx,
TrainHeroic, TeamBuildr, Trainerize, My PT Hub, Fitr, PushPress Train,
Hevy Coach, WeStrive, TrainingPeaks (coach–athlete attach), Final Surge,
Intervals.icu (athlete linking).

**Consumer first-run excellence (steal mechanics, ignore domain):**
Duolingo (commitment & streak design), Strava (device pairing, social
proof), Whoop and Oura (wearable setup + "your data needs N days"
patience messaging), TrainerRoad (plan generation intake), JuggernautAI
(lifting intake questionnaire), Boostcamp (program pick before signup),
Superhuman (white-glove onboarding as premium positioning), Linear
(instant empty-state usefulness), Notion (template-first starts).

**Professional practice (not software):** what strength coaches, S&C
departments, and online-coaching businesses actually do in an athlete's
first two weeks — intake questionnaires (PAR-Q+, injury history),
movement screens, baseline testing weeks, 1RM/training-max establishment,
communication-cadence agreements, expectation-setting documents. Coaching
business content (podcasts, blogs, courses) is fair evidence here.

## The A-to-Z deliverable

**Deliverable A — the alphabet.** An A→Z catalogue of onboarding
concerns: for every letter, one or more named concerns, each with what
the best implementation does (cited), what the common failure is
(cited), and one sentence on how it applies to a solo-coach bench.
Seed list — extend it wherever the evidence leads:

Accounts & invites · Baselines & benchmark tests · Consent (data,
algorithmic adjustment, health disclaimers) · Devices & wearables ·
Expectations (who sees what, who decides what) · First session · Goals
intake · Health screening (PAR-Q, injury history, red flags) ·
Identity & profile · Jargon (teaching the app's vocabulary) ·
Kickoff communication · Loading baselines (starting weights/paces) ·
Migration & import · Notifications setup · Ownership (athlete data
rights) · Progress framing ("what you'll see in 4 weeks") · Quitting
signals (early drop-off detection) · Re-onboarding (returning after a
break) · Spreadsheet escapees (the biggest competitor) · Time-to-first-
value · Units & localization · Verification (email/phone, minor-athlete
consent) · Waivers & liability · eXpectations of soreness/failure
(managing week-one reality) · Yield moments (when to ask for effort vs
defer) · Zero states (what every screen shows before data exists).

## Further deliverables

**B — Invite-flow teardowns.** Screen-by-screen for the Tier-1 coach
platforms: how an athlete gets invited, what they see first, how many
steps to first logged workout, where they stall. Cite walkthrough videos
with timestamps and help docs.

**C — Intake-form field census.** A table across ≥8 platforms/practices:
every field asked at intake, marked required/optional, with evidence of
which fields athletes abandon on. End with a recommended minimal intake
for us, split "ask now / ask after first session / derive from data,
never ask."

**D — The trust-consent playbook.** Every precedent for onboarding a
human to algorithmic plan adjustment: TrainerRoad's adaptation intro,
Whoop/Oura's calibration-period messaging, JuggernautAI's explanations,
autoregulation framing in coaching practice. Produce 8–12 rules and the
actual *words* — sample copy for the moment an athlete learns the
Coordinator exists. Include the failure quotes ("the app changed my
workout and I don't know why") wherever athletes reacted badly.

**E — Wearable & device connection UX.** Whoop/Oura/Garmin/Concept2
pairing flows: where they live in onboarding order, how skipping is
handled, how "not enough data yet" is communicated, re-auth failure
recovery. Our Whoop/Concept2 steps should match the best of this.

**F — Migration playbook.** How platforms import athletes from
spreadsheets and competitors: what transfers, what's lost, what the
coach must redo, with switching-cost complaints as evidence. Rank the
approaches by how much athlete history survives.

**G — Drop-off atlas.** Where athletes abandon onboarding, per evidence:
which step, what fraction where any numbers exist, and the recurring
complaint at each cliff. App-store reviews, coach forum threads
("my clients won't use the app because…"), churn discussions.

**H — First-two-weeks choreography.** Synthesize software + professional
practice into a day-by-day template: invite → intake → baselines →
first week (deliberately easy?) → first review → full cadence. Mark
which parts software should drive vs the coach personally.

**I — Recommendations mapped to our checklist.** Take our 7-step
athlete-zero list and produce the athlete-N version: ordered steps, who
does each (coach / athlete / system), which are skippable, where the
consent moment lands, and what the bench should show the coach about
each athlete's onboarding progress. Rank by impact, cite the evidence
trail for every step.

**J — Gaps and confidence.** What you could not verify, thin evidence,
inference vs observation, and the questions only a live trial or real
athletes can answer.

## Rules of engagement

- Cite everything; tag [observed] / [inferred] / [speculation].
- Verbatim athlete and coach quotes beat paraphrase — include the ugly ones.
- 2024–2026 preferred; older allowed for professional-practice sources.
- Markdown, tables where specified — output gets committed and diffed.
- Final check: delete any row that could have been written without doing
  the research. Every survivor traces to a named product, a quoted user,
  or a cited practice source.
