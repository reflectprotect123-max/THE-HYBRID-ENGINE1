# Deep-research brief: the coach's week-in-review

> Copy everything below the line into ChatGPT (deep research mode). It is
> self-contained — it does not assume access to our repository. The output
> feeds the week-review spec in `docs/superpowers/specs/`.
>
> This is a DELIBERATELY NARROW follow-up to
> `2026-08-06-coaching-platform-research-results.md`, which covered plan
> AUTHORING in depth (56 patterns, 45 anti-patterns, object model, notation,
> trust-UX). That brief's own §L2 names the gap this one fills. Tell the model
> what is already covered so it spends its run on the gap.

---

## Your mission

Research how coaching and training platforms handle the **retrospective**:
what a coach or athlete is shown about a training week that has already
happened. Not planning, not authoring, not proposal review — the week is
over, the data is in, and someone is trying to understand it well enough to
decide what to do next.

I want depth over coverage: five platforms' review surfaces torn down
screen-by-screen beats twenty summarised from marketing pages.

## Explicitly OUT of scope — already researched, do not redo

A prior deep-research pass already delivered, in depth: the plan object model
across TrainingPeaks / TrueCoach / Everfit / TeamBuildr / CoachRx /
Intervals.icu / TrainerRoad; authoring and programming shortcuts; notation and
progression syntax; the copy/duplicate/sync semantics of plan templates;
pricing and market positioning; a "graveyard" of closed platforms. Do not
re-derive any of it. If a finding here contradicts that work, say so
explicitly — that is valuable — but do not spend the run re-covering it.

## What we are building (context — design around it, do not research it)

A **week-in-review** surface on a coach's bench that sits over an existing
athlete training app. Fixed constraints, not open questions:

- A deterministic engine (the "Coordinator") holds final authority over the
  weekly plan. The coach steers by changing INPUTS; the coach never
  hand-places a session. Never recommend designs where the coach edits the
  resolved plan directly.
- An autonomous layer ("auto-coach") may adjust a single session within
  policy — e.g. cut volume when readiness is poor. Every adjustment is
  recorded. The athlete can undo it.
- Safety flags (pain, illness) outrank every other signal, always.
- Nutrition data (intake, adherence, weight trend) is available as CONTEXT.
- Single athlete today; the data model is being kept multi-athlete-shaped.

## Part I — the core questions

### A. What is actually on a review screen

Tear down the retrospective surfaces of at least five platforms across both
endurance and strength: **TrainingPeaks** (PMC / post-activity analysis),
**Intervals.icu** (its weekly/fitness views), **TrainerRoad** (adaptation
history and post-plan reporting), **TrueCoach** or **Everfit** (client
compliance views), **Whoop** or **Oura** (weekly report as a consumer
benchmark), plus anything in strength coaching that does this well.

For each: what is on the screen, in what order, at what density; what is
absent that you expected; what the FIRST thing shown is; how far you scroll
before the useful part.

### B. Planned versus actual — the representation problem

This is the hardest part of the brief.

- How do platforms represent "planned X, did Y"? Diff views, overlays,
  side-by-side, deltas, colour-coding, compliance percentages?
- What happens when the athlete did something entirely different, not merely
  less? Most models handle "80% of planned" and fall apart on "did a
  completely different session".
- What about planned-and-not-done versus not-planned-and-done? Both are
  information; most systems only surface the first.
- Where does this get MISLEADING? A single adherence percentage is the
  obvious trap — find the specific ways it misleads and what better
  designs replaced it with.

### C. Adherence without shame

Compliance metrics are, in practice, a judgement of a person.

- Which platforms present adherence in a way that reads as information rather
  than a report card, and what specifically makes the difference — wording,
  framing, granularity, what is omitted?
- Evidence, if any exists, on how compliance scoring affects retention or
  behaviour. Distinguish measured findings from vendor claims.
- Where a coach and an athlete see the SAME adherence data, does the
  presentation differ, and should it?

### D. Showing that an algorithm intervened

Our auto-coach adjusts sessions autonomously. The review must show that, and
whether it helped.

- The prior research named **TrainerRoad's Adaptations** as the strongest
  public precedent for presenting algorithmic plan changes as a reviewable
  event, with "important reversibility weaknesses". Go deeper: what does the
  adaptation history actually show after the fact? Can a user tell whether an
  adaptation was a good call? What are the reversibility weaknesses
  concretely?
- Any other precedent — inside or outside fitness — for showing "the system
  changed something, here is what happened next". Look at ops/incident
  tooling, autopilot disengagement reports, and clinical decision support if
  fitness is thin.
- How do you show that an intervention HELPED without claiming causation from
  one data point? This is the honest-reporting problem at the heart of it.

### E. The weekly ritual

- What is the actual cadence of coach review — Sunday night, Monday morning,
  rolling? Any evidence rather than assumption.
- How long does a coach spend per athlete per week, and on what?
- What makes a review screen get used every week versus opened twice and
  abandoned? Look for post-mortems, churn discussions, and coach forum
  complaints.
- What does a coach do with the review — is the output a decision, a message
  to the athlete, or a change to next week? Which platforms close that loop
  and how?

### F. Nutrition and training in one retrospective

- Who shows fuelling beside training load in a weekly review, and how?
- Where is that useful and where does it become noise or, worse, an implied
  causal claim the data cannot support?

## Part II — what to return

1. **Screen teardowns**, five or more, at click level: what is shown, in what
   order, with screenshots or precise descriptions and sources.
2. **A pattern catalogue** for retrospective surfaces specifically — the
   equivalent of the prior brief's 56 authoring patterns, but for review.
   Each with a source and a one-line "borrow this because…".
3. **An anti-pattern catalogue**: review-screen traps, with the mechanism of
   how each misleads. Prioritise ones you can evidence with user complaints.
4. **The planned-vs-actual representation matrix** — every approach you find,
   with what it handles well and what it breaks on.
5. **A recommendation** for what belongs on a first week-review page, ranked,
   for a single athlete whose plan is machine-resolved and whose sessions may
   have been auto-adjusted.
6. **Explicit gaps and confidence**, in the prior brief's style: mark
   findings [observed] versus [inferred], and say what would need live trials.

## Ground rules

- Cite sources. Distinguish observed behaviour from inference from marketing.
- Where you find user complaints, quote them; they are the best evidence of
  where review screens fail.
- Do not recommend anything requiring the coach to override the Coordinator
  directly — that is fixed architecture, and designs that assume otherwise are
  not usable here.
- If a section is thin because the market genuinely does not do it, say so
  plainly rather than padding. "Nobody does this well" is a finding, and for
  this topic it may be the most important one.
