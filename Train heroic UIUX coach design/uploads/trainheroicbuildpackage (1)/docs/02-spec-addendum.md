# TrainHeroic Build Package — Spec Addendum (machine-readable)

Companion to `trainheroic-deep-dive.md` (athlete logging flow, analytics math, schema rationale)
and `build-package.html` (visual package).

**Feed an implementing agent both markdown files.** The HTML is the human-facing view.

Confidence: **[V]** verified · **[I]** inferred · **[U]** undocumented, no public source.

---

## 1. Architecture facts [V]

**Six** front-end hosts, one sidebar, two API generations.

Coach Home is a shell that embeds two cross-origin iframes from `adapter.trainheroic.com` —
a legacy-integration layer letting older panels render inside the newer React shell.
Both iframe URLs carry a cache-busting `?timestamp=`, so the panels are re-mounted rather
than updated in place. Do not replicate this; build the feed as a first-class component.

| Surface | Host | Stack |
|---|---|---|
| Coach Home, program/session builder | `coachapp.trainheroic.com` | React |
| Library | `library.trainheroic.com` | React |
| Teams + calendar | `teams.trainheroic.com` | React |
| Athletes list, Classic Reports | `coach.trainheroic.com/admin/coach#/…` | AngularJS + Angular Material |
| Gym display | `coachapp.trainheroic.com/fullscreen-workout/{sessionId}` | React |
| **Coach Home feed + alerts panels** | **`adapter.trainheroic.com/home`, `/alerts`** | **cross-origin iframes embedded in the coachapp shell** |
| **Settings · billing · plans · marketplace subscriptions** | **`account.trainheroic.com`** | **own tab bar, no nav rail** |
| Public storefront | `marketplace.trainheroic.com` | separate login, not walked |

**API v5** (current): `/v5/users` · `/v5/users/{id}/features` (feature flags) · `/v5/athletes` · `/v5/headCoach` · `/v5/coaches/orgs` · `/v5/programs/fixed` · `/v5/notifications/counts` · `/v5/site-banners`

**API 2.0** (legacy, still production): `/2.0/coach/teams` · `/2.0/coach/athlete/numbers/{athleteId}` · `/2.0/coach/athlete/numbers/circuits/{id}` · `/2.0/coach/admin/note/{id}` · `/2.0/coach/admin/groups/{id}` · `/2.0/coach/tags/getAthleteTags` · `/2.0/coach/tags/getSportsTags`

> Athlete maxes and PRs — the most valuable data in the product — are served by the *oldest* endpoint. That is where they cannot move fast.

---

## 2. Verified enums — copy these exactly

### 2.1 Prescription metric column (20 members) [V]
```
Reps · Rep Range (min-max) · Weight (lb) · Weight (kg) · Weight (%) · Weight (LWP+)
Time (min::sec) · Seconds (s) · Distance (miles) · Distance (yd) · Distance (ft)
Distance (inches) · Distance (meters) · Height (inches) · Calories (cal) · RPE
Watts · Velocity (m/s) · Other Number · Optional
```
Six of these exist only because unit is baked into identity. Collapse to a metric registry.

### 2.2 Block category (7) [V]
```
Uncategorized · Prep · Speed/Agility · Skill/Tech · Strength/Power · Conditioning · Recovery
```
Drives: icon, colour, athlete-facing section headings, and the unit of block-level compliance. **Adopt as-is.**

### 2.3 Circuit result unit (18) [V]
```
For Completion · Calories · Feet · Inches · Meters · Miles · Reps · Rounds · Seconds
Time · Velocity (m/s) · RPE · Watts · Weight · Yards · Data · Percent · Other Number
```

### 2.4 Athlete-app timers (7) [V]
```
Rest · Stopwatch · AMRAP · For Time · Tabata · Custom Interval · EMOM
```

### 2.5 Session context menu [V]
```
Publish · Preview · Edit · Save to Library as… · Repeat · Copy · Delete
```

### 2.6 Block context menu [V]
```
Change Block Category · Change Block Title · Create a Leaderboard · Test This Block
Move Circuit Up/Down · Delete Circuit
```

---

