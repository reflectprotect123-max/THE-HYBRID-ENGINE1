-- ============================================================================
-- STRENGTH REBUILD — additive only. Nothing existing is altered. See
-- docs/superpowers/specs/2026-08-17-strength-rebuild-design.md for the full
-- design; this migration implements it slice by slice, in slice order.
-- ============================================================================

-- Slice 1: metric registry — metrics are rows, not an enum, so a prescribed
-- set can carry any combination of targets instead of a fixed 2-metric cap.
create table metric (
  key              text primary key,
  dimension        text not null,
  canonical_unit   text not null,
  value_type       text not null,
  aggregation      text not null,
  higher_is_better boolean,
  is_load_bearing  boolean not null default false
);

insert into metric (key, dimension, canonical_unit, value_type, aggregation, higher_is_better, is_load_bearing) values
  ('load',     'mass',   'kg',  'scalar',   'sum',  true,  true),
  ('reps',     'count',  'rep', 'scalar',   'sum',  true,  false),
  ('rpe',      'ratio',  'rpe', 'scalar',   'mean', null,  false),
  ('rir',      'ratio',  'rep', 'scalar',   'mean', false, false),
  ('tempo',    'time',   's',   'tuple',    'none', null,  false),
  ('rest',     'time',   's',   'duration', 'none', null,  false),
  ('distance', 'length', 'm',   'scalar',   'sum',  true,  false),
  ('duration', 'time',   's',   'duration', 'sum',  null,  false),
  ('calories', 'energy', 'kcal','scalar',   'sum',  true,  false),
  ('watts',    'power',  'W',   'scalar',   'mean', true,  false),
  ('height',   'length', 'm',   'scalar',   'max',  true,  false);

-- Slice 2: exercise rebuild, with equipment and the reference-max/track-as
-- graph. Cycle depth is enforced by a trigger, not app code.
create table equipment (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  increment_kg   numeric,
  rack_values_kg numeric[],
  rounding       text not null default 'down'
);

create table exercise (
  id                        uuid primary key default gen_random_uuid(),
  owner_id                  uuid,
  name                      text not null,
  video_asset_id            uuid,
  cues                      text,
  equipment_id              uuid references equipment(id),
  default_metrics           text[] not null default '{reps,load}',
  reference_max_exercise_id uuid references exercise(id),
  track_as_exercise_id      uuid references exercise(id),
  e1rm_formula              text not null default 'epley',
  check (id <> reference_max_exercise_id),
  check (id <> track_as_exercise_id)
);

create function check_exercise_edge_depth() returns trigger as $$
begin
  if new.reference_max_exercise_id is not null and exists (
    select 1 from exercise e where e.id = new.reference_max_exercise_id
      and e.reference_max_exercise_id is not null
  ) then raise exception 'reference_max_exercise_id must point at a root (depth <= 1)'; end if;
  if new.track_as_exercise_id is not null and exists (
    select 1 from exercise e where e.id = new.track_as_exercise_id
      and e.track_as_exercise_id is not null
  ) then raise exception 'track_as_exercise_id must point at a root (depth <= 1)'; end if;
  return new;
end; $$ language plpgsql;

create trigger exercise_edge_depth before insert or update on exercise
  for each row execute function check_exercise_edge_depth();

-- Slice 3: a prescribed set is a set of typed targets, not fixed columns —
-- the fix for a fixed 2-metric-per-set ceiling.
create table strength_block_item (
  id           uuid primary key default gen_random_uuid(),
  block_id     uuid not null,
  exercise_id  uuid not null references exercise(id),
  ordinal      int  not null,
  grouping_key text,
  unique (block_id, ordinal)
);

create table prescribed_set (
  id                uuid primary key default gen_random_uuid(),
  block_item_id     uuid not null references strength_block_item(id) on delete cascade,
  ordinal           int  not null,
  is_optional       boolean not null default false,
  is_amrap          boolean not null default false,
  unique (block_item_id, ordinal)
);

create table prescribed_target (
  prescribed_set_id uuid not null references prescribed_set(id) on delete cascade,
  metric_key        text not null references metric(key),
  literal_value      numeric,
  range_lo           numeric,
  range_hi           numeric,
  expr_kind          text,
  expr_arg           numeric,
  expr_ref_exercise  uuid references exercise(id),
  primary key (prescribed_set_id, metric_key),
  check (
    (literal_value is not null)::int +
    (range_lo is not null and range_hi is not null)::int +
    (expr_kind is not null)::int = 1
  )
);

-- Slice 6: publish-time snapshot. After publish, nothing reads
-- prescribed_target for this session again — only resolved_snapshot. A
-- later template edit must never rewrite what an athlete was already told.
create table assigned_session (
  id                uuid primary key default gen_random_uuid(),
  athlete_id        uuid not null,
  source_session_id uuid,
  scheduled_date    date not null,
  state             text not null default 'draft',
  published_at      timestamptz,
  resolved_snapshot jsonb,
  timezone          text not null
);

-- Slice 7: performance is an independently-shaped set of measurements.
-- Client-generated id (offline-first): a retried sync is a no-op upsert.
create table performed_set (
  id                  uuid primary key,
  assigned_session_id uuid not null references assigned_session(id),
  exercise_id         uuid not null references exercise(id),
  prescribed_set_id   uuid references prescribed_set(id),
  ordinal             int not null,
  status              text not null,
  performed_at        timestamptz not null,
  client_created_at   timestamptz not null
);

create table performed_measurement (
  performed_set_id uuid not null references performed_set(id) on delete cascade,
  metric_key       text not null references metric(key),
  value            numeric not null,
  primary key (performed_set_id, metric_key)
);

-- Slice 9: working max is event-sourced, never a mutable column.
create table working_max_event (
  id           uuid primary key default gen_random_uuid(),
  athlete_id   uuid not null,
  exercise_id  uuid not null,
  value_kg     numeric not null,
  source       text not null,
  formula      text,
  from_set_id  uuid references performed_set(id),
  effective_at timestamptz not null
);

-- Slice 10: PRs are per rep-count, not collapsed.
create table pr_event (
  athlete_id       uuid not null,
  exercise_id      uuid not null,
  rep_count        int  not null,
  value_kg         numeric not null,
  achieved_at      timestamptz not null,
  performed_set_id uuid not null references performed_set(id),
  primary key (athlete_id, exercise_id, rep_count, achieved_at)
);
