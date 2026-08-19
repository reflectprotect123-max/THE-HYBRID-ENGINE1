-- ============================================================================
-- STRENGTH RLS — row level security for every table 20260818_strength_rebuild
-- created, plus coaching_note from 20260819_phase_f. Additive only; sorts
-- after 20260820_strength_hardening and edits neither file in place, for the
-- same reason that one didn't: 20260818 may already be applied somewhere.
--
-- Until this migration, every strength table was created with the
-- project-default ACL (ALL to anon and authenticated) and NO row level
-- security — any signed-in user could read and rewrite any athlete's
-- working-max history, PRs and logged sets, and `anon` could too. This file
-- closes that, following the conventions already in the tree:
--
--   * 20260807_macrotrack_food_catalogue: explicit grants instead of the
--     Supabase default ACL ("anon gets nothing at all"), shared catalogue =
--     select-only with no write policy (seeding is a service-role job;
--     service_role bypasses RLS), owner tables keyed on the user, child
--     tables owned through their parent row.
--   * 20260808_arc_coach_workspace / 20260813_arc_roster_invites_and_names:
--     a coach's read access is the three-row test `coaches_athlete_anywhere`
--     already encodes — active assignment, active privileged coach
--     membership, active athlete membership. The strength tables carry no
--     organization_id (assigned_session is keyed on the athlete alone), so
--     the org-less variant is the one that fits, exactly as it fits
--     athlete_profiles.
--   * auth.uid() is wrapped in (select auth.uid()) so the planner evaluates
--     it once per statement (initplan), not once per row, and every column a
--     policy filters on is indexed below.
--
-- Write model, stated plainly so nobody widens it by accident:
--
--   * The ATHLETE writes their own performance: assigned_session,
--     performed_set, performed_measurement (all upsert-shaped — 20260818's
--     own comment says a retried offline sync is a no-op upsert, so UPDATE
--     is part of the contract), and appends to the two ledgers.
--   * working_max_event and pr_event are LEDGERS: insert and select only.
--     There are deliberately NO update or delete policies, and update/delete
--     are not even granted — history is append-only at both layers.
--     `source = 'coach_set'` rows are minted by the server-side command
--     layer (service role), not by a client policy here.
--   * A COACH reads. No coach write policy exists on any of these tables;
--     coach-driven writes arrive through SECURITY DEFINER commands the way
--     every ARC write does, when those commands are built.
--   * The shared reference tables (metric, equipment, and the authored
--     template content strength_block_item / prescribed_set /
--     prescribed_target, which carry no owner column — block_id points at
--     client-side blocks on purpose, see 20260820's column comment) are
--     readable by every signed-in user and writable by nobody but the
--     service role.
-- ============================================================================

alter table public.metric enable row level security;
alter table public.equipment enable row level security;
alter table public.exercise enable row level security;
alter table public.strength_block_item enable row level security;
alter table public.prescribed_set enable row level security;
alter table public.prescribed_target enable row level security;
alter table public.assigned_session enable row level security;
alter table public.performed_set enable row level security;
alter table public.performed_measurement enable row level security;
alter table public.pr_event enable row level security;
alter table public.working_max_event enable row level security;

-- ---------------------------------------------------------------------------
-- Table privileges. Same shape as 20260807: the default ACL granted ALL to
-- both roles, so it is revoked outright and only what the policies below
-- could ever allow is granted back. `anon` gets nothing at all; the ledgers
-- lose update/delete at the GRANT layer as well as the policy layer, so
-- append-only does not depend on a single mechanism. service_role is
-- untouched and keeps its bypass — that is the seeding/command path.
-- ---------------------------------------------------------------------------

revoke all on public.metric from anon, authenticated;
revoke all on public.equipment from anon, authenticated;
revoke all on public.exercise from anon, authenticated;
revoke all on public.strength_block_item from anon, authenticated;
revoke all on public.prescribed_set from anon, authenticated;
revoke all on public.prescribed_target from anon, authenticated;
revoke all on public.assigned_session from anon, authenticated;
revoke all on public.performed_set from anon, authenticated;
revoke all on public.performed_measurement from anon, authenticated;
revoke all on public.pr_event from anon, authenticated;
revoke all on public.working_max_event from anon, authenticated;

grant select on
    public.metric,
    public.equipment,
    public.strength_block_item,
    public.prescribed_set,
    public.prescribed_target
to authenticated;
grant select, insert, update, delete on public.exercise to authenticated;
grant select, insert, update on
    public.assigned_session,
    public.performed_set,
    public.performed_measurement
to authenticated;
grant select, insert on public.pr_event, public.working_max_event to authenticated;

-- ---------------------------------------------------------------------------
-- Shared reference data: read for every signed-in user, write for nobody.
-- There is deliberately no insert/update/delete policy — exactly the foods /
-- food_servings pattern.
-- ---------------------------------------------------------------------------

drop policy if exists metric_read_authenticated on public.metric;
create policy metric_read_authenticated on public.metric
    for select to authenticated using (true);

drop policy if exists equipment_read_authenticated on public.equipment;
create policy equipment_read_authenticated on public.equipment
    for select to authenticated using (true);

drop policy if exists block_item_read_authenticated on public.strength_block_item;
create policy block_item_read_authenticated on public.strength_block_item
    for select to authenticated using (true);

drop policy if exists prescribed_set_read_authenticated on public.prescribed_set;
create policy prescribed_set_read_authenticated on public.prescribed_set
    for select to authenticated using (true);

drop policy if exists prescribed_target_read_authenticated on public.prescribed_target;
create policy prescribed_target_read_authenticated on public.prescribed_target
    for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- exercise: owner_id is nullable on purpose — a null owner is the global
-- library, a non-null owner is somebody's custom exercise. Read: the library
-- plus your own. Write: your own only, and with check pins owner_id to the
-- caller so nobody publishes into the global library (owner_id null fails
-- the with check) or into somebody else's account through the client role.
-- ---------------------------------------------------------------------------

drop policy if exists exercise_read on public.exercise;
create policy exercise_read on public.exercise
    for select to authenticated
    using (owner_id is null or owner_id = (select auth.uid()));

drop policy if exists exercise_owner_insert on public.exercise;
create policy exercise_owner_insert on public.exercise
    for insert to authenticated
    with check (owner_id = (select auth.uid()));

drop policy if exists exercise_owner_update on public.exercise;
create policy exercise_owner_update on public.exercise
    for update to authenticated
    using (owner_id = (select auth.uid()))
    with check (owner_id = (select auth.uid()));

drop policy if exists exercise_owner_delete on public.exercise;
create policy exercise_owner_delete on public.exercise
    for delete to authenticated
    using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- assigned_session: keyed directly on the athlete. The athlete reads and
-- writes their own; a current coach reads (coaches_athlete_anywhere — the
-- table has no organization_id, so the org-less three-row test is the right
-- one). Update's with check repeats the ownership test so a row cannot be
-- reassigned to another athlete; what may change WITHIN a published row is
-- 20260820's freeze trigger's job, not RLS's.
-- ---------------------------------------------------------------------------

drop policy if exists assigned_session_athlete_select on public.assigned_session;
create policy assigned_session_athlete_select on public.assigned_session
    for select to authenticated
    using (athlete_id = (select auth.uid()));

drop policy if exists assigned_session_coach_select on public.assigned_session;
create policy assigned_session_coach_select on public.assigned_session
    for select to authenticated
    using (public.coaches_athlete_anywhere(athlete_id));

drop policy if exists assigned_session_athlete_insert on public.assigned_session;
create policy assigned_session_athlete_insert on public.assigned_session
    for insert to authenticated
    with check (athlete_id = (select auth.uid()));

drop policy if exists assigned_session_athlete_update on public.assigned_session;
create policy assigned_session_athlete_update on public.assigned_session
    for update to authenticated
    using (athlete_id = (select auth.uid()))
    with check (athlete_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- performed_set: owned through its assigned_session (the parent-row pattern
-- macro_program_days uses). The subquery runs as the caller, so the parent's
-- own RLS applies inside it — a coach passes because the coach SELECT policy
-- above lets them see the session; an athlete passes only for their own.
-- The write policies do NOT lean on that indirection: they name the athlete
-- test explicitly, so a coach's read access never quietly becomes write
-- access if a broader session policy is ever added.
-- ---------------------------------------------------------------------------

drop policy if exists performed_set_select on public.performed_set;
create policy performed_set_select on public.performed_set
    for select to authenticated
    using (exists (
        select 1 from public.assigned_session s
        where s.id = performed_set.assigned_session_id
    ));

drop policy if exists performed_set_athlete_insert on public.performed_set;
create policy performed_set_athlete_insert on public.performed_set
    for insert to authenticated
    with check (exists (
        select 1 from public.assigned_session s
        where s.id = performed_set.assigned_session_id
          and s.athlete_id = (select auth.uid())
    ));

drop policy if exists performed_set_athlete_update on public.performed_set;
create policy performed_set_athlete_update on public.performed_set
    for update to authenticated
    using (exists (
        select 1 from public.assigned_session s
        where s.id = performed_set.assigned_session_id
          and s.athlete_id = (select auth.uid())
    ))
    with check (exists (
        select 1 from public.assigned_session s
        where s.id = performed_set.assigned_session_id
          and s.athlete_id = (select auth.uid())
    ));

-- ---------------------------------------------------------------------------
-- performed_measurement: owned two hops up, through its set's session.
-- ---------------------------------------------------------------------------

drop policy if exists performed_measurement_select on public.performed_measurement;
create policy performed_measurement_select on public.performed_measurement
    for select to authenticated
    using (exists (
        select 1 from public.performed_set ps
        where ps.id = performed_measurement.performed_set_id
    ));

drop policy if exists performed_measurement_athlete_insert on public.performed_measurement;
create policy performed_measurement_athlete_insert on public.performed_measurement
    for insert to authenticated
    with check (exists (
        select 1
        from public.performed_set ps
        join public.assigned_session s on s.id = ps.assigned_session_id
        where ps.id = performed_measurement.performed_set_id
          and s.athlete_id = (select auth.uid())
    ));

drop policy if exists performed_measurement_athlete_update on public.performed_measurement;
create policy performed_measurement_athlete_update on public.performed_measurement
    for update to authenticated
    using (exists (
        select 1
        from public.performed_set ps
        join public.assigned_session s on s.id = ps.assigned_session_id
        where ps.id = performed_measurement.performed_set_id
          and s.athlete_id = (select auth.uid())
    ))
    with check (exists (
        select 1
        from public.performed_set ps
        join public.assigned_session s on s.id = ps.assigned_session_id
        where ps.id = performed_measurement.performed_set_id
          and s.athlete_id = (select auth.uid())
    ));

-- ---------------------------------------------------------------------------
-- The two ledgers. Insert and select only — no update, no delete, at either
-- the grant or the policy layer. The insert policies also close the
-- owner-reference hole 20260807's food-log policies closed: a foreign key
-- check does not consult RLS, so without the extra exists an athlete could
-- mint a working-max or PR event pointing at ANOTHER athlete's performed
-- set. The referenced set must belong to the caller's own session.
-- ---------------------------------------------------------------------------

drop policy if exists working_max_event_athlete_select on public.working_max_event;
create policy working_max_event_athlete_select on public.working_max_event
    for select to authenticated
    using (athlete_id = (select auth.uid()));

drop policy if exists working_max_event_coach_select on public.working_max_event;
create policy working_max_event_coach_select on public.working_max_event
    for select to authenticated
    using (public.coaches_athlete_anywhere(athlete_id));

drop policy if exists working_max_event_athlete_insert on public.working_max_event;
create policy working_max_event_athlete_insert on public.working_max_event
    for insert to authenticated
    with check (
        athlete_id = (select auth.uid())
        and (from_set_id is null or exists (
            select 1
            from public.performed_set ps
            join public.assigned_session s on s.id = ps.assigned_session_id
            where ps.id = working_max_event.from_set_id
              and s.athlete_id = (select auth.uid())
        ))
    );

drop policy if exists pr_event_athlete_select on public.pr_event;
create policy pr_event_athlete_select on public.pr_event
    for select to authenticated
    using (athlete_id = (select auth.uid()));

drop policy if exists pr_event_coach_select on public.pr_event;
create policy pr_event_coach_select on public.pr_event
    for select to authenticated
    using (public.coaches_athlete_anywhere(athlete_id));

drop policy if exists pr_event_athlete_insert on public.pr_event;
create policy pr_event_athlete_insert on public.pr_event
    for insert to authenticated
    with check (
        athlete_id = (select auth.uid())
        and exists (
            select 1
            from public.performed_set ps
            join public.assigned_session s on s.id = ps.assigned_session_id
            where ps.id = pr_event.performed_set_id
              and s.athlete_id = (select auth.uid())
        )
    );

-- ---------------------------------------------------------------------------
-- Indexes on the columns the policies filter on, where nothing indexes them
-- yet. Not needed: pr_event.athlete_id (leading column of its primary key),
-- performed_measurement.performed_set_id (leading column of its primary
-- key), prescribed_set.block_item_id and strength_block_item's block_id
-- (leading columns of their unique constraints).
-- ---------------------------------------------------------------------------

create index if not exists exercise_owner_idx
    on public.exercise (owner_id) where owner_id is not null;
create index if not exists assigned_session_athlete_idx
    on public.assigned_session (athlete_id, scheduled_date);
create index if not exists performed_set_session_idx
    on public.performed_set (assigned_session_id);
create index if not exists working_max_event_athlete_idx
    on public.working_max_event (athlete_id, exercise_id, effective_at);

-- ---------------------------------------------------------------------------
-- coaching_note — owner-scoped everything, and the search function gets the
-- owner filter its RLS-bypassing absence implied. Guarded exactly the way
-- 20260820's section 6 is: on a machine without pgvector, phase_f never
-- applied, the table does not exist, and this block must be a no-op rather
-- than a second failure. Same transaction-local search_path dance, same
-- reason (the vector type lives in `public` locally and `extensions` on
-- Supabase).
--
-- The function is SECURITY INVOKER, so once RLS is on, the policy alone
-- already scopes it — the explicit `owner_id = (select auth.uid())` is kept
-- anyway so the function states its own boundary and survives someone later
-- marking it definer or widening a policy.
-- ---------------------------------------------------------------------------

do $do$
begin
  if to_regclass('public.coaching_note') is not null then
    perform set_config('search_path', 'public, extensions', true);

    execute $sql$
      alter table public.coaching_note enable row level security;

      revoke all on public.coaching_note from anon, authenticated;
      grant select, insert, update, delete on public.coaching_note to authenticated;

      drop policy if exists coaching_note_owner_all on public.coaching_note;
      create policy coaching_note_owner_all on public.coaching_note for all to authenticated
          using (owner_id = (select auth.uid()))
          with check (owner_id = (select auth.uid()));

      create index if not exists coaching_note_owner_idx
          on public.coaching_note (owner_id);

      create or replace function public.search_coaching_notes(query_embedding vector(1024), match_count int default 5)
      returns setof public.coaching_note
      language sql stable
      set search_path = public, extensions
      as $body$
        select * from public.coaching_note
        where embedding is not null
          and owner_id = (select auth.uid())
        order by embedding <=> query_embedding
        limit match_count;
      $body$;

      revoke all on function public.search_coaching_notes(vector, int) from public;
      grant execute on function public.search_coaching_notes(vector, int) to authenticated;
    $sql$;
  end if;
end
$do$;
