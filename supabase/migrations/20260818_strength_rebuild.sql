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
