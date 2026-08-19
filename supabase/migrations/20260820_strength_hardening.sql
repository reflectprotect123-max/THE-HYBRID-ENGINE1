-- ============================================================================
-- STRENGTH HARDENING — fixes confirmed defects in 20260818_strength_rebuild
-- (and one function from 20260819_phase_f) WITHOUT editing either file in
-- place, because 20260818 may already be applied somewhere and an in-place
-- edit silently never lands there (the exact failure 20260819_phase_e's own
-- header records).
--
-- Constraint style: every CHECK and FK below is added PLAIN, not as
-- `not valid` + `validate`. These tables are empty pre-production — nothing
-- here has ever run against real rows — so there is no long-lived lock or
-- existing-row risk to stage around. If this ever has to be re-run against a
-- populated database, switch to `add constraint ... not valid` followed by
-- `validate constraint`.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Exercise edge depth, done properly.
--
-- The 20260818 trigger only validated the NEW row's outgoing edge, so
-- updating a PARENT could create depth>1 chains: with A→B in place, updating
-- B to point at C passed (B's own edge target C is a root) while leaving
-- A→B→C. Both edge columns (`reference_max_exercise_id`, `track_as_exercise_id`)
-- had the identical hole.
--
-- Replaced with a CONSTRAINT trigger that
--   (a) locks the far end of each changed edge (`for update`), so two
--       concurrent transactions cannot each commit half of a 2-cycle — the
--       second blocks on the row lock, then re-reads committed state and fails;
--   (b) walks the FULL chain from the changed row with a recursive CTE, so
--       any chain deeper than one hop — or any cycle reachable from the row —
--       is refused no matter which end was edited;
--   (c) re-checks rows that REFERENCE the changed row: a row that now has an
--       outgoing edge may not itself be pointed at.
-- ----------------------------------------------------------------------------

drop trigger if exists exercise_edge_depth on public.exercise;

create or replace function public.check_exercise_edge_depth() returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  -- Lock the targets of the changed edges. This serialises the concurrent
  -- "A→B while B→A" race: whichever transaction commits second re-reads the
  -- winner's committed edge and fails one of the checks below.
  perform 1 from public.exercise e
    where e.id = any (array_remove(
      array[new.reference_max_exercise_id, new.track_as_exercise_id], null))
    for update;

  -- reference_max: full-chain walk from the changed row. depth > 1 covers
  -- both a too-deep chain and any cycle (a cycle revisits a seen id, which
  -- always happens at depth >= 2 given the table's own id <> self checks).
  if exists (
    with recursive chain as (
      select e.id, e.reference_max_exercise_id, 0 as depth, array[e.id] as seen
        from public.exercise e where e.id = new.id
      union all
      select e.id, e.reference_max_exercise_id, c.depth + 1, c.seen || e.id
        from chain c
        join public.exercise e on e.id = c.reference_max_exercise_id
       where c.depth < 8 -- hard stop; anything past depth 1 already fails
    )
    select 1 from chain where depth > 1
  ) then
    raise exception 'reference_max_exercise_id must point at a root (depth <= 1)';
  end if;

  -- reference_max: the reverse direction — if this row now has an outgoing
  -- edge, nothing may point at it.
  if new.reference_max_exercise_id is not null and exists (
    select 1 from public.exercise e
     where e.reference_max_exercise_id = new.id and e.id <> new.id
  ) then
    raise exception 'exercise is referenced as a reference max and may not itself reference one (depth <= 1)';
  end if;

  -- track_as: same pattern, same holes, same fix.
  if exists (
    with recursive chain as (
      select e.id, e.track_as_exercise_id, 0 as depth, array[e.id] as seen
        from public.exercise e where e.id = new.id
      union all
      select e.id, e.track_as_exercise_id, c.depth + 1, c.seen || e.id
        from chain c
        join public.exercise e on e.id = c.track_as_exercise_id
       where c.depth < 8
    )
    select 1 from chain where depth > 1
  ) then
    raise exception 'track_as_exercise_id must point at a root (depth <= 1)';
  end if;

  if new.track_as_exercise_id is not null and exists (
    select 1 from public.exercise e
     where e.track_as_exercise_id = new.id and e.id <> new.id
  ) then
    raise exception 'exercise is tracked-as by others and may not itself track as another (depth <= 1)';
  end if;

  return new;
end;
$fn$;

revoke all on function public.check_exercise_edge_depth() from public;

-- Constraint triggers are AFTER by definition, which is what the re-check
-- semantics need: the row is in place when the walk runs.
create constraint trigger exercise_edge_depth
  after insert or update of reference_max_exercise_id, track_as_exercise_id
  on public.exercise
  for each row execute function public.check_exercise_edge_depth();

-- ----------------------------------------------------------------------------
-- 2. Freeze resolved_snapshot after publish.
--
-- 20260818's own comment promises "after publish, nothing reads
-- prescribed_target for this session again — only resolved_snapshot. A later
-- template edit must never rewrite what an athlete was already told" — and
-- nothing enforced it. Once a session has left 'draft', its snapshot and its
-- published_at are immutable; state transitions themselves
-- (published → in_progress → completed | skipped) remain allowed.
-- ----------------------------------------------------------------------------

create or replace function public.enforce_assigned_session_freeze() returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if old.state <> 'draft' then
    if new.resolved_snapshot is distinct from old.resolved_snapshot then
      raise exception 'resolved_snapshot is frozen once the session is published';
    end if;
    if new.published_at is distinct from old.published_at then
      raise exception 'published_at is frozen once the session is published';
    end if;
    if new.state = 'draft' then
      raise exception 'a published session cannot return to draft';
    end if;
  end if;
  return new;
end;
$fn$;

revoke all on function public.enforce_assigned_session_freeze() from public;

create trigger assigned_session_freeze
  before update on public.assigned_session
  for each row execute function public.enforce_assigned_session_freeze();

-- ----------------------------------------------------------------------------
-- 3. Missing foreign keys.
--
-- exercise_id on the two append-only ledgers is RESTRICT, not CASCADE: a
-- ledger must not lose history because an exercise row went away.
-- athlete_id follows 20260804's convention for user FKs:
-- `references auth.users(id) on delete cascade` (account erasure takes the
-- user's rows with it).
-- ----------------------------------------------------------------------------

alter table public.working_max_event
  add constraint working_max_event_exercise_fk
  foreign key (exercise_id) references public.exercise(id) on delete restrict;

alter table public.pr_event
  add constraint pr_event_exercise_fk
  foreign key (exercise_id) references public.exercise(id) on delete restrict;

alter table public.working_max_event
  add constraint working_max_event_athlete_fk
  foreign key (athlete_id) references auth.users(id) on delete cascade;

alter table public.pr_event
  add constraint pr_event_athlete_fk
  foreign key (athlete_id) references auth.users(id) on delete cascade;

alter table public.assigned_session
  add constraint assigned_session_athlete_fk
  foreign key (athlete_id) references auth.users(id) on delete cascade;

-- Deliberately NOT foreign keys, recorded so nobody "fixes" them:
comment on column public.strength_block_item.block_id is
  'No FK on purpose: blocks live client-side in @hybrid/engine''s Block<S> '
  'union — there is no server-side block table to reference.';
comment on column public.assigned_session.source_session_id is
  'No FK on purpose: provenance to the authored template/day, which has no '
  'server-side table in this schema.';

-- ----------------------------------------------------------------------------
-- 4. prescribed_target shape checks.
--
-- The 20260818 exactly-one-strategy check counted "(range_lo is not null and
-- range_hi is not null)" as one unit, so a dangling range_lo alongside a
-- literal_value still summed to 1 and passed. Companion columns are pinned
-- to their strategy here. Unions per packages/strength-engine/src
-- (prescription.ts, resolve.ts): expr_arg is REQUIRED for pct_of_max,
-- lwp_delta and pct_of_bodyweight and forbidden otherwise; expr_ref_exercise
-- only means anything to pct_of_max. lwp_delta's arg is a DELTA and may be
-- negative; the other numeric columns may not.
-- ----------------------------------------------------------------------------

alter table public.prescribed_target
  add constraint prescribed_target_range_pair
  check ((range_lo is null) = (range_hi is null));

alter table public.prescribed_target
  add constraint prescribed_target_range_order
  check (range_lo is null or range_lo <= range_hi);

alter table public.prescribed_target
  add constraint prescribed_target_expr_kind
  check (expr_kind is null
         or expr_kind in ('pct_of_max', 'lwp_delta', 'pct_of_bodyweight', 'rpe_autoreg'));

alter table public.prescribed_target
  add constraint prescribed_target_expr_arg
  check (case when expr_kind in ('pct_of_max', 'lwp_delta', 'pct_of_bodyweight')
              then expr_arg is not null
              else expr_arg is null end);

alter table public.prescribed_target
  add constraint prescribed_target_expr_ref
  check (expr_ref_exercise is null or expr_kind = 'pct_of_max');

alter table public.prescribed_target
  add constraint prescribed_target_nonnegative
  check ((literal_value is null or literal_value >= 0)
     and (range_lo is null or range_lo >= 0)
     and (range_hi is null or range_hi >= 0)
     and (expr_arg is null or expr_kind = 'lwp_delta' or expr_arg >= 0));

-- ----------------------------------------------------------------------------
-- 5. Enum-shaped text pinned to the engine's unions, and positivity.
--
-- Values are copied from packages/strength-engine/src — workingMax.ts,
-- performed.ts, exercise.ts, e1rm.ts, metric.ts — and from the design doc's
-- assigned_session state machine (draft|published|in_progress|completed|
-- skipped). increment_kg = 0 is refused because the engine divides by it
-- (rounding.ts) and a zero produces NaN loads — audit-confirmed.
-- ----------------------------------------------------------------------------

alter table public.working_max_event
  add constraint working_max_event_source_ck
  check (source in ('auto_estimate', 'coach_set', 'athlete_set', 'test_result'));

alter table public.working_max_event
  add constraint working_max_event_formula_ck
  check (formula is null or formula in ('epley', 'brzycki'));

alter table public.working_max_event
  add constraint working_max_event_value_ck
  check (value_kg > 0);

alter table public.performed_set
  add constraint performed_set_status_ck
  check (status in ('completed', 'skipped', 'not_reached'));

alter table public.assigned_session
  add constraint assigned_session_state_ck
  check (state in ('draft', 'published', 'in_progress', 'completed', 'skipped'));

alter table public.equipment
  add constraint equipment_rounding_ck
  check (rounding in ('down', 'nearest', 'none'));

alter table public.equipment
  add constraint equipment_increment_ck
  check (increment_kg is null or increment_kg > 0);

alter table public.exercise
  add constraint exercise_e1rm_formula_ck
  check (e1rm_formula in ('epley', 'brzycki'));

alter table public.metric
  add constraint metric_value_type_ck
  check (value_type in ('scalar', 'range', 'tuple', 'duration'));

alter table public.metric
  add constraint metric_aggregation_ck
  check (aggregation in ('sum', 'mean', 'max', 'min', 'last', 'none'));

alter table public.pr_event
  add constraint pr_event_value_ck
  check (value_kg > 0);

alter table public.pr_event
  add constraint pr_event_rep_count_ck
  check (rep_count >= 0);

-- ----------------------------------------------------------------------------
-- 6. search_coaching_notes hardening (from 20260819_phase_f).
--
-- Guarded: locally, phase_f dies at `create extension vector` (no pgvector),
-- so coaching_note and the original function never exist and this block must
-- be a no-op rather than a second failure. `to_regclass` is the guard.
--
-- search_path is `public, extensions`, NOT '' — 20260815_arc_pgcrypto_
-- search_path records exactly why: the vector type and its <=> operator live
-- in `public` on a bare local Postgres and in `extensions` on Supabase, so a
-- fully-qualified spelling breaks one of the two. The pin still excludes
-- anything a caller might put in front. Revoke/grant follows 20260804's
-- pattern (revoke from public, grant execute to authenticated).
-- ----------------------------------------------------------------------------

do $do$
begin
  if to_regclass('public.coaching_note') is not null then
    -- Transaction-local search_path so the unqualified `vector` in the
    -- signatures below resolves wherever the extension actually lives.
    -- (set_config tolerates the missing `extensions` schema locally.)
    perform set_config('search_path', 'public, extensions', true);

    execute $sql$
      alter table public.coaching_note
        add constraint coaching_note_owner_fk
        foreign key (owner_id) references auth.users(id) on delete cascade;

      create or replace function public.search_coaching_notes(query_embedding vector(1024), match_count int default 5)
      returns setof public.coaching_note
      language sql stable
      set search_path = public, extensions
      as $body$
        select * from public.coaching_note
        where embedding is not null
        order by embedding <=> query_embedding
        limit match_count;
      $body$;

      revoke all on function public.search_coaching_notes(vector, int) from public;
      grant execute on function public.search_coaching_notes(vector, int) to authenticated;
    $sql$;
  end if;
end
$do$;
