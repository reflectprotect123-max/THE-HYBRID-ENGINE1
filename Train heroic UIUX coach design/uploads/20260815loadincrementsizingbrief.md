# Research brief — how big should a load increment be?

**For:** an external deep-research pass (ChatGPT or equivalent) with open web access.
**Date:** 15 August 2026.
**Requested by:** THE Hybrid System.

---

## Read this part first: what we are and are not asking for

We have a working strength progression engine. It decides, after a session,
what a movement should open at next time. Two constants inside it are currently
**flat kilogram amounts**, and we want to know whether they should be
percentages of the working load instead — and if so, what percentages.

```
progression after success:   load + 2.5 kg
deload after two misses:     load − 2.5 kg
```

That is the entire question. We are **not** asking for programme design advice,
periodisation theory, a review of hypertrophy mechanisms, or an argument that
progressive overload works. We accept all of that. We are asking for **two
numbers and the evidence behind them**, plus an honest statement of how well
evidenced each one is.

### On confidence, and why we would rather have a range

Anything the engine prescribes is a **starting number in an editable field**.
The athlete can always overwrite it. So a wide honest range is useful and a
precise wrong number is dangerous — we would ship it under a barbell.

If the literature does not support a specific figure, say so plainly. "No
head-to-head trial exists; practice converges on X for these reasons" is a
completely acceptable answer and is more useful to us than a number with
invented precision. **Do not pool incomparable studies into a false
meta-analysis.** Where synthesis is narrative, label it narrative and give us
the spread and the disagreement.

---

## Context you need about the system

- Barbell, dumbbell and machine resistance work. **No bar-speed sensor, no
  force plate, no lab equipment.** Inputs are: weight lifted, reps completed,
  and the athlete's own RPE rating of the set afterwards (1–10).
- The athlete is a **hybrid trainee** — strength and conditioning in the same
  week — trained but not elite, not a specialist powerlifter.
- Loading granularity is a hard physical constraint. With 1.25 kg plates the
  smallest symmetrical barbell change is **2.5 kg**. Microplates exist and some
  athletes own them; most do not. Any percentage rule we adopt has to be
  rounded to something the athlete can actually load.
- **Progression already happens within a session** by a separate rule: each set
  is rated against its target RPE, and the weight moves before the next set. A
  missed set is scored at an effective RPE of 10.5 regardless of what the
  athlete rated it, the correction applies in full, and the exercise locks so
  no later easy set raises the load again. **This means a missed lift has
  already cost roughly 6% before any deload decision is taken.** Whatever you
  recommend for a deload, we need to know whether it is meant to be measured
  against what was *lifted* or against what has *already been walked down to*.
- The decision we are asking about is the **cross-session** one: two
  consecutive sessions on target → add load; two consecutive sessions missed →
  reduce load.

---

## What we already found, so you do not spend effort re-finding it

Please **verify or contradict** each of these. We reached all three through
search-result summaries rather than by reading the primary sources — our
environment blocks direct access to the journals — so treat them as unverified
claims, not as established background.

1. **ACSM Position Stand, *Progression Models in Resistance Training for
   Healthy Adults*** (Med Sci Sports Exerc; 2002, updated 2009; PubMed
   19204579). We believe it recommends a **2–10% load increase**, applied
   **when the individual can perform the current workload for one to two
   repetitions over the desired number**, with larger increases for large
   muscle group multi-joint exercises and smaller for small muscle groups.

2. **Plotkin et al. 2022**, "Progressive overload without progressing load? The
   effects of load or repetition progression on muscular adaptations." PeerJ
   10.7717/peerj.14142. We believe it found similar hypertrophy between load
   progression and repetition progression, with load progression **slightly**
   favoured for maximal strength and equal for endurance, over 8 weeks in
   resistance-trained subjects with volume equated.

3. **Deload magnitude after consecutive missed lifts** converges on about
   **10%** across popular programmes (Starting Strength, StrongLifts, Wendler),
   with broader planned deload weeks running 10–40% load reduction and 30–50%
   volume reduction.

---

## The three questions

### Q1 — The ACSM recommendation, quoted exactly

Read the position stand itself, not a summary of it.

- Quote the load-increase recommendation **verbatim**, with the page or section.
- Quote the **trigger condition** verbatim.
- Does the 2–10% band break down into sub-ranges by muscle group size, exercise
  type, or training status? If so, give the sub-ranges as stated.
- Does the 2009 revision differ from the 2002 stand on any of this? If it does,
  say which we should follow and why.
- Is the recommendation evidence-graded within the document (ACSM uses evidence
  categories A–D)? If so, **what grade does this specific recommendation
  carry?** This matters to us more than the number: a category D expert-opinion
  recommendation and a category A recommendation would lead us to different
  implementations.

### Q2 — How Plotkin operationalised load progression

**This is the question most likely to change what we build**, so please give it
the most attention.

If the study's load-progression arm used a **fixed increment**, then it is not
evidence for percentage-based progression at all, and citing it that way would
be wrong.

- What **triggered** a load increase in the load-progression arm, and **by how
  much**? Fixed kg, fixed percentage, or something else?
- Same for the repetition-progression arm.
- Sample size, training status, training age, sex distribution, duration,
  exercises used, and how volume was equated.
- Quote the conclusion verbatim.
- State the effect sizes and confidence intervals for the strength outcome, not
  just the direction. "Slightly favoured" is not something we can implement.

### Q3 — Does any trial compare increment SIZE directly?

Not "does overload work" — that is settled. We want:

> Does progressing at ~2.5% per increase produce different outcomes from ~5%,
> or ~10%, holding everything else constant?

- If such trials exist, give them: design, findings, and whether the comparison
  was of percentage bands or absolute loads.
- **If none exists, say so explicitly.** That is a genuinely useful answer: it
  would mean our constant is a judgement call inside a sanctioned band rather
  than a finding, and we would document it that way in the code.
- Related and nearly as useful: is there evidence on **increment size and
  adherence or stalling** — do smaller increments extend a linear progression
  before it stalls? Any data on this being different for **upper-body versus
  lower-body** lifts, or for **women versus men**, given that a fixed 2.5 kg is
  a much larger relative jump on a 25 kg press than on a 180 kg deadlift?

---

## A fourth question, if you have appetite for it

Our deload triggers on **two consecutive missed sessions**. The trigger
threshold is our own invention — we chose it, no source. Is there any evidence
bearing on how many consecutive failures should precede a load reduction? One,
two, three? And should the reduction be load-only, or should it cut volume too,
given that the athlete in question is also doing conditioning work in the same
week?

---

## What we want back

For each question, in this order:

1. **The answer**, in one or two sentences, with the number if there is one.
2. **The source**, with enough detail to find it — authors, year, journal, DOI
   or PubMed ID. Direct quotes where we asked for them.
3. **How well evidenced it is**, in your own words. Meta-analysis, single RCT,
   position stand, expert consensus, or common practice with no trial behind
   it. We would rather be told "this is what everyone does and nobody has
   tested it" than be given a number that sounds firmer than it is.
4. **What you would implement**, if it were your engine, given the plate
   granularity constraint described above.

Please flag anything in the "what we already found" section that turns out to
be wrong. We would rather discover it here than in the code.
