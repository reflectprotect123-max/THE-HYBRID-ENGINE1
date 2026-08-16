# The RPE progression system

**Date:** 16 August 2026
**Status:** design, approved in conversation, not yet implemented
**Evidence base:** `docs/research/2026-08-16-progression-evidence-answer.md`
**Supersedes nothing.** Extends the fold, the banking layer and
`decideStrengthProgression`, all of which already exist.

---

## 1. Why this exists

The engine already autoregulates on RPE twice — once inside a session and once
between them — and both are live. What it cannot do is survive a change of rep
scheme, which is the ordinary case for anyone following a programme.

The owner put the problem in one line: *"what if one week its 10,8,6 then the
next its 9,7,5 or 8,6,4 an or 3 x 5 or 5/3/1"*.

Run against the real engine functions, the same athlete should open at:

| Scheme | Correct opener | What the app offers today |
|---|---|---|
| 10, 8, 6 | 100.0 kg | 100.0 |
| 9, 7, 5 | 102.4 kg | 100.0 |
| 8, 6, 4 | 105.0 kg | 100.0 |
| 3 × 5 | 113.5 kg | 100.0 |
| 5/3/1, the single | 131.3 kg | 100.0 |

**The engine computes the correct column and then throws it away.**
`anchorFor(100, {reps: 10, rpe: 8})` returns a 140 kg e1RM, and `plannedKg`
prices every later set off it — that is how 10 → 8 → 6 gets heavier within one
session. At the final whistle `liftMoves` banks `{kg: 100}` and the anchor is
gone. `LiftState` even carries a `reps` field whose comment reads *"reps it was
earned at, so a changed rep target is visible in the record"* — and
`nextWorkingWeight` reads `st.kg` and nothing else.

CLAUDE.md has carried this as an open gap since the lab was deleted: *"a
`10,8,6` → `9,7,5` wave moves no weight at all. That gap is still open."*

## 2. What "perfect" means here, and what it cannot mean

The commissioned review's central result is negative and governs everything
below:

> "No convincing experiment was located that randomised comparable trainees to
> approximately 2.5%, 5%, and 10% progression increments while holding
> exercise, target repetitions, progression trigger, volume, frequency, and
> context constant."

So there is no optimum to implement. What is achievable is a **controller**:
one that knows what it is looking at before it acts, moves one lever at a
time, treats holding as a real answer, and can always say why. Every number in
this design is a labelled heuristic. None is presented as a finding.

## 3. The design in one page

**The system stores a score, not a weight.** One number per movement — the
e1RM anchor — from which today's load is derived against today's rep target.

**The weight is pushed, not proposed.** It arrives prefilled in the athlete's
weight field with a one-line reason. There is no approval card and no second
number, because the fold's own rule stands: *a suggestion that disagrees with
the prefill is not a suggestion, it is two numbers contradicting each other on
the same card.*

**The athlete has the last word**, because the athlete is the one who knows
how today feels. Overriding the number is expected, not exceptional — and when
they do, they may leave one line saying why.

**Asymmetry is where the coaching lives.** Down is fast and needs no
confirmation; up is slow and needs two. That is the whole difference between a
coach and a calculator, and it is already how the fold behaves.

## 4. Stages

Ordered so that each is shippable on its own. Stage 1 and Stage 2 together fix
the owner's reported problem; the rest harden it.

### Stage 1 — bank the anchor, not the kilo

The single change everything else depends on.

**Store.** `LiftState` gains `e1rm?: number`. `kg` stays exactly as it is —
every session already logged keeps behaving identically, because a record with
no `e1rm` takes the existing path.

