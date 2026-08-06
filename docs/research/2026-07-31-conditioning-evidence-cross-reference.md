# Cross-referencing the ChatGPT evidence bundle against this app

**Status:** research reference · **Date:** 2026-07-31

The user ran the deep-research prompt from
`docs/research/2026-07-30-conditioning-progression-science.md` through ChatGPT's
deep research mode and returned a four-file evidence bundle (preserved at
`docs/research/conditioning-evidence-bundle/`). It is genuinely strong work —
real DOIs and PubMed links for every specific number, an explicit evidence
hierarchy (direct / adjacent / manufacturer-guidance / product-design), and it
is honest about what it could *not* find rather than inventing a plausible
number. This doc cross-references it against (a) my earlier UNVERIFIED
synthesis and (b) the actual current code in `packages/engine/src/conditioning.ts`
— not just against itself.

## 1. Things I flagged as suspicious that are now confirmed, with real citations

- **The "10% rule" is refuted, not just folklore.** Buist et al. (2008), a
  real novice-runner trial: a 10%-style progression and a standard progression
  produced statistically indistinguishable injury rates (20.8% vs 20.3%,
  p=.90). My prior doc could only say "I suspect this is folklore" — this is
  now a cited null result, not a guess.
- **HRR gating is confirmed as unsound, and the app already got this right.**
  The bundle says explicitly: "do not use HRR >12 bpm as a healthy-athlete
  progression gate" (Cole et al. 1999 is a clinical mortality-prognosis study,
  not an athletic-progression protocol). Checked the actual code:
  `packages/engine/src/conditioning.ts:292` already hardcodes `hrrOk = true`
  with a comment explaining HRR is "recorded and displayed and nothing
  more" until a noise floor is established. **No change needed here** — this
  is independent confirmation that a judgment call made earlier in this
  project was correct, not a gap.
- **My tempo/intervals naming-mismatch observation is independently
  reinforced.** Coggan's actual power-zone table (cited directly): tempo =
  76-90% FTP, a *sustained* zone, not a short-interval format. This app's
  `tempo` format (`10×15s/60s`) still doesn't match that usage — not a new
  finding, but now backed by the real source table instead of my own
  recollection of "tempo generally means X."

## 2. A real, concrete bug this cross-reference surfaced

The bundle's strongest actionable claim: for short-interval work, **heart
rate should never be the sole completion/progression signal** — it lags,
keeps rising across repeated bouts, and can stay elevated after the
mechanical work has already collapsed. RPE plus completed work should be
primary; HR is secondary/diagnostic.

Checked `conAdapt()` (`packages/engine/src/conditioning.ts:273-318`) against
this directly: for `intervals` and `tempo`, `onTarget` is computed **purely**
from HR-zone-time fraction (`workSec / total >= 0.45`) — nothing else. No RPE
input, no completed-rounds signal, nothing about whether the athlete actually
finished the prescribed work or bailed early with a strap still reading a
high number.

Then I checked whether RPE is even *collectable* today — and it isn't.
`CondResult.felt` exists in the type (`types.ts:186`), is displayed in
`Recap.tsx`/`History.tsx` for every conditioning result (`condResult?.felt`),
and `condEffortGap()` in `conditioning.ts` is written and ready to compare it
against the target band — but **grepped both `Conditioning.tsx` screens
(web and mobile) for `felt`: zero hits.** Nothing in the live-run "Finish"
flow ever prompts for or writes a felt RPE. Every conditioning session run
through this app today shows a blank "Felt RPE" in Recap/History, and the
whole `condEffortGap` codepath silently no-ops (it returns `null` when `felt`
isn't a finite number).

So the app isn't just missing a nice-to-have — it's missing the one signal
the evidence says should be primary for exactly the format types
(`intervals`/`tempo`) whose progression the app is already gating on the
wrong signal alone. This is worth fixing independent of anything to do with
modality or air bike.

## 3. A design idea from the bundle worth adopting, beyond what I proposed

Split completion into two independent outcomes rather than one collapsed
`onTarget`/`overcooked` verdict:

- `cardiovascular_completion`: met / borderline / not met / not assessed
- `mechanical_completion`: met / borderline / local-fatigue-failure /
  technique-failure / pain-stop

This isn't just an air-bike concern (where it's most acute — shoulders/lats
failing well before HR catches up). It applies to rowing (technique
breakdown under fatigue) and running (form collapse, gait change) too, and
the app currently has no concept of it at all — `conAdapt` only ever sees
zone-seconds, never a completion/technique verdict.

