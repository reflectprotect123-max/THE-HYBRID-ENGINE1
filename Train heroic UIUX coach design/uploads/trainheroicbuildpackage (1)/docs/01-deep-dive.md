# TrainHeroic Deep Dive — Athlete Logging, Analytics Math, and a Schema That Fixes the 2-Metric Ceiling

Prepared for Dan · August 2026

**Confidence key used throughout:**
- **[V]** Verified — observed directly in the coach app, or quoted from TrainHeroic's official support docs (URL given)
- **[I]** Inferred — reasoned from observed behaviour, not stated by TrainHeroic
- **[U]** Unknown — genuinely undocumented; I looked and could not find it

---

# Part 1 — The Athlete Logging Flow

## 1.1 The state machine

A session moves through these states. Getting this right matters more than it sounds, because most of TrainHeroic's data-loss bug reports live in the gaps between them.

```
                  coach edits program
                          │
                          ▼
   [DRAFT] ──── publish ────► [PUBLISHED] ──── athlete opens ────► [IN_PROGRESS]
   (UNPUBLISHED                │  auto-publish                            │
    badge in                   │  (same-day + time,                       │  logs sets
    calendar) [V]              │   coach's TZ) [V]                        │
                               │                                          ▼
                               │                                    [COMPLETED]
                               │                                          │
                               └──────── athlete reschedules ────────► [MOVED]
```

**[V]** The `UNPUBLISHED` state is real and visible in the team calendar; `Publish All` and per-session `Publish` both exist in the kebab menu (`Publish · Preview · Edit · Save to Library as… · Repeat · Copy · Delete`).

**[V]** Auto-publish is configurable per calendar: enable toggle, "Publish My Workouts" offset (default *Same Day*), publish time, and it runs in a **fixed timezone tied to the coach's account** — mine displayed "Central timezone (America/Chicago)" with no athlete-local option.

> **Gotcha #1:** A coach in Sydney programming for athletes in Sydney gets sessions published on America/Chicago's clock. Publish jobs must be scheduled in the *athlete's* timezone, or at minimum the calendar's declared timezone. This is a 20-line fix at design time and a migration nightmare later.

## 1.2 Screen-by-screen (athlete app)

All **[V]** from support.trainheroic.com unless marked.