## 3. Field-level constraints [V]

| Field | Constraint |
|---|---|
| Coach Instructions | 10,000 chars |
| Exercise Instructions | 10,000 chars |
| Circuit Details | 10,000 chars |
| Points of Performance | 10,000 chars |
| Suggested Swaps | max 3 |
| Set count (template builder) | 1–10 |
| Prescription columns | Sets + exactly 2 metrics |
| Exercise video | YouTube or Vimeo **URL only** — no upload |
| Team logo | 300 × 300 px |
| e1RM input range | ≤ 15 reps |

---

## 4. Exercise entity — verified fields [V]

```
title                     required
default_parameter_1       required
default_parameter_2       optional
video_url                 YouTube | Vimeo
suggested_swaps[]         max 3
points_of_performance     10k chars
tags[]                    select-or-freetext
reference_max_exercise    "When loads are prescribed in %, the working max
                           of this exercise is referenced."
track_as_exercise         "results logged for your exercise will effect the
                           history, working maxes, and goals for the selected
                           specific exercise"
```

`reference_max` and `track_as` are the two ideas worth stealing outright.
Model both as graph edges; **cycle-check on write**; enforce depth ≤ 1.

---

## 5. Athlete numbers — observed shape [V]

Per athlete × exercise:
- `working_max` — value + unit + date + `ESTIMATED` flag
- `personal_record` — stored as `{reps}@{weight}` + date, **per rep-count**
- Unloaded movements: PR stores bare reps (`15 reps`) or duration (`20:00 mm:ss`), no working max
- Circuit records live in a **separate** table (`/2.0/coach/athlete/numbers/circuits/{id}`) and never join to exercise numbers

Working max lifecycle [V]:
- **Unfixed** — auto-increases with performance
- **Fixed** — set by a Testing Session, coach edit, or athlete edit; "TrainHeroic will NOT adjust that athlete's max for that movement again, unless the movement is re-tested or manually updated"
- Update algorithm in unfixed mode: **[U]**

---

## 6. Analytics — status of each formula

| Metric | Status | Detail |
|---|---|---|
| Estimated 1RM | **[V]** | NSCA load chart lookup, "best effort of 15 reps or less". Chart defines reps 1–10 and 12 only. 11, 13, 14, 15 → **[U]** |
| Readiness daily | **[V]** | mean of 5 subscores (sleep, mood, energy, stress, soreness), 1–5; first complete survey of the day only |
| Readiness recent avg | **[V]** | recency-weighted moving average, "mostly… your last 5 scores" |
| Readiness normal band | **[V]** | long-term mean ± SD |
| Question polarity | **[U]** | never stated; **[I]** all worded so 5 = best |
| Volume | **[U]** | **[I]** tonnage Σ(reps × load) |
| Intensity | **[U]** | **[I]** avg %1RM; renders `–` when no % prescribed |
| Session compliance | **[U]** | described as "session compliance over a period of time (%)" |
| Block compliance | **[U]** | described as "training block-level compliance over a period of time (%)" |
| StackUp coefficients | **[U]** | "nonlinear… similar in concept to a Wilks score" |
| Percentage rounding | **[U]** | no source anywhere |

NSCA chart values:

| Reps | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| %1RM | 100 | 95 | 93 | 90 | 87 | 85 | 83 | 80 | 77 | 75 | 70 |

**Implement instead** (all mine, not theirs — see deep-dive §2.4):
```
e1rm            = w * (1 + r/30)                       # Epley, per-exercise override, store formula id
intensity       = Σ(reps × load) / Σ(reps) / working_max
tonnage_kg      = Σ(reps × load_kg)          where metric.is_load_bearing
work_reps       = Σ(reps)                    where not load-bearing
conditioning_load = Σ(duration_s × sRPE)
session_compliance = completed_sessions / assigned_sessions
block_compliance   = completed_blocks / assigned_blocks   # complete = every non-optional set resulted
displayed_load  = round_down_to_increment(pct × working_max, equipment.increment)
leaderboard     = DOTS                                  # not Wilks, not a black box
```

---

## 7. Decision matrix

