-- TrainHeroic Build Package — proposed schema (Postgres)
-- Rationale: docs/01-deep-dive.md Part 3 · docs/02-spec-addendum.md §7
-- This is a PROPOSED design, not a reconstruction of TrainHeroic's tables.

-- ═══ METRIC REGISTRY — data, not enum. New metrics are rows. ═══
CREATE TABLE metric (
  key              text PRIMARY KEY,        -- 'load','reps','rpe','tempo','rest'
  dimension        text NOT NULL,           -- mass|count|ratio|time|length|power|velocity|energy
  canonical_unit   text NOT NULL,           -- kg|rep|rpe|s|m|W|m/s|kcal
  value_type       text NOT NULL,           -- scalar|range|tuple|duration|bool
  aggregation      text NOT NULL,           -- sum|mean|max|min|last|none  → analytics for free
  higher_is_better boolean,                    -- NULL = neither (tempo)
  is_load_bearing  boolean NOT NULL DEFAULT false
);

-- ═══ EXERCISE + the two indirection edges worth stealing ═══
CREATE TABLE exercise (
  id                        uuid PRIMARY KEY,
  owner_id                  uuid,                 -- NULL = global library
  name                      text NOT NULL,
  video_asset_id            uuid,                 -- first-party + cacheable, NOT a YouTube URL
  cues                      text,                 -- "Points of Performance"
  equipment_id              uuid REFERENCES equipment(id),
  default_metrics           text[] NOT NULL,     -- a DEFAULT, not a ceiling
  reference_max_exercise_id uuid REFERENCES exercise(id),
  track_as_exercise_id      uuid REFERENCES exercise(id),
  CHECK (id <> reference_max_exercise_id),
  CHECK (id <> track_as_exercise_id)
);

-- ═══ PRESCRIPTION — an expression tree, not a literal ═══
CREATE TABLE prescribed_set (
  id            uuid PRIMARY KEY,
  block_item_id uuid NOT NULL,
  ordinal       int  NOT NULL,
  is_optional   boolean NOT NULL DEFAULT false,  -- excluded from compliance
  is_amrap      boolean NOT NULL DEFAULT false,
  UNIQUE (block_item_id, ordinal)
);

CREATE TABLE prescribed_target (
  prescribed_set_id uuid REFERENCES prescribed_set(id) ON DELETE CASCADE,
  metric_key        text REFERENCES metric(key),
  -- exactly one resolution strategy per row:
  literal_value     numeric,      -- 100 kg
  range_lo          numeric,      -- 6  ┐ generalises 'Rep Range' to ANY metric
  range_hi          numeric,      -- 8  ┘ → time ranges, RPE ranges, load ranges
  expr_kind         text,         -- pct_of_max|lwp_delta|pct_of_bodyweight|rpe_autoreg
  expr_arg          numeric,      -- 0.725 | 2.5 | 0.5 | 8.0
  expr_ref_exercise uuid,         -- override for pct_of_max
  PRIMARY KEY (prescribed_set_id, metric_key)
);

-- ═══ ASSIGNMENT — snapshot at publish. Non-negotiable. ═══
CREATE TABLE assigned_session (
  id                uuid PRIMARY KEY,
  athlete_id        uuid NOT NULL,
  source_session_id uuid,                -- provenance back to the program
  scheduled_date    date NOT NULL,
  state             text NOT NULL,       -- draft|published|in_progress|completed|skipped
  published_at      timestamptz,
  resolved_snapshot jsonb NOT NULL,      -- fully-resolved prescription AT PUBLISH TIME
  timezone          text NOT NULL        -- ATHLETE's tz, not the coach's
);

-- ═══ PERFORMANCE — independent of prescription ═══
CREATE TABLE performed_set (
  id                  uuid PRIMARY KEY,   -- CLIENT-GENERATED (offline-first)
  assigned_session_id uuid NOT NULL,
  exercise_id         uuid NOT NULL,      -- may DIFFER from prescription (swap)
  prescribed_set_id   uuid,               -- NULLABLE: athlete-added sets have no parent
  ordinal             int  NOT NULL,
  status              text NOT NULL,      -- completed|skipped|not_reached
  performed_at        timestamptz NOT NULL,
  client_created_at   timestamptz NOT NULL  -- offline conflict resolution
);

CREATE TABLE performed_measurement (
  performed_set_id uuid REFERENCES performed_set(id) ON DELETE CASCADE,
  metric_key       text REFERENCES metric(key),
  value            numeric NOT NULL,   -- ALWAYS in metric.canonical_unit
  PRIMARY KEY (performed_set_id, metric_key)
);

-- ═══ DERIVED STATE — append-only, never mutable columns ═══
CREATE TABLE working_max_event (
  id           uuid PRIMARY KEY,
  athlete_id   uuid NOT NULL,
  exercise_id  uuid NOT NULL,          -- ROOT exercise, after track_as resolution
  value_kg     numeric NOT NULL,
  source       text NOT NULL,          -- auto_estimate|coach_set|athlete_set|test_result
  formula      text,                    -- 'epley'|'brzycki'|'nsca_chart'
  from_set_id  uuid,
  effective_at timestamptz NOT NULL
);

CREATE TABLE pr_event (
  athlete_id       uuid NOT NULL,
  exercise_id      uuid NOT NULL,
  rep_count        int  NOT NULL,          -- PRs are PER REP-COUNT
  value_kg         numeric NOT NULL,
  achieved_at      timestamptz NOT NULL,
  performed_set_id uuid NOT NULL,
  PRIMARY KEY (athlete_id, exercise_id, rep_count, achieved_at)
);

CREATE TABLE block (
  id            uuid PRIMARY KEY,
  session_id    uuid NOT NULL,
  ordinal       int  NOT NULL,
  category      text NOT NULL,  -- prep|speed_agility|skill_tech|strength_power|conditioning|recovery
  title         text,
  grouping      text NOT NULL,  -- single|superset|circuit  → drives A / A1,A2 / B1..B4
  scheme        text,           -- NULL|amrap|emom|e2mom|for_time|intervals|tabata|rounds
  scheme_params jsonb,          -- {cap_s:1200} | {interval_s:60,rounds:10} | {work_s:20,rest_s:10,rounds:8}
  score_metric  text REFERENCES metric(key),  -- rounds|duration|calories|distance|NULL
  is_test       boolean NOT NULL DEFAULT false   -- their "Test This Block"
);