1. **Calendar / Today** → athlete taps the day's session → `Start Session` (starts a session timer).
2. **Readiness Survey** — 5 questions (Sleep, Mood, Energy, Stress, Soreness), 1–5 each. Gated behind *Athlete Pro*. Only the **first complete survey of a calendar day** counts as that day's score.
3. **Coach Instructions** — the session-level rich text (10,000 char cap).
4. **Block list** — rendered as `A`, `B1/B2` (superset), `C1..C4` (circuit), with the block category as a heading (`WARM UP`, `STRENGTH/POWER`, `CONDITIONING`, `RECOVERY`).
5. **Logging a set** — either tick the set's circle, or tap into the row to open a keypad and enter values, then `Done`. Completed sets turn green. `+`/`−` buttons add or remove sets *at log time* — the athlete can deviate from the prescription.
6. **Per-exercise 3-dot menu** — exercise comments · lift history (shows `LAST` and `WORKING MAX`) · percentage calculator · form/performance tips (the coach's Points of Performance) · **swap exercise** · **move to end of session**.
7. **Timers** — 7 modes: Rest, Stopwatch, AMRAP, For Time, Tabata, Custom Interval, EMOM. Audible work/rest cues. Can run fullscreen or collapsed while logging.
8. **Session completion** — session RPE slider ("Rate of Perceived Exertion") · editable session duration · free-text session comment to the coach · `Finish Session` → summary + share.
9. **History tab** — search any lift for its history, PR, and working max.

## 1.3 What gets written, and when

This is the part worth copying carefully. Each of these is a separate write with separate failure modes:

| Event | Writes | Idempotent? |
|---|---|---|
| Start Session | session_instance started_at | Should be — use client-generated UUID |
| Readiness submit | 5 subscores + computed score, dated | **Must be** — first-of-day wins |
| Set logged | one result row per set per metric | Must be — key on (set_id, metric) |
| Set unchecked | soft-delete, not hard delete | — |
| Exercise swapped | new exercise_id + provenance to original | — |
| Session finish | session RPE, duration, comment, completed_at | Must be |
| **Derived: working max** | new working_max event if a set beats current | **Must be** — see §2.2 |
| **Derived: PR** | new PR event per rep-count | Must be |

> **Gotcha #2 — this is where TrainHeroic bleeds.** The recurring App Store complaint is "logged a workout, closed the app, workout was gone." That is the signature of an app that holds set results in view state and flushes on session-finish. Write each set to local durable storage the instant it's entered, with a client-generated ID, and reconcile server-side on an outbox queue. Never let "finish session" be the first durable write.

## 1.4 Offline semantics

**[V]** Offline mode works for viewing the calendar/session and logging data; a black bar signals offline. **Video playback is the documented exception.**

**[I]** The reason video breaks offline is structural, not incidental: the exercise `video` field is a **YouTube or Vimeo URL** (I confirmed this in the Create Exercise form — it's a URL input, there is no upload). So the demo is a third-party embed that can never be cached.

> **Gotcha #3:** If offline demos matter to you (they do — gyms have terrible signal), you need first-party video with a cached, transcoded asset. That is a real infrastructure cost TrainHeroic dodged, and it's why they can't fix it now.

## 1.5 Deviation — the thing most apps get wrong

The athlete can, mid-session: add sets, remove sets, change any value, **swap the exercise**, and **reorder the exercise to the end**. That means **the prescription and the performance are different objects with different shapes**, and your schema must not assume a 1:1 row correspondence.

Concretely, if you model results as "the prescription table with values filled in," you cannot represent:
- an athlete who did 4 sets when 3 were prescribed
- an athlete who did Goblet Squat when Back Squat was prescribed
- a set that was skipped vs. a set that was never reached

Part 3 fixes this.

---

# Part 2 — The Analytics Math

## 2.1 Estimated 1RM — the single most important finding

**[V]** TrainHeroic does **not** use Epley, Brzycki, Lombardi, or any continuous equation. It uses a **lookup table**: the NSCA Load/Training Chart.

> "Estimated 1RM are calculated directly from the NSCA load chart, based on the best effort of 15 reps or less."
> — [Testing and Updating Athletes' Maxes](https://support.trainheroic.com/hc/en-us/articles/18170920165645-Testing-and-Updating-Athletes-Maxes)

The published NSCA chart:

| Reps | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| %1RM | 100 | 95 | 93 | 90 | 87 | 85 | 83 | 80 | 77 | 75 | 70 |

So `e1RM = load / pct[reps]`. A 5-rep set at 225 lb → 225 / 0.87 ≈ **258.6 lb**.

**[U]** The chart stops at 12. TrainHeroic accepts up to 15 reps. Whether they extrapolate, interpolate, or use an extended proprietary table is undocumented, and no worked example exists anywhere public.

**My recommendation, and I'd rate it 8/10 over copying them:** don't ship a lookup table. Ship **Epley** (`1RM = w × (1 + r/30)`) as the default with a per-exercise override, because:
- it's continuous, so 13/14/15 reps aren't a cliff
- it's the most widely recognised, so athletes can sanity-check you
- it's monotonic and differentiable, which matters when you plot e1RM over time

Then let the coach pick the formula per exercise or per account (Brzycki is kinder at low reps, Epley at high). TrainHeroic's single hardcoded chart is a limitation, not a feature. Store the formula ID alongside every computed e1RM so historical values stay reproducible when you change the default.

## 2.2 Working max lifecycle

**[V]** Two modes:
- **Unfixed** — "will automatically increase as you progress"
- **Fixed** — once tested or manually set, "TrainHeroic will NOT adjust that athlete's max for that movement again, unless the movement is re-tested or manually updated"

**[V]** Three ways to change it: a coach-programmed **Testing Session** (block kebab → `Test this block`), a coach manual edit in the athlete drawer, or athlete self-edit.

**[V]** I saw the fixed/unfixed distinction rendered directly in the athlete drawer — each exercise row shows a working max with an `ESTIMATED` label and a date, next to a PR shown as `reps@weight` with its own date.

**[U]** The actual update algorithm in unfixed mode — max-of-all-estimates, most-recent, or a rolling window — is not documented anywhere.

**My recommendation:** event-source it. Never store a mutable `working_max` column. Store an append-only `working_max_event` log with `(athlete, exercise, value, source, effective_at)` where source ∈ `{auto_estimate, coach_set, athlete_set, test_result}`, and resolve current max as "most recent event, unless the most recent *manual* event is newer than any auto event." This gives you free audit history, makes the Lift History → Working Max report a trivial query, and lets you retroactively fix a bad estimate without corrupting the athlete's percentages for past sessions.

> **Gotcha #4:** Percentages must resolve against the working max **as of the session date**, not as of now. If you resolve at read time against the current max, an athlete opening last month's session sees weights that were never prescribed. Snapshot the resolved load onto the assigned session at publish time.

## 2.3 Readiness

**[V]** Best-documented formula in the whole product:
- **Daily score** = simple mean of the 5 subscores, range 1–5. First complete survey of the day only.
- **Recent Average** = weighted moving average, "mostly made up of your last 5 scores… weighted so that more recent scores count for more." This is the dotted trend line.
- **Long-Term Average** = the athlete's personal "normal."
- **Normal-range band** = mean ± standard deviation, used to flag significant deviation.
- Feedback shown **post**-session by design, not pre-session (so it doesn't prime the athlete).

**[U]** Whether Stress and Soreness are reverse-scored before averaging is never stated. **[I]** Almost certainly the questions are worded so 5 = best (i.e. "how sore are you" is asked as a wellness scale), because otherwise the mean is meaningless — but this is inference.

> That last point is a genuine trap: if you let coaches author custom readiness questions, you **must** store a `polarity` flag per question or your averages silently invert.

## 2.4 Intensity, Volume, Compliance — all undocumented

**[U]** TrainHeroic's docs name these three metrics and define none of them. The Training Summary article says only that it shows "changes in readiness, volume, and intensity." The Compliance article confirms two levels — "session compliance over a period of time (%)" and "training block-level compliance over a period of time (%)" — and gives no formula.

I saw the coach dashboard render `3/5 Blocks`, `– Readiness`, `58 Minutes`, `– Intensity`, `5,415 KG` per session card. So:

**[I]** Volume is tonnage in the account's unit — `Σ(reps × load)` — and the two sessions showing `–` for Intensity were the ones with no percentage-based prescriptions, which suggests **Intensity is average %1RM and is simply null when nothing was prescribed as a %**.

**My recommendations, with the reasoning:**

**Volume.** Tonnage only counts loaded work, which means a session of 400 calories of Assault Bike scores zero. Compute and store *three* separate numbers rather than one lying number:
- `tonnage_kg` = Σ(reps × load_kg) for loaded sets
- `work_reps` = Σ(reps) for unloaded sets
- `conditioning_load` = Σ(duration_s × RPE) — session-RPE × duration is the standard sRPE training-load unit and it's the only thing that meaningfully compares a bike interval to a squat

Never sum across these. Show them as separate series.

**Intensity.** `Σ(reps × load) / Σ(reps)` expressed as a % of working max, weighted by reps — i.e. average working intensity, not the mean of set percentages. The naive mean of set percentages over-weights the warm-up singles.

**Compliance.** Define it explicitly and expose the definition in the UI, because coaches will otherwise assume the flattering one:
- `session_compliance = completed_sessions / assigned_sessions` where "completed" = `Finish Session` pressed
- `block_compliance = completed_blocks / assigned_blocks` where a block is complete when **every non-optional set in it has a result**

That `Optional` metric column I found in the prescription builder exists precisely so optional sets don't tank compliance. Honour it.

## 2.5 PRs and StackUp

**[V]** PRs are tracked **per rep-count**, not as one collapsed best: "your full PR History listed by exercise, showing the date and the specific rep max (e.g., 5RM Deadlift)." Leaderboards only compare exact rep matches — a 5-rep lift only competes on the 5-rep board.

**[V]** StackUp uses "a nonlinear formula that places lifters on an equal playing field… similar in concept to a Wilks score, but avoids some of the biases of Wilks scores." **[U]** The coefficients are proprietary and published nowhere.

**My recommendation:** use **DOTS**. It's open, peer-reviewed, published coefficients, sex-specific, and doesn't have Wilks' known bias against very light and very heavy lifters. You get 95% of StackUp's value and can document it, which is itself a differentiator against a black box.

## 2.6 Percentage rounding — the undocumented landmine

**[U]** I could not find a single source — official docs, blog, forum, or review — describing how TrainHeroic rounds. 72.5% of a 315 lb max is 228.375 lb, and nobody has written down what the athlete sees.

**This is worth getting right because it's the most-encountered calculation in the entire product.** My recommendation:

```
displayed_load = round_to_increment(target_pct × working_max, increment)
```
with `increment` resolved per exercise → per equipment type → per account default:
- barbell (kg): 2.5 kg — or 1.0 kg if micro-plates are declared available
- barbell (lb): 5 lb
- dumbbell: snap to the gym's actual dumbbell rack (a declared array, not an increment)
- machine / cable: snap to the declared stack increment
- fixed: no rounding

Round **down** by default for percentage work (never prescribe more than intended), and always show the exact unrounded value on long-press. Storing `equipment_increment` on the exercise is ten minutes of work and eliminates an entire category of "the app told me to load 228.375" support tickets.

---

# Part 3 — A Schema That Fixes the 2-Metric Ceiling

## 3.1 The diagnosis

TrainHeroic's prescription is a **fixed-arity row**:

```
[ Set # ] [ Parameter 1 ] [ Parameter 2 ]
```

I confirmed this in both the session builder and the Prescription template builder — three columns, and the third is a metric selector that defaults to `Optional`. So it's really **set count + two metrics, hard stop**, chosen from a fixed enum of 20:

`Reps · Rep Range (min–max) · Weight (lb) · Weight (kg) · Weight (%) · Weight (LWP+) · Time (min::sec) · Seconds · Distance (miles/yd/ft/in/m) · Height (in) · Calories · RPE · Watts · Velocity (m/s) · Other Number · Optional`

**Every downstream limitation flows from this one decision:**
- No tempo. No rest-as-data. No reps + weight + RPE together.
- Unit variants are *separate enum members* (`Weight (lb)` and `Weight (kg)` are different metrics!), which means unit conversion is a data-model problem instead of a display problem.
- Conditioning can't be expressed, so it gets dumped into free-text Circuit blocks — which produce **zero structured data** and are therefore invisible to every analytics report.

That last one is the real cost. Their escape hatch is also their analytics dead end.

## 3.2 The fix, in one sentence

**Separate the metric from its unit, make prescription a set of typed *targets* rather than columns, make performance an independent set of *measurements*, and make the relationship between them many-to-many rather than positional.**

## 3.3 Core tables

```sql
-- ─────────────────────────────────────────────────────────────
-- METRIC REGISTRY: data, not enum. New metrics are rows.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE metric (
  key             text PRIMARY KEY,          -- 'load', 'reps', 'rpe', 'tempo', 'rest', 'distance'
  dimension       text NOT NULL,             -- 'mass','count','ratio','time','length','power','velocity','energy','dimensionless'
  canonical_unit  text NOT NULL,             -- 'kg','rep','rpe','s','m','W','m/s','kcal'
  value_type      text NOT NULL,             -- 'scalar','range','tuple','duration','bool'
  aggregation     text NOT NULL,             -- 'sum','mean','max','min','last','none'  → drives analytics for free
  higher_is_better boolean,                  -- NULL = neither (e.g. tempo)
  is_load_bearing boolean NOT NULL DEFAULT false  -- counts toward tonnage
);
```

Seed rows: `load(mass,kg,scalar,sum,true,true)`, `reps(count,rep,scalar,sum,true,false)`, `rpe(ratio,rpe,scalar,mean,false,false)`, `rir`, `tempo(time,s,tuple,none,null,false)`, `rest(time,s,scalar,mean,false,false)`, `distance`, `duration`, `calories`, `watts`, `velocity`, `height`, `rounds`, `heart_rate`, …

Note what this buys you immediately: `aggregation` and `is_load_bearing` mean **every analytics rollup in §2.4 becomes a generic query**. Add a new metric, and volume/intensity/compliance keep working without a code change.

**Units are display, not identity.** `Weight (lb)` and `Weight (kg)` are the *same* metric `load` stored in kg, rendered per user preference. This alone removes ~6 of TrainHeroic's 20 enum members.

```sql
-- ─────────────────────────────────────────────────────────────
-- EXERCISE + the two indirection edges worth stealing
-- ─────────────────────────────────────────────────────────────
CREATE TABLE exercise (
  id                     uuid PRIMARY KEY,
  owner_id               uuid,                 -- NULL = global library
  name                   text NOT NULL,
  video_asset_id         uuid,                 -- first-party, cacheable. NOT a YouTube URL.
  cues                   text,                 -- "Points of Performance"
  equipment_id           uuid REFERENCES equipment(id),  -- drives load rounding (§2.6)
  default_metrics        text[] NOT NULL,      -- e.g. '{reps,load}' — a DEFAULT, not a ceiling
  -- TrainHeroic's two best ideas:
  reference_max_exercise_id uuid REFERENCES exercise(id),  -- % resolves against THIS exercise's max
  track_as_exercise_id      uuid REFERENCES exercise(id),  -- results roll up into THIS exercise's history
  CHECK (id <> reference_max_exercise_id),
  CHECK (id <> track_as_exercise_id)
);
```

> **Gotcha #5:** `reference_max` and `track_as` are graph edges and **must be cycle-checked on write**, not on read. A→B→A will hang your resolver. Enforce depth ≤ 1 (an exercise may point at a root, a root may not point at anything) unless you have a compelling reason — full transitive resolution is a support nightmare when a coach can't work out why their %s changed.

```sql
-- ─────────────────────────────────────────────────────────────
-- PRESCRIPTION: an expression tree, not a literal
-- ─────────────────────────────────────────────────────────────
CREATE TABLE prescribed_set (
  id              uuid PRIMARY KEY,
  block_item_id   uuid NOT NULL,
  ordinal         int  NOT NULL,      -- set 1, 2, 3…
  is_optional     boolean NOT NULL DEFAULT false,   -- excluded from compliance
  is_amrap        boolean NOT NULL DEFAULT false,
  UNIQUE (block_item_id, ordinal)
);

CREATE TABLE prescribed_target (
  prescribed_set_id uuid REFERENCES prescribed_set(id) ON DELETE CASCADE,
  metric_key        text REFERENCES metric(key),
  -- exactly one resolution strategy:
  literal_value     numeric,          -- 100 kg
  range_lo          numeric,          -- 6      ┐ replaces 'Rep Range (min-max)'
  range_hi          numeric,          -- 8      ┘ as a general capability
  expr_kind         text,             -- 'pct_of_max' | 'lwp_delta' | 'pct_of_bodyweight' | 'rpe_autoreg'
  expr_arg          numeric,          -- 0.725  |  2.5   |  0.5   |  8.0
  expr_ref_exercise uuid,             -- override for pct_of_max
  PRIMARY KEY (prescribed_set_id, metric_key)
);
```

This one table replaces the entire 20-member metric enum *and* the special-cased `Weight (%)` and `Weight (LWP+)` types. `LWP+` becomes `expr_kind='lwp_delta', expr_arg=2.5`. Rep ranges become a general property of any metric, so you get **time ranges** and **RPE ranges** free — neither of which TrainHeroic can express.

**And crucially: there is no arity limit.** `reps + load + rpe + tempo + rest` on one set is five rows.

```sql
-- ─────────────────────────────────────────────────────────────
-- ASSIGNMENT: snapshot at publish. Non-negotiable.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE assigned_session (
  id                uuid PRIMARY KEY,
  athlete_id        uuid NOT NULL,
  source_session_id uuid,              -- provenance back to the program
  scheduled_date    date NOT NULL,
  state             text NOT NULL,     -- draft|published|in_progress|completed|skipped
  published_at      timestamptz,
  resolved_snapshot jsonb NOT NULL,    -- the fully-resolved prescription AT PUBLISH TIME
  timezone          text NOT NULL      -- ATHLETE's tz, not the coach's (§1.1)
);
```

`resolved_snapshot` is the fix for Gotcha #4. Editing a program next month must not rewrite what an athlete was told to do last month.

```sql
-- ─────────────────────────────────────────────────────────────
-- PERFORMANCE: independent of prescription
-- ─────────────────────────────────────────────────────────────
CREATE TABLE performed_set (
  id                  uuid PRIMARY KEY,   -- CLIENT-GENERATED (offline-first, §1.3)
  assigned_session_id uuid NOT NULL,
  exercise_id         uuid NOT NULL,      -- may DIFFER from prescription (swap)
  prescribed_set_id   uuid,               -- NULLABLE: athlete-added sets have no parent
  ordinal             int NOT NULL,
  status              text NOT NULL,      -- completed|skipped|not_reached
  performed_at        timestamptz NOT NULL,
  client_created_at   timestamptz NOT NULL -- for offline conflict resolution
);

CREATE TABLE performed_measurement (
  performed_set_id uuid REFERENCES performed_set(id) ON DELETE CASCADE,
  metric_key       text REFERENCES metric(key),
  value            numeric NOT NULL,      -- ALWAYS in metric.canonical_unit
  PRIMARY KEY (performed_set_id, metric_key)
);
```

The nullable `prescribed_set_id` and the independent `exercise_id` are what make athlete deviation (§1.5) representable. TrainHeroic's positional model cannot cleanly distinguish "skipped" from "not reached," which is exactly why its Compliance report has no published definition.

```sql
-- ─────────────────────────────────────────────────────────────
-- DERIVED STATE: append-only, never mutable columns (§2.2)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE working_max_event (
  id           uuid PRIMARY KEY,
  athlete_id   uuid NOT NULL,
  exercise_id  uuid NOT NULL,        -- the ROOT exercise after track_as resolution
  value_kg     numeric NOT NULL,
  source       text NOT NULL,        -- auto_estimate|coach_set|athlete_set|test_result
  formula      text,                 -- 'epley'|'brzycki'|'nsca_chart' — reproducibility
  from_set_id  uuid,
  effective_at timestamptz NOT NULL
);

CREATE TABLE pr_event (
  athlete_id   uuid NOT NULL,
  exercise_id  uuid NOT NULL,
  rep_count    int  NOT NULL,        -- PRs are PER REP-COUNT (§2.5)
  value_kg     numeric NOT NULL,
  achieved_at  timestamptz NOT NULL,
  performed_set_id uuid NOT NULL,
  PRIMARY KEY (athlete_id, exercise_id, rep_count, achieved_at)
);
```

## 3.4 Structured conditioning — the open flank

TrainHeroic's Circuit block takes a *Results* unit (`For Completion · Calories · Rounds · Time · Meters · …`) and a 10,000-character free-text body. The text is invisible to analytics. This is the single biggest gap in the product and the easiest place to beat them.

```sql
CREATE TABLE block (
  id              uuid PRIMARY KEY,
  session_id      uuid NOT NULL,
  ordinal         int  NOT NULL,
  category        text NOT NULL,   -- prep|speed_agility|skill_tech|strength_power|conditioning|recovery
  title           text,
  grouping        text NOT NULL,   -- 'single'|'superset'|'circuit'   → drives A / A1,A2 / B1..B4 labels
  scheme          text,            -- NULL | 'amrap'|'emom'|'e2mom'|'for_time'|'intervals'|'tabata'|'rounds'
  scheme_params   jsonb,           -- {cap_s:1200} | {interval_s:60, rounds:10} | {work_s:20,rest_s:10,rounds:8}
  score_metric    text REFERENCES metric(key),  -- 'rounds'|'duration'|'calories'|'distance'|NULL
  is_test         boolean NOT NULL DEFAULT false  -- TrainHeroic's "Test This Block"
);
```

Now an EMOM is `scheme='emom', scheme_params={interval_s:60, rounds:10}` with real `block_item` children carrying real `prescribed_target` rows — and its results land in the same analytics pipeline as a back squat. The `grouping` column reproduces TrainHeroic's `A / A1,A2 / B1..B4` labelling, which is genuinely good UX and worth keeping.

`is_test` on the block is what triggers the working-max update path — that's TrainHeroic's `Test This Block` and it's the right hook.

## 3.5 The resolution pipeline

```
prescribed_target
      │
      ├─ literal_value ──────────────────────────────────► value
      │
      ├─ expr_kind='pct_of_max' ─► resolve reference_max_exercise
      │                            └─► working_max AS OF assigned_session.scheduled_date
      │                                └─► × expr_arg
      │                                    └─► round_to_increment(exercise.equipment) ──► value
      │
      ├─ expr_kind='lwp_delta' ──► last performed load for this athlete+exercise
      │                            └─► + expr_arg ─► round ──────────────────────────► value
      │
      └─ range_lo/range_hi ──────────────────────────────► display as "6–8"

                              ▼
              write to assigned_session.resolved_snapshot AT PUBLISH TIME
                              ▼
                       athlete sees a number
```

Resolve **once, at publish**, and persist. Do not resolve at render time. This is the difference between an app whose history you can trust and one whose history silently rewrites itself.

## 3.6 What I'd deliberately *not* copy

| TrainHeroic behaviour | Verdict |
|---|---|
| 2 metrics per set | **Reject.** Root cause of everything else. |
| `lb` and `kg` as distinct metric types | **Reject.** Store canonical, render per user. |
| Free-text circuits | **Reject.** Structure conditioning (§3.4). |
| YouTube/Vimeo URL as video field | **Reject.** Kills offline. |
| NSCA lookup chart, hardcoded | **Reject.** Continuous formula, per-exercise override, stored formula ID. |
| Mutable working-max column | **Reject.** Event-source it. |
| Coach-timezone publishing | **Reject.** Athlete timezone. |
| Undefined Compliance/Intensity/Volume | **Reject.** Define them in the UI. |
| `reference_max` indirection | **Steal.** 9/10 — best idea in the product. |
| `track_as` roll-up | **Steal.** 9/10. |
| `LWP+` autoregulation | **Steal**, generalised to `expr_kind`. 8/10. |
| Block categories + block-level compliance | **Steal.** 8/10. |
| Draft → publish + auto-publish | **Steal.** 7/10. |
| Prescription templates | **Steal.** 7/10. |
| `Optional` set flag | **Steal.** Small, but it's what makes compliance honest. |
| Parent Calendars | **Steal** if you'll serve multi-location gyms. 7/10. |
| PRs per rep-count | **Steal.** 8/10. |
| A / A1,A2 / B1..B4 labelling | **Steal.** Free legibility. |

## 3.7 Honest caveats on this design

- The metric-registry pattern (`prescribed_target` / `performed_measurement` as narrow tables) is a **row-per-metric EAV**, which is more joins than a wide table. At the scale of a coaching app — tens of millions of sets, not billions — this is fine, and Postgres handles it well with a covering index on `(performed_set_id, metric_key)`. If you later need speed, denormalise a `jsonb` cache column; do **not** start there.
- I have **not** verified TrainHeroic's actual internal schema. Everything in Part 3 is my design informed by their observable behaviour, not a reconstruction of their tables.
- The formulas I recommend in §2.4 (Intensity, Volume, Compliance) are **my proposals**, not TrainHeroic's — theirs are undocumented. Don't cite them as "how TrainHeroic does it."
