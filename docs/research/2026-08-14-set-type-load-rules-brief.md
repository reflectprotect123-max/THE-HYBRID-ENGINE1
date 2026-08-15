# Research brief — load rules for set types other than straight sets

**For:** an external deep-research pass (ChatGPT or equivalent).
**Date:** 14 August 2026.
**Requested by:** THE Hybrid System.

---

## Read this part first: what we are and are not asking for

We are building a strength engine that prescribes a load in kilograms. Today it
does not model this at all — it remembers the last weight lifted for a movement
and offers the same number back, whatever the coach wrote next. If a coach
programmes `10, 8, 6` one week and `9, 7, 5` the next, the bar does not move.
That is the gap.

We intend to fix it by making load **derived** rather than remembered:

```
load = f(estimated 1RM, target reps, target RPE, set type)
```

The first three arguments are well-trodden and we can implement them. **The
fourth is what this brief is about.** A "set" in real programming is not always
a straight set, and every variant changes the relationship between reps and
load. We need to know which of those relationships are quantifiable from
published evidence, and which are not.

**We are not asking for programme design advice, periodisation theory, or a
literature review of hypertrophy.** We are asking for load-prescription rules
we can implement, each carrying an honest statement of how well evidenced it is.

### On "meta-analysis" specifically

A true meta-analysis — pooled effect sizes across comparable studies — is
appropriate for **some** of this and impossible for the rest. Where the
literature supports pooling (RIR-to-%1RM, we believe, and possibly cluster
rest-interval effects), pool it and say so. Where it does not, **do not
manufacture one.** Say "narrative synthesis, N studies, heterogeneous
protocols" and give us the range and the disagreement instead.

A confidently pooled number from four incomparable studies is worse than no
number, because we would ship it under a barbell.

---

## Context you need about the system

- Movements are barbell/dumbbell/machine resistance work. No bar-speed sensor,
  no force plate, no lab equipment. Inputs are: weight lifted, reps completed,
  and the athlete's own RPE rating of the set after it (1–10 slider).
- We compute an estimated 1RM per movement from logged sets and already use it
  for percentage-authored loads.
- The athlete is typically a hybrid trainee — strength plus conditioning in the
  same week — not a specialist powerlifter. Trained but not elite.
- Anything we prescribe is a **starting number in an editable field**. The
  athlete can always overwrite it. So a wide honest range is acceptable; a
  precise wrong number is not.

---

## What we need, per set type

For **each** set type below, answer these five questions. If the answer to (1)
is "no usable evidence", say so plainly and skip the rest — that is a genuinely
useful answer and we will handle it in the product by declining to prescribe.

1. **Is there published evidence that this set type changes the load an athlete
   can handle at a given rep target, relative to a straight set?**
2. **What is the adjustment**, expressed as something implementable — a
   multiplier on load, a shift in effective reps, or an adjustment to estimated
   1RM. State the units and the direction.
3. **Over what range is it valid?** Rep ranges, load ranges, training age,
   movement types. Where does it stop applying?
4. **Evidence grade.** Use: STRONG (multiple controlled studies, consistent
   direction and rough magnitude) / MODERATE (a few studies, consistent
   direction, magnitude uncertain) / WEAK (single study, or conflicting) /
   NONE (practice-based convention only, no data).
5. **Primary sources.** Author, year, title, and — where it exists — a DOI or
   stable link. We will spot-check these.

### The set types

**A. Straight sets — the baseline.**
Not a variant, but we need the foundation stated. Which rep-to-1RM formula
should we use (Epley, Brzycki, Lombardi, Wathan, other), at what rep ranges is
each accurate, and where do they diverge enough to matter? Specifically: at
what rep count does the error become large enough that we should stop
prescribing from a formula at all? We have seen claims that all of them degrade
past roughly 10–12 reps; we want that quantified if it can be.

**B. RPE / RIR-anchored sets.**
The athlete is asked for `8 reps @ RPE 8` rather than a percentage. What is the
best-evidenced RIR-to-%1RM mapping? How much does it vary by movement (squat vs
bench vs deadlift vs machine), by training age, and by proximity to failure? How
reliable is self-reported RPE in trained-but-not-elite lifters — what is the
typical error, and is it biased in a direction?

**C. Tempo / time under tension.**
A prescribed eccentric or pause (e.g. 3-1-3, or a 2-second pause in the hole).
How much does a slowed eccentric or an added pause reduce the load achievable
for a given rep target? Is the effect better modelled as a load multiplier or as
an effective-rep penalty? Does it scale with tempo duration linearly?

**D. Cluster sets and rest-pause.**
Intra-set rest of roughly 10–45 seconds. How much of a set's capacity does a
given rest interval restore? Is there a usable function of rest duration? Treat
cluster (planned intra-set rests, fixed reps per cluster) and rest-pause
(to-near-failure then short rest then continue) separately if the evidence
distinguishes them.

**E. Drop sets.**
Load reduced mid-exercise and continued. Is there a defensible rule for what the
dropped load should be as a fraction of the top load, and does the top-set load
itself need adjusting because a drop follows? Or is this fatigue-domain only,
with no load-prescription implication?

**F. Myo-reps and similar activation-set protocols.**
Same questions as D and E. We suspect the answer is "practice convention, no
load model" and would rather be told that than given a fabricated coefficient.

**G. Partials, 1.5 reps, and range-of-motion variants.**
Does a partial-range rep have a defensible load relationship to a full-range
rep, or is the movement effectively a different exercise with its own 1RM? We
lean towards the latter; tell us if the evidence supports that.

**H. Eccentric-only / supramaximal eccentrics.**
Is there a usable load rule relative to concentric 1RM, and what are the safety
constraints that should gate whether we prescribe it at all?

**I. Back-off sets.**
After a top set, a reduced-load set. Is there evidence for a specific
percentage, or is this convention? If convention, what is the most common
convention and how much do practitioners vary?

---

## Two cross-cutting questions

**J. Interference.** Our athletes do conditioning in the same week, sometimes
the same day. Is there evidence that recent conditioning work changes the load
an athlete can handle in a subsequent strength session, in a way that is
quantifiable rather than merely directional? If the honest answer is "direction
yes, magnitude no", say that.

**K. Velocity-based training.** We have no bar sensor. Briefly: what would VBT
buy us that RPE does not, and is phone-camera or IMU-based velocity estimation
accurate enough in 2026 to be worth considering? One or two paragraphs, not a
chapter — this is a "should we look again later" question.

---

## Output format we want

A structured document, one section per set type, each containing:

- the five answers above, clearly labelled
- the proposed rule written as a formula or pseudocode, with units
- the validity range stated as explicit bounds
- the evidence grade
- the sources

Then, at the end:

- **A table of every rule with its grade**, so we can see at a glance which
  rules are safe to prescribe from and which need a range or a refusal.
- **A list of what you could not answer**, and whether that is because the
  research does not exist or because it exists but is not usable for load
  prescription. That distinction matters to us more than a guess would.

## What "good" looks like

The best possible answer to a question in this brief may well be:

> No usable evidence. Practitioner convention is X, which varies widely. Do not
> prescribe a load for this set type; ask the coach to write it.

We will implement that faithfully. Please do not smooth over gaps — a rule we
cannot justify becomes a number under someone's barbell.
