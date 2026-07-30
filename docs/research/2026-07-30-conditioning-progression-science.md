# Conditioning progression science: starting points and progressions for row / run / ski / bike

**Status:** research reference, not yet a spec · **Date:** 2026-07-30

**A note on sourcing:** this session's network egress is blocked by policy — every
fetch attempt in a dedicated research pass returned HTTP 403 at the proxy level
(confirmed against 21 sources across NCBI, ResearchGate, Concept2, and others; not
a per-site block, a blanket policy denial for this session). Nothing below is a
fabricated citation with an invented DOI or page number — it draws on genuinely
well-established, mainstream exercise-science concepts and named
researchers/models that are widely taught and cited (Seiler's polarized-training
research, Coggan's power zones, the Borg RPE scale, the Cooper test, the
Concept2 2k, standard FTP-test methodology). Treat it as a solid working
foundation, not a peer-reviewed literature review — if a real citation trail
matters before this becomes user-facing copy, that needs a pass with web access
restored.

---

## 1. The core science, once, before modality specifics

Everything below rests on the same handful of ideas, which is why one
progression skeleton (§3) can cover all four modalities.

**Training zones are about ONE underlying axis: intensity relative to your own
thresholds**, not a fixed %HRmax number. The two physiological breakpoints that
matter:
- **LT1** (first lactate/ventilatory threshold) — below this, effort is
  sustainable for hours, almost entirely aerobic, "conversational."
- **LT2** (second threshold, roughly "functional threshold" in cycling
  terms) — above this, effort can only be sustained for ~30-60 minutes; it's
  where lactate accumulates faster than it clears.

