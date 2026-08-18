-- ============================================================================
-- PHASE E — additive only. Adds the `pain` metric row that Phase E's exposure
-- classification (pain_blocked) depends on. This was originally added by
-- editing 20260818_strength_rebuild.sql in place; moved here because that
-- migration may already be applied elsewhere, in which case an in-place edit
-- silently never lands and any pain-flag write fails its foreign key.
-- ============================================================================

insert into metric (key, dimension, canonical_unit, value_type, aggregation, higher_is_better, is_load_bearing) values
  ('pain', 'ratio', 'flag', 'scalar', 'none', null, false);
