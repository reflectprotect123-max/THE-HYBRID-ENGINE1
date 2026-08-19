-- ============================================================================
-- PHASE E — additive only. Adds the `pain` metric row that Phase E's exposure
-- classification (pain_blocked) depends on. This was originally added by
-- editing 20260818_strength_rebuild.sql in place; moved here because that
-- migration may already be applied elsewhere, in which case an in-place edit
-- silently never lands and any pain-flag write fails its foreign key.
-- ============================================================================

-- `on conflict do nothing`: in the environment this header describes — the
-- one where 20260818 was applied WITH the in-place edit — the `pain` row
-- already exists, and a bare insert would hit the primary key (`key`) and
-- fail the whole migration. Idempotent either way.
insert into metric (key, dimension, canonical_unit, value_type, aggregation, higher_is_better, is_load_bearing) values
  ('pain', 'ratio', 'flag', 'scalar', 'none', null, false)
on conflict (key) do nothing;