A simple **3-zone model** (below LT1 / between LT1-LT2 / above LT2) is more
physiologically meaningful than the 5- or 7-band HR-percentage charts common in
consumer apps, but the app's existing 3-band `low/mod/high` zone model
(`packages/engine/src/hr.ts`'s zone banding) already matches this shape well —
worth knowing that's not an oversimplification, it's the version exercise
physiologists actually use.

**Polarized training distribution.** Stephen Seiler's research on elite
endurance athletes across rowing, running, cycling, and cross-country skiing
consistently found roughly an **80/20 split** — about 80% of training volume
below LT1 (easy), about 20% above LT2 (hard), and comparatively little time in
the middle "gray zone" (between LT1-LT2) — often called the training
"black hole," because it's hard enough to accumulate fatigue but not hard
enough to drive the adaptations top-end intervals give. This is one of the more
robust, widely-replicated findings in the field, and it argues for the app's
format set already being roughly right: `steady` (easy, aerobic base) and
`intervals`/`tempo` (harder, structured work) map onto "the 80" and "the 20,"
as long as the athlete's overall week leans heavily toward `steady`.

**Progressive overload, applied to conditioning (not lifting).** The
governing rule is the same one strength training uses — change one variable at
a time, and volume before intensity. Concretely: extend duration/volume at an
easy pace before adding harder intervals; once a format is comfortable at a
given volume, THEN increase intensity or density, not both simultaneously.
The app's existing `conPrescription` already encodes this instinct correctly:
it rotates through one lever at a time on level-up (+1 round, then +5s work,
then −5s rest) rather than escalating every axis at once — that's a
genuinely sound design choice, not an arbitrary one.

**RPE as a valid low-tech intensity anchor.** The Borg scale (and its simpler
1-10 "CR10" cousin, which is what the app's `effort`/RPE-band system uses) is
a well-validated way to gauge intensity without a HR strap — this is exactly
why the app's effort chips (easy/medium/hard → RPE bands) are a legitimate
design, not a placeholder for "real" HR-based training.

**Autoregulated progression vs. classical periodization.** Textbook
periodization models (linear, block, undulating) are built for athletes on a
fixed competition calendar, peaking for a date. A self-directed conditioning
app with no known "race day" doesn't need that machinery — an
**autoregulated, hit-your-target-to-advance model** (exactly what
`conAdapt()` already does: earn a level by hitting the target zone, lose one
after two consecutive misses) is the right fit for this use case, not a
simplification of "real" periodization. Worth stating plainly so nobody feels
the existing system is a shortcut version of something more legitimate — for
a self-authored app, this genuinely is the more appropriate model.

## 2. Testing and benchmarking — how each modality establishes "where you start"

A starting point needs a baseline test, both to calibrate the athlete's first
prescription and to give them a comparable number to re-test against later
(the equivalent of a strength lift's 1RM). Each modality has one dominant,
widely-used field test:

| Modality | Standard baseline test | What it tells you |
|---|---|---|
| Run | Cooper 12-minute run (distance covered), or a 1-mile / 5K time trial | Estimates aerobic capacity; sets an easy-pace and threshold-pace starting estimate |
| Row | Concept2 2000m test (time) | THE universal rowing benchmark, novice through elite; also used to estimate training paces via Concept2's own pace tables |
| Ski (erg) | Concept2 SkiErg 500m or 2000m test | Same role as the rowing 2k, published pace tables exist specifically for the SkiErg |
| Bike | 20-minute all-out effort × 0.95 (field-test FTP estimate), or a formal ramp test | Establishes Functional Threshold Power (FTP), the anchor cycling builds every other zone off of |

None of these need to be built into the app immediately, but they're the
natural "Level 0 calibration" moment if a modality-aware onboarding is ever
added — a short benchmark effort before the earned-progression system has
any history to go on.

## 3. One progression skeleton, four modalities

This is the shared shape every modality below maps onto. It generalizes the
app's existing three formats into five phases (adds an explicit onramp and an
explicit peak/maintenance phase the current format set doesn't distinguish):

```
Phase 0 — Onramp / technique
   Very short pieces, intensity is a non-issue, the goal is pattern/technique.
Phase 1 — Aerobic base (== the app's `steady` format)
   Continuous, easy, conversational pace. Duration grows before anything else does.
Phase 2 — Base + light structure
   Longer steady pieces, first taste of "harder" via short accelerations (strides
   for running, higher-stroke-rate pieces for row/ski, higher-cadence pickups for bike).
Phase 3 — Tempo / threshold work
   Sustained, comfortably-hard efforts near LT1-LT2. NOTE (see §4): this is where
   the app's format naming and the exercise-science meaning of "tempo" diverge.
Phase 4 — Intervals / VO2max work (== the app's `intervals` format, and closer to
   what exercise science calls "tempo" is actually named `intervals` structurally)
   Short, hard, repeated efforts above LT2 with real recovery between them.
Phase 5 — Peak / maintenance
   Not a new format — just holding Phase 4's volume/intensity rather than
   continuing to add more. The app's earned-level cap (20) already implements
   a soft version of this.
```

Advancing a phase should require *consistency* at the current phase (several
sessions hitting target, not just one), which again matches how `conAdapt`
already requires two consecutive misses (not one) before deloading — the same
principle in reverse.

## 4. A concrete naming finding, worth acting on

Cross-checking the app's actual format definitions
(`packages/engine/src/conditioning.ts`) against how exercise science actually
uses these words surfaces a real mismatch:

- The app's **`tempo`** format is `10 rounds × 15s work / 60s rest` — a
  short, high-intensity, long-rest interval scheme. In exercise-science usage,
  "tempo" means a **sustained, continuous-or-near-continuous effort at or just
  below LT2** (think 20-40 minutes continuous, or 2-3 long reps of 8-15
  minutes with short rest) — it is NOT a short/explosive interval format at
  all.
- The app's **`intervals`** format (`8 × 30s / 90s`) is structurally much
  closer to what's usually called **VO2max intervals** or **HIIT** — short,
  hard, long-recovery repeats designed to spend meaningful time above LT2 in
  short bursts.
- So today's two "hard" formats are both, in science terms, forms of
  **short/high-intensity interval training** — one shorter (`tempo`, 15s), one
  slightly longer (`intervals`, 30s) — neither one is what a coach would call
  a true tempo/threshold session (continuous work at LT2 for many minutes).

This doesn't need to be "fixed" by renaming anything (the app's names are
internally consistent and athletes using it don't need textbook vocabulary),
but it's worth knowing precisely what's missing if a genuine threshold-style
continuous-effort format is ever wanted: it would be a **new** format, not a
relabeling of the existing `tempo`.

## 5. Modality deep-dives

### Running
- **Starting point:** walk-run intervals (the Couch-to-5K shape — e.g. 1 min
  run / 2 min walk, repeated, with the run segment growing week over week).
  Very low injury risk, the standard onramp for true beginners.
- **Base:** continuous easy runs, conversational pace, growing duration before
  anything else. The commonly-cited (if slightly folkloric) "10% rule" for
  weekly volume increases is a reasonable ceiling, though "don't increase two
  weeks in a row without a down week" matters more than the exact percentage.
- **Structure/tempo/intervals:** strides (short 15-20s accelerations, not
  full sprints) are the first taste of "harder"; tempo work is continuous
  runs at comfortably-hard pace; intervals are repeated shorter, faster
  efforts (400m-1km repeats) with jog recovery.
- **Benchmark:** Cooper 12-min test, or a 1-mile/5K time trial.

### Rowing (erg)
- **Starting point:** technique before intensity — the drive sequence
  (legs → back → arms on the pull, reverse on the recovery) at a very low
  stroke rate (~18-20 spm), short pieces only.
- **Base:** steady-state pieces (20-40 min) at low-moderate stroke rate,
  easy effort — this is essentially identical in shape to the app's existing
  `steady` format, just on an erg instead of a bike/run.
- **Structure/tempo/intervals:** longer steady pieces at slightly higher
  stroke rate first; then genuine tempo work (long pieces, e.g. 3 × 10 min,
  at sustained moderate-hard effort); then classic rowing intervals
  (e.g. 8 × 500m) for the harder end.
- **Benchmark:** the Concept2 2000m test — the sport's universal, comparable
  baseline from novice to Olympic rower.

### Ski (ski-erg / nordic)
- **Starting point:** technique first, same principle as rowing but the
  motion and muscle recruitment differ substantially — ski-erg is far more
  upper-body/core/lat-driven (a double-poling-like motion) than rowing's
  leg-dominant drive. Early volume should ramp more conservatively than
  running/biking, since upper-body/core musculature typically has less
  conditioning tolerance in a beginner than legs do.
- **Base/structure:** mirrors rowing's shape (steady → longer steady/higher
  stroke rate → tempo → intervals), with the same conservative-volume caveat
  above baked into how fast duration should grow.
- **Benchmark:** Concept2 publishes SkiErg-specific pace tables; a 500m or
  2000m SkiErg test is the direct parallel to rowing's 2k.

### Bike
- **Starting point:** easy continuous rides, moderate cadence (~80-90rpm is
  the commonly cited efficient range) — cycling has the lowest impact/injury
  risk of the four, so early volume can often progress a bit faster than
  running's.
- **Base:** Zone 2 (endurance-pace) riding, building duration.
- **Structure/tempo/intervals:** "sweet-spot" work (roughly 88-94% of FTP) is
  a popular, time-efficient middle step used widely in cycling coaching
  before true threshold intervals (~95-105% FTP); VO2max work (>106% FTP,
  short hard efforts) is the top end.
- **Benchmark:** FTP test — either a 20-minute all-out effort × 0.95 (the
  common field-test estimate) or a formal ramp test. FTP is the single number
  every other cycling zone is calculated from, same role the 2k plays for
  rowing.

## 6. Recommendation for how "modality" should fit the app's data model

Given the above, the design that fits cleanest without disturbing the
existing (sound) progression math:

- **Modality is an orthogonal tag, not a new axis of the progression math.**
  Add `modality?: 'row' | 'run' | 'ski' | 'bike'` (or similar) to `CondBlock`,
  independent of `condFmt` (which stays about *structure* — steady vs.
  interval vs. tempo shape) and `effort` (which stays about *intensity*).
  Format's `build()`/`conPrescription()` math doesn't need to change per
  modality — a `steady` block is structurally identical whether it's run,
  rowed, or biked; only the *label*, and potentially a modality-specific
  pace/cadence display, differs.
- **This mirrors how `targetDistanceM` already works** — a display-only
  field layered on top of the same format math, not a fork of it. Modality
  can follow the same pattern: metadata that changes what's shown (e.g. a
  cadence/stroke-rate target, or which distance unit makes sense) without
  touching `conPrescription`'s actual numbers.
- **Per-modality progression differences (if ever wanted) belong in
  `conProgress`'s existing per-format-key structure, extended to be
  per-format-per-modality** (e.g. a key like `intervals:row` instead of
  just `intervals`) rather than a parallel system — the existing
  `Record<string, ProgressState>` shape already supports this with a key
  change, no structural rework.
- **The one place modality genuinely should change behavior:** which
  benchmark test (§2) an onboarding flow might suggest, and (for running,
  which already has GPS/distance tracking on mobile) which display units
  make sense (pace/km for run, watts for bike, split/500m for row/ski).

This keeps the fix scoped and additive — closer to how `TextBlock` was added
alongside `StrengthBlock` earlier this session than a rework of the
conditioning engine.

## 7. Open questions this doc does not answer

- Exact numeric thresholds (specific %FTP boundaries, specific weekly-volume
  progression rates) are stated above as commonly-cited ranges, not
  rigorously sourced figures — a real citation pass (once web access is
  available) should verify these before they're hardcoded into user-facing
  copy or gating logic.
- Whether the app should ever prompt a modality-specific benchmark test
  (§2) as part of onboarding, or just let the earned-progression system
  calibrate organically over the first few sessions, is a product decision,
  not a science one — either is defensible.