**Write.** `liftMoves` already computes `next.kg` (the next opener at this
session's scheme) and already reads the opening working set. It gains one
line: `anchorFor(next.kg, set1PlannedTarget)`, where the target is
`{reps: targetRepsOf(sets[0].t), rpe: rpeCenterOf(sets[0])}` — the same pair
`readExercise` builds. Warm-up sets are already excluded upstream.

**Read.** `openingLoadFor`'s *earned* rung prices
`plannedKg(e1rm, todaysSet1Target)` when an `e1rm` is banked and today's set 1
carries a numeric rep target. Otherwise it falls through to `kg`, unchanged.

**Why it composes.** The anchor is derived from the weight the session
*earned*, so a session that went well raises the anchor and a scheme change
re-prices it — both at once, with no interaction rule:

```
week 1  10,8,6 @100, on target   → earned 100 @10 reps → anchor 140
week 2  plan says 9,7,5          → plannedKg(140, 9) → 102.4
week 3  plan says 3×5            → plannedKg(140, 5) → 113.5
crushed week 1 instead           → earned 102.5 → anchor 143.5 → week 2 = 104.9
```

**Boundaries.** The anchor is never shown as a 1RM and never called one — it
is an internal reference. A bodyweight movement has no anchor. `max` sets have
no rep target to price against and take the existing path.

### Stage 2 — the reps rule: read the coach's syntax as intent

Ten lines, and it stops the engine overriding a coach.

- A single written number is an **instruction**. The engine prices load only
  and never suggests reps.
- A written **range** (`8-12`) is an **invitation**. Double progression is
  what the coach asked for, and the engine may climb inside it.

The two are already distinguishable from the existing parsers, but only
carefully: `repFloorOf` returns a NUMBER and `repTopOf` returns a STRING, so the
test is `repTopOf(t) === String(repFloorOf(t))` and never a bare `===`. Both run
the target through `withoutLoad` first, so `5 @80%` is still a single number.
`max` and an empty target give `repTopOf(t) === ''`, which is neither an
instruction nor an invitation — those take the existing path and are not touched
by this stage.

`decideStrengthProgression` already branches on `lastReps < repTop`; it does
not yet know that `repTop === repFloor` means *do not*. A wave — 10,8,6 —
is a sequence of instructions, so the engine must never propose an eleventh
rep on the 10.

### Stage 3 — validity before progression

The review is explicit that a success boolean is not enough: *"A set can be
completed because the athlete overshot the intended RPE, because the target
was too easy, because the exercise was changed, or because the user entered a
value without actually performing the set."*

An exposure is classified before it counts, from what is **already stored** —
no new capture on the logger. **Shipped** (16 August 2026):

| Class | Condition | Effect |
|---|---|---|
| `successful` | met the rep floor, rated | counted, as before |
| `successful_but_uncertain` | met the floor, no rating logged | counts, but the fallback path now says so by name (`exposure_not_rated`, confidence `low`) instead of being absorbed into the generic `mixed_recent_results` hold |
| `missed` | below the rep floor | counted, as before |
| `incomplete` | no completed working set | needs no code — a session with no working set never produces a `StrengthExposure` at all, so it was already "ignored entirely" |

`ExposureClass` is computed and stored on every `StrengthExposure`, additive
metadata that the progression and deload gates do not yet read — only the
final fallback branch does, narrowly, to replace one generic hold reason with
an honest one. The two-in-a-row promotion gate (`last.onTarget && prev.onTarget`)
is unchanged: this stage makes the classification visible and improves one
hold message, it does not let an uncertain exposure promote at reduced
confidence. That is a larger, riskier change to a safety-relevant decision
tree with 199 existing pinned tests, and it is deferred rather than guessed
at — see below.

**Two classes did not ship, both for the same reason: no stored fact to
classify against.**

- **`pain_blocked`** — nothing in `LoggedSet` records a pain flag per set for
  a strength exercise. Conditioning has `mechanicalCompletion: 'pain_stop'`;
  strength has no counterpart. Reading `whole-athlete-state`'s
  `pain_hold_active` would answer a different question — whether pain is
  flagged *today*, not what a *past* exposure was — and would also mean
  `@hybrid/engine` depending on `@hybrid/whole-athlete-state`, which nothing
  in this repository does today (dependencies run the other way, both
  packages sit on `@hybrid/shared-core`). CLAUDE.md already records that
  nothing consumes `pain_hold_active` yet; this is that gap staying open, not
  a new one.
- **The "column pair changed" half of `successful_but_uncertain`** — no
  exposure field tracks which set-entry columns (`setColumns.ts`) a past
  session logged against, so there is nothing to compare today's pair to.

**Explicitly not built:** the review's full thirteen-field exposure record —
technique flags, rest interval, approved substitutions. Nobody answers those
mid-set. Recorded here as a declared gap rather than a silent one.

### Stage 4 — three load fields, never collapsed

> "The engine should retain `session_opening_load`, `effective_load`, and
> `last_successful_anchor_load` separately. Otherwise a failed session can
> cause an invisible compound reduction."

This morning's fix removed the compounding by re-deriving the anchor from
history on every call. This makes it a stored fact:

- `lastSuccessfulAnchor` — the e1RM from the most recent `successful` exposure
- `openingLoad` — what the athlete was asked to start at today
- `effectiveLoad` — what they actually finished at after the fold's corrections

`decideStrengthProgression`'s `anchorKgFor` scan is replaced by a read.

### Stage 5 — calibration after a layoff

The hole the owner found: *"a good day the 100kg is RPE 6 an then we come back
4 months later an theres stress/sleep issues an that 100kg is RPE9"*.

Two different causes needing two different answers:

**A bad patch while still training is already handled.** The fold catches it on
set one — a set rated 9 against a target of 8 is `dev = −1`, a full correction
and a lock, so set two is lighter immediately. The anchor re-banks lower at the
end of the session. **That drop is correct**: the athlete genuinely is
temporarily weaker. The system must not defend the old number. What it should
do is record *why* it fell, which is Stage 6.

**A layoff is not handled at all.** Nothing marks an anchor stale; four months
and four days are identical. Set one of the comeback is priced off a
four-month-old good day, and the athlete discovers it is too heavy by lifting
it — precisely the *"unnecessary failure exposure"* calibration exists to
prevent.

So a movement whose last exposure is older than the configured gap enters
**calibration**:

- it is not offered the full anchor-priced weight
- the session's purpose is to observe, not to progress
- its result is **recorded as a calibration exposure** and can never silently
  become the new anchor
- it leaves calibration on **two stable comparable exposures, not on a date** —
  the review is explicit: *"The calibration state should expire based on
  successful comparable exposures, not merely time."*

The gap threshold and the calibration reduction are both configured heuristics
and labelled as such.

### Stage 6 — the override note

When the athlete changes the offered number, the app records what was offered,
what was taken, and offers **one optional line**: *"shoulder felt off"*,
*"slept 4 hours"*, *"felt great"*. Skippable. Never a form.

Two things this buys:

1. The coach stops seeing `95kg` and starts seeing *"we offered 102.5, he took
   95, his shoulder felt off."* One is data; the other is coaching.
2. The engine is told the miss was not about strength, so a bad week does not
   read as decline — the `successful_but_uncertain` path with a human reason
   attached.

## 5. What the athlete sees

Unchanged in shape. The weight field, prefilled, with one line under it:

```
102.5 kg     what you earned last time, at nine
 95.0 kg     backed off — harder than asked
100.0 kg     coming back — let's see where you are      (calibration)
102.5 kg     on target twice — this is the step up
```

The line is not decoration. The fold already states the rule: *a number with no
reason attached is what athletes override.*

## 6. What the coach sees

Nothing new to approve — the athlete owns the number under the bar. The bench
gains what it currently lacks: the override record, and the reason attached to
it.

## 7. Boundaries this design does not cross

- **The anchor is not a 1RM** and is never labelled one.
- **Pain is not fatigue.** It routes to the safety pathway, not to a heavier
  penalty in the same formula. Note that nothing currently consumes
  `pain_hold_active` — Stage 3's `pain_blocked` class is the first consumer,
  and it blocks progression only. It does not reinstate the deleted session
  stop, which was removed deliberately on 14 August.
- **HRV stays advisory.** The existing recovery ease at the point of
  prescribing is unchanged; nothing here reads a wearable as a strength signal.
- **Nutrition never enters this.** Unchanged.
- **Every constant declares itself a heuristic.** The product may not claim
  2.5%, 5% or two misses are validated.

## 8. Testing

- **Stage 1 is golden-testable against the table in §1** — five schemes, one
  anchor, five expected openers, computed by the real functions.
- **Round trip:** a session with no `e1rm` behaves exactly as it does today.
  This is the compatibility assertion and it must be explicit.
- **Stage 2:** a wave (`10`, then `8`) never produces a rep suggestion; a range
  (`8-12`) does.
- **Stage 4:** the review's Example C — open 100, miss, corrected to 94, deload
  produces 95 and not 89.3 — already passes and must keep passing.
- **Stage 5:** calibration is entered on a gap, exited on two stable exposures
  and never on elapsed time alone; a calibration exposure never becomes an
  anchor.
- **The golden constants pin** covers `progressPct`, `maxJumpPct` and
  `deloadPct` already, and gains the calibration constants.

## 9. Open questions, stated rather than hidden

1. **The calibration gap threshold** has no evidence behind it. The review
   declines to give one — *"Detraining evidence does not provide a universal
   time-off-to-load-reduction equation."* It will be a configured guess,
   labelled, and it should be revisited against real data.
2. **RPE calibration per athlete** — the review suggests tracking whether a
   given athlete's "8" tends to precede an overshoot. Not in this design.
   Worth doing once there is enough logged history to estimate it, and it must
   surface as *evidence quality*, never as a label attached to a person.
3. **The coach cannot yet see per-section actual-vs-planned time**, which is
   a separate gap noted on 16 August and not addressed here.