## 4. Air bike as a required 5th modality — bigger data-model ask than I proposed

My original recommendation (§6 of the prior doc) was "modality is a thin
label, same format math underneath, just changes display units" — modeled on
how `targetDistanceM` already works. That's still right for row/run/ski/bike,
but **air bike breaks that assumption**: the bundle is explicit that raw
watts/calories/RPM are *not* portable across AssaultBike/Echo Bike/Airdyne —
even between two Rogue-brand machines a few years apart. A same-numeric-value
comparison across devices is meaningless without a validated conversion,
which doesn't exist.

Practical implication: if air bike is added, a `CondResult` for it needs
**per-device metadata stored with the result** (manufacturer, model,
generation, console metric), not just a `modality` tag — otherwise the
app's own progression trend for air bike silently compares apples to
oranges the moment someone upgrades machines or the app compares two
different real-world bikes. Row/run/ski/bike don't have this problem to
nearly the same degree (running pace and cycling FTP are far more portable
across equipment).

## 5. Real per-modality specifics that sharpen my rougher first-pass numbers

| Modality | My earlier guess | Bundle's sourced version |
|---|---|---|
| Running | "Couch-to-5K shape" | NHS Couch to 5K exactly: 3 runs/week, 9 weeks, starts 1 min run/1:30 walk, ends 30 min continuous |
| Rowing | "~18-20 spm technique work" | British Rowing: 18-24 spm learning; Concept2: 18-22 technique, 24-28 steady, 30-36 short-interval/2k |
| SkiErg | "progress conservatively, no specifics" | Concept2's actual 6-week plan: 2-3 sessions/week, specific distance/interval ladder (250m→1000m→500m→1500m→2000m→descending) |
| Cycling | "sweet-spot ~88-94% FTP" (not in Coggan's classic table) | Coggan's actual bands: <55% recovery, 56-75% endurance, 76-90% tempo, 91-105% threshold, 106-120% VO2, >121% anaerobic — my "sweet-spot" figure is a separate, newer convention not covered by this source |

## 6. What the bundle explicitly refuses to give a number for (and is right to)

Worth stating plainly since it matters for how any of this gets built:
- No validated universal air-bike intensity zones by any metric.
- No validated cross-brand air-bike conversion.
- No reliability data for the popular 5-min/10-min/2-mile air-bike tests
  (only device-specific ramp/VO2peak tests have a credible reliability
  signal — ICC ~0.9-0.97 range, cited directly).
- No direct injury-incidence data for any air-bike design.

These gaps should stay visible in the app (as the bundle itself recommends)
rather than getting smoothed over into a confident-looking number once this
becomes an implementation plan.

## 7. Net effect on next steps

This changes what the highest-value next action is. Before this bundle, the
open item was "add modality as a tag" (cosmetic/labeling work). Now there are
two independently real, higher-value fixes visible:

1. **Add felt-RPE capture to the conditioning finish flow** (both platforms)
   — a pre-existing gap, not modality-related, unlocks the app's own
   already-built `condEffortGap` logic, and is a prerequisite for
   `conAdapt` ever using RPE the way the evidence says it should for
   short-interval formats.
2. **Reconsider `conAdapt`'s intervals/tempo completion signal** to weight
   RPE/completed-work alongside (not necessarily instead of) HR-zone-time,
   once (1) exists.

Modality (including air bike) is a separate, additive piece of work on top
of that, not a blocker for it.
