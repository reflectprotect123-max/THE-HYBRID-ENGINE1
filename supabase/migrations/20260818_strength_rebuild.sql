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
