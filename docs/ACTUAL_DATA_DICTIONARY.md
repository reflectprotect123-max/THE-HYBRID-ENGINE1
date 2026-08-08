# Actual data dictionary

Written 8 August 2026 against `main` @ `a8ff104`. Type definitions live in
`packages/engine/src/types.ts`, `packages/shared-core/src/core.ts`,
`packages/nutrition-core/src/types.ts` and `packages/coordinator/src/types.ts`.

**Legal, retention, deletion and privacy rules are UNRESOLVED.** The repository
states none, and I have not invented any. Every entity below is marked for
privacy sensitivity only as an engineering observation.

## Ownership and lifecycle conventions that apply to everything

- **Identifiers**: client-minted `uid()`. Server rows key on `user_id` +
  natural keys. Sanitisers must never mint an id from array position — that
  caused a cross-device collision fixed 7 August.
- **Timestamps**: ISO strings for occurrence, epoch ms for `updatedAt`
  comparisons. Local calendar dates (`ymd`) for anything a day belongs to —
  never `slice(0,10)` on a UTC timestamp.
- **Deletion**: `deletedAt` tombstone. Never splice; a spliced record returns
  from the other device.
- **Merge**: additive both directions, resolved per record on its own stamp.
- **Validation**: sanitisers never throw and never fabricate. An out-of-range
  value is DROPPED, not clamped — clamping once fed the trend model a weigh-in
  that never happened.

## Training slice — `EngineDB`, key `hybrid-engine-v1`

| Entity | Source | Notes |
|---|---|---|
| `Workout` | `engine/src/types.ts` | The template/plan. Blocks → exercises → sets. Includes `mobility`/prep movements (`:329`) — mobility is a field, **not a fourth domain** |
| `Session` | same | An instance being or having been performed. Carries `kind` (strength/conditioning) — the world split |
| `LoggedSet` | same | `aVal` weight, `aVal2` reps, `felt` RPE, `done`. **`felt` is what the athlete rated; the target is separate** — judging a set against its own target would score everything perfect |
| `Settings` | same | Includes `liftProgress` (banked working weights), `conProgress`, `deletedIds` tombstones, folders |
| `Exercise` / block | same | Supersets, warm-up blocks, text blocks |

**Owner**: the athlete. **Visibility**: own rows only. **Editability**: fully
editable by the athlete. **Persistence**: local slice + legacy `app_state` blob
+ `strength`/`conditioning` domain snapshots. **Privacy**: training history is
personal but not special-category.

## Shared core — `SharedCoreState`

Source: `packages/shared-core/src/core.ts`.

| Field | Notes |
|---|---|
| `profile` | displayName, age, units, timezone |
| `goals` | primary + normalised priorities, own `updatedAt` |
| `schedule` | available days, session caps, blocked dates |
| `bodyMetrics` | weight / resting HR / waist, capped 500, retained NEWEST by date |
| `lifeLoad` | stress, physical load, steps, available minutes; capped 120 |
| `recovery` | sleep hours/quality, energy, soreness, motivation, stress, illness status, pain areas; capped 120 |
| `safety.painHold` | `{active, areas, updatedAt}` — **own timestamp**, resolved independently |
| `safety.illness` | `{status, updatedAt, note}` — same |
| `whoopDaily` | recovery, strain, HRV, resting HR, sleep performance; capped 365 |
| `events` | idempotent audit events, capped 2000, keyed on `idempotencyKey` |

**Safety fields are the highest-sensitivity data here** — pain areas and
illness status are health information. On merge they resolve on their own
stamps, and a tie goes to the RAISED flag.

## Coordinator output

| Entity | Source | Notes |
|---|---|---|
| `SessionProposal` | `coordinator/src/types.ts:11` | domain, effort, priority, `goalWeight`, `staleness`, `tags: InterferenceTag[]`, `estimatedLoad`, `minimumSpacingDays` |
| `ScheduledPlanEntry` / `LockedPlanEntry` | `:70`, `:32` | What made the week |
| `PlanDecision` | `:63` | `proposalId`, `action`, `reasonCode`, `explanation` — **the audit trail** |
| `WeeklyPlan` | `:82` | `writer: 'coordinator'` — the Coordinator is the only writer, enforced server-side |

**Persistence**: `athlete_weekly_plans`, Coordinator-writer-only.
**Editability**: not athlete-editable; the coach steers inputs.

## Nutrition slice — `NutritionDB`, key `hybrid-nutrition-v1`

| Entity | Notes |
|---|---|
| `FoodLogEntry` | **Macros snapshotted at log time and never re-derived.** `sourceSnapshot` carries provenance; a hand edit brings `logged_*` with it and stamps `manual_macro_edit` |
| `CustomFood`, `Recipe`, `RecipeItem` | Athlete-authored; recipes resolve per serving |
| `CachedFood` | A catalogue food the athlete has used — cached on use, never speculatively |
| `WeightEntry` | `measuredAt`; filed to its LOCAL day |
| `CheckIn` | Weekly: observed vs proposed expenditure, proposed macros, modules, explanation |
| `MacroProgram` / day targets | Nutrition prescription — `nutrition-engine` only |
| `DayStatus` | Declared `fasted` etc. — a declaration, never an inference |

**Isolation**: its own storage key, its own sync partition, and structurally
stripped from `EngineDB.ecosystem` so a meal cannot move the training
fingerprint. **Privacy**: food logs plus body weight are sensitive.

## Scan corpus — key `hybrid-label-scan-corpus-v1`

OCR diagnostics: what was read, what was shown, what the athlete confirmed.
**Never syncs.** Bounded by record count and byte budget. Write failures are
deliberately swallowed so a diagnostic cannot sit between the athlete and their
data.

## Automation records

| Entity | Source | Gap |
|---|---|---|
| Auto-coach ledger | `apps/web/src/autocoach/ledger.ts` key `hybrid-auto-coach-ledger-v1` | **Device-local, never synced** (RISK R3) |
| Policy / consent | `hybrid-auto-coach-policy-v1`, `-consent-v1` | Same |
| `athlete_events` | `shared-core` + server table | Idempotent, synced — the one durable audit trail |

## Server tables (22)

RLS core: `athlete_core`, `athlete_domain_snapshots`, `athlete_events`,
`athlete_weekly_plans`. Nutrition/catalogue: `foods`, `food_servings`,
`custom_foods`, `recipes`, `recipe_items`, `food_favorites`,
`food_log_entries`, `daily_log_status`, `weight_entries`,
`weight_trend_points`, `body_measurements`, `progress_photos`,
`macro_programs`, `macro_program_days`, `user_nutrient_targets`,
`weekly_check_ins`, `expenditure_estimates`, `nutrition_profiles`.

All are `auth.uid() = user_id` except `foods` and `food_servings`, which are
read-only shared reference data.

**`progress_photos` is the highest privacy-sensitivity table in the schema.** I
did not audit its storage path or retention; unresolved.

## Contradictions and gaps

1. Auto-coach records are the only automation trail and do not sync.
2. No entity models a **coach**, an **organization**, or an athlete↔coach
   relationship.
3. No **plan version** entity — a plan is resolved fresh each week, so
   "coach-authored intent vs resolved work" is not separable today.
4. **Conflict** has no entity — merges resolve silently by rule; a rejected
   revision is now reported to the caller but not persisted.
5. Retention/deletion/export-for-privacy rules: **unresolved**, none stated.