### Steal
| Behaviour | Rating |
|---|---|
| `reference_max` indirection | 9/10 |
| `track_as` roll-up | 9/10 |
| `Weight (LWP+)` autoregulation → generalise to `expr_kind` | 8/10 |
| Block categories + block-level compliance | 8/10 |
| PRs per rep-count | 8/10 |
| Draft → publish + auto-publish | 7/10 |
| Prescription templates | 7/10 |
| Parent Calendars | 7/10 |
| `Optional` set flag | 7/10 |
| `A` / `A1,A2` / `B1..B4` labelling | 7/10 |
| Session Comment as primary CTA | 6/10 |

### Reject
| Behaviour | Rating | Why |
|---|---|---|
| 2 metrics per set | 1/10 | root cause of everything below |
| lb/kg as distinct metric types | 1/10 | unit baked into identity |
| YouTube/Vimeo URL as video field | 2/10 | permanently kills offline demos |
| Mutable working-max column | 2/10 | no audit, no as-of queries |
| Coach-timezone publishing | 2/10 | ten-line fix at design time |
| Undefined Compliance/Intensity/Volume | 2/10 | coaches make roster calls on these |
| Free-text circuits | 3/10 | useful escape hatch, fatal as the primary path |
| NSCA lookup chart, hardcoded | 3/10 | discontinuous, undefined above 12 |
| Proprietary StackUp coefficients | 3/10 | use DOTS |

---

## 8. Build order

**Phase 0 — unfixable later. Do before any product code.**
1. Metric registry as a table with `aggregation` + `is_load_bearing`
2. Canonical units (kg / m / s), converted at the edge
3. Client-generated IDs on every athlete-side write
4. Append-only `working_max_event` and `pr_event`
5. Athlete timezone on the assignment

**Phase 1 — the loop that has to work**
Exercise library + equipment increments · session builder (n-metric) · assignment calendar + snapshot-on-publish · **athlete logging with offline outbox** · working max + PR derivation

**Phase 2 — why a coach switches**
`reference_max` / `track_as` edges · % + LWP resolution with rounding · compliance/volume/intensity with definitions surfaced in-product · structured conditioning schemes · prescription templates

**Phase 3 — moat**
First-party cached video · readiness with per-question polarity · Parent Calendars · data export + public API · DOTS leaderboards

---

## 8b. Commercial model [V]

Seat pricing, from the live billing page:

- **$9.99 / month for 1 athlete**, scaling per athlete, self-serve to **1000 athletes**
- **Assistant coaches $9.99 / seat / month**
- 14-day free trial
- **Marketplace-acquired athletes do NOT consume a paid seat** (footnote on the plans page)

Marketplace, from the subscriptions page — three coexisting models:

| Model | Observed price | Notes |
|---|---|---|
| Monthly subscription to one team/program | $29.00 / mo | most common |
| Bundle (many programs, one sub) | $49.00 / mo | carries its own `BUNDLE` badge |
| One-time lifetime purchase | $99.00 | no renewal date |

Subscription states seen: `ACTIVE` · `CANCEL PENDING` (access persists to period end) ·
`BUNDLE` (a type marker shown *alongside* a status). Model subscription state as
`(status, access_until)`, not a boolean.

The seat exemption is the strategic lever: the Marketplace hands coaches free roster
growth, and TrainHeroic monetises the program sale instead of the seat.

---

## 9. Known TrainHeroic defects worth not repeating

1. **Data loss on backgrounding** — the dominant store-review complaint. Signature of holding set results in view state and flushing on session-finish.
2. **Severe lag** — "5–10 seconds to reload my workout" (Google Play, 3.1★, ~1.5k reviews).
3. **Video fails to load** — third-party embed, uncacheable.
4. **Notes need typing twice.**
5. **No rounds+reps logging for MetCons** — direct consequence of the 2-metric ceiling.
6. **1:1 clients cannot send video to their coach.**
7. **No data export, no public API.**
8. **Raw `<br />` leaks** in the Track As tooltip — minor, but indicative.
9. **Retreat**: Team App, Leaderboard and Whiteboard all removed, replaced by a single read-only Workout Preview.
