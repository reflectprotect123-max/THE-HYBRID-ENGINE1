-- ---------------------------------------------------------------------------
-- ARC coach workspace — get_athlete_workout_library
--
-- Builds the design in docs/ARC_LAYER3_DESIGN.md §6, resolving sign-off 1
-- (CoachAuthoring's live-tuning mode gets a real backend rather than being
-- retired for roster clients). That design went through the same
-- proposal → synthesis → adversarial critique process as
-- 20260808_arc_coach_workspace.sql itself, and the critique found six real
-- problems before any SQL existed. Every one is fixed here, not deferred:
--
--   1. The design's own proposed CHECK constraint used a subquery, which
--      Postgres forbids -- program_templates.athlete_user_id carries no
--      CHECK at all. The invariant it was meant to express (a private
--      template's athlete really is coached, in this organisation) is
--      guaranteed instead by there being exactly one write path
--      (save_workout_draft), which proves coaches_athlete() before it ever
--      sets the column.
--   2. CRITICAL — the design let a coach who coaches two different athletes
--      assign one athlete's PRIVATE template to the other, because
--      create_program_assignment only ever checked that a template version
--      belonged to the right ORGANISATION, never the right ATHLETE. Fixed
--      by amending that function (below) to also require
--      `athlete_user_id is null or athlete_user_id = p_athlete_user_id`.
--   3. A private template would otherwise be visible to any coach in the
--      organisation through the existing, organisation-scoped
--      program_templates/program_template_versions read policies, which
--      predate this athlete-scoped row shape. Fixed with a shared
--      can_read_program_template() helper, used by both policies.
--   4. The design had a coach_decisions row written on every draft save
--      ("workout_draft_saved", a kind that does not even exist in the
--      enum) while also claiming drafts were unaudited. Resolved: no
--      decision row on save. Only publish is audited, and it reuses
--      create_program_assignment's existing, already-reviewed
--      decision+receipt pair rather than inventing a second trail.
--   5. A check-then-insert race on first save could mint two private
--      templates for one client-side Workout.id. Fixed with a real unique
--      constraint plus INSERT ... ON CONFLICT, not an advisory lock —
--      consistent with how this file solves everything else.
--   6. Workout.dates (one-off dates) has no home in program_assignments,
--      which models a start date plus a recurring weekday set only.
--      publish_workout_draft now rejects a dates-based workout explicitly
--      rather than silently dropping real coach intent.
--
-- Same hard rules as the base migration: no client role holds INSERT on
-- anything here; every write is a SECURITY DEFINER command that derives the
-- actor from auth.uid() and checks coaches_athlete() as its first
-- statement; no table here carries FORCE ROW LEVEL SECURITY, for the same
-- reason recorded in docs/RISK_REGISTER.md — the owner exemption IS the
-- write path.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. A template may now belong to one athlete instead of the organisation.
-- ---------------------------------------------------------------------------

alter table public.program_templates
  add column if not exists athlete_user_id uuid references auth.users(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- 2. The mutable draft a coach actually live-tunes. Never audited row by
-- row — that is `program_template_versions`' job, at publish only.
-- ---------------------------------------------------------------------------

create table if not exists public.coach_workout_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  athlete_user_id uuid not null references auth.users(id) on delete cascade,
  coach_user_id uuid not null references auth.users(id) on delete restrict,
  -- The client-minted id from EngineDB.workouts, so a published draft can be
  -- traced back to the exact local Workout it came from. Not a `uuid` column
  -- — real ids look like `strength:<sessionId>:<moveKey>:<at>`, deterministic
  -- strings, not UUIDs, per the layer-3 design review's finding 3 about a
  -- different table that made this exact mistake.
  workout_id text not null,
  template_id uuid not null references public.program_templates(id) on delete cascade,
  kind text not null,
  -- The real Workout shape (name, blocks, days, dates, folderIds) from
  -- packages/engine/src/types.ts. Opaque here, same reasoning as every other
  -- engine-shaped body column in this system: no progression math in SQL.
  body jsonb not null default '{}'::jsonb,
  base_version integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id) on delete restrict,
  -- One draft head per template.
  unique (template_id),
  -- One draft per client-side Workout, per athlete. This is also the
  -- concurrency backstop for the lazy-create race in save_workout_draft.
  unique (organization_id, athlete_user_id, workout_id),
  constraint coach_workout_draft_kind check (kind in ('strength', 'conditioning')),
  constraint coach_workout_draft_body_object check (jsonb_typeof(body) = 'object'),
  constraint coach_workout_draft_version_nonnegative check (base_version >= 0)
);

alter table public.coach_workout_drafts enable row level security;

drop policy if exists coach_workout_drafts_read on public.coach_workout_drafts;
create policy coach_workout_drafts_read on public.coach_workout_drafts for select to authenticated
  using (
    athlete_user_id = auth.uid()
    or public.coaches_athlete(organization_id, athlete_user_id)
    or public.is_org_member(organization_id, array['owner'])
  );

-- No INSERT/UPDATE/DELETE policy, anywhere, ever — same rule as every other
-- table in this system. save_workout_draft is the only write path, running
-- as the table owner under SECURITY DEFINER.

revoke all on public.coach_workout_drafts from anon;
grant select on public.coach_workout_drafts to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Read authorization for program_templates / program_template_versions,
-- now that a row can be organisation-wide OR private to one athlete.
--
-- Shared by both policies rather than duplicated, because the private case
-- needs a materially different rule than the shared case these tables were
-- built for, and getting it right once beats getting it right twice.
-- ---------------------------------------------------------------------------

create or replace function public.can_read_program_template(org uuid, template_athlete uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when template_athlete is null then
      public.is_org_member(org, array['owner', 'coach', 'support', 'athlete'])
    else
      template_athlete = auth.uid()
      or public.coaches_athlete(org, template_athlete)
      or public.is_org_member(org, array['owner'])
  end;
$$;

revoke all on function public.can_read_program_template(uuid, uuid) from public, anon;
grant execute on function public.can_read_program_template(uuid, uuid) to authenticated;

drop policy if exists program_templates_read on public.program_templates;
create policy program_templates_read on public.program_templates for select to authenticated
  using (public.can_read_program_template(organization_id, athlete_user_id));

drop policy if exists program_template_versions_read on public.program_template_versions;
create policy program_template_versions_read on public.program_template_versions for select to authenticated
  using (exists (
    select 1 from public.program_templates t
    where t.id = program_template_versions.template_id
      and public.can_read_program_template(t.organization_id, t.athlete_user_id)
  ));

-- ---------------------------------------------------------------------------
-- 4. create_program_assignment, amended.
--
-- The ONLY change from the version in 20260808_arc_coach_workspace.sql: the
-- template-ownership check now also requires the template belong to no
-- athlete, or to THIS athlete. Before this, the check only verified the
-- template's ORGANISATION, so a coach who coaches two different athletes in
-- the same org could take a template_version_id snapshotted from one
-- athlete's private draft and assign it to the other — the critical finding
-- from the layer-3 design review. This amendment is not expressible as a
-- rollback "drop" — reverting it means re-deploying the prior body, which is
-- reproduced in full below except for the one added predicate.
-- ---------------------------------------------------------------------------

create or replace function public.create_program_assignment(
  p_organization_id uuid,
  p_athlete_user_id uuid,
  p_template_version_id uuid,
  p_preferred_start_date date,
  p_preferred_weekdays smallint[],
  p_idempotency_key text,
  p_base_version text default null
)
returns public.program_assignments
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_existing public.coach_decisions;
  v_assignment public.program_assignments;
  v_decision_id uuid;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  if not public.coaches_athlete(p_organization_id, p_athlete_user_id) then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'idempotency key required' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_existing from public.coach_decisions
   where organization_id = p_organization_id
     and athlete_user_id = p_athlete_user_id
     and kind = 'assignment_created'
     and idempotency_key = p_idempotency_key;
  if found then
    select * into v_assignment from public.program_assignments
     where id = (v_existing.payload ->> 'assignment_id')::uuid
       and organization_id = p_organization_id
       and athlete_user_id = p_athlete_user_id;
    if v_assignment is null then
      raise exception 'not permitted' using errcode = 'insufficient_privilege';
    end if;
    return v_assignment;
  end if;

  -- The template version must belong to the same organisation, AND — the
  -- amendment — to no athlete in particular, or to THIS one. Without the
  -- second half, a private template built for one athlete via
  -- save_workout_draft/publish_workout_draft could be assigned to any other
  -- athlete the same coach happens to also coach.
  if not exists (
    select 1 from public.program_template_versions v
    join public.program_templates t on t.id = v.template_id
    where v.id = p_template_version_id
      and t.organization_id = p_organization_id
      and (t.athlete_user_id is null or t.athlete_user_id = p_athlete_user_id)
  ) then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  insert into public.program_assignments (
    organization_id, athlete_user_id, template_version_id,
    preferred_start_date, preferred_weekdays, state, created_by
  ) values (
    p_organization_id, p_athlete_user_id, p_template_version_id,
    p_preferred_start_date, coalesce(p_preferred_weekdays, '{}'), 'draft', v_actor
  ) returning * into v_assignment;

  insert into public.coach_decisions (
    organization_id, athlete_user_id, actor_user_id, kind,
    base_version, idempotency_key, payload
  ) values (
    p_organization_id, p_athlete_user_id, v_actor, 'assignment_created',
    p_base_version, p_idempotency_key,
    jsonb_build_object('assignment_id', v_assignment.id, 'template_version_id', p_template_version_id)
  ) returning id into v_decision_id;

  insert into public.decision_receipts (
    decision_id, organization_id, athlete_user_id, summary, detail
  ) values (
    v_decision_id, p_organization_id, p_athlete_user_id,
    'A program was assigned to you.',
    jsonb_build_object('assignment_id', v_assignment.id, 'starts', p_preferred_start_date)
  );

  return v_assignment;
end;
$$;

-- Signature is unchanged, so the existing grant from the base migration
-- still applies; re-stated here so this file is self-sufficient to audit.
revoke all on function public.create_program_assignment(uuid, uuid, uuid, date, smallint[], text, text) from public, anon;
grant execute on function public.create_program_assignment(uuid, uuid, uuid, date, smallint[], text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. save_workout_draft — the only write path to coach_workout_drafts and
-- to a private program_templates row.
-- ---------------------------------------------------------------------------

create or replace function public.save_workout_draft(
  p_organization_id uuid,
  p_athlete_user_id uuid,
  p_workout_id text,
  p_kind text,
  p_body jsonb,
  p_base_version integer default null
)
returns public.coach_workout_drafts
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_template_id uuid;
  v_draft public.coach_workout_drafts;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if not public.coaches_athlete(p_organization_id, p_athlete_user_id) then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;
  if p_workout_id is null or length(btrim(p_workout_id)) = 0 then
    raise exception 'workout id required' using errcode = 'invalid_parameter_value';
  end if;
  if p_kind not in ('strength', 'conditioning') then
    raise exception 'invalid kind' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_typeof(p_body) is distinct from 'object' then
    raise exception 'invalid body' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_draft from public.coach_workout_drafts
   where organization_id = p_organization_id
     and athlete_user_id = p_athlete_user_id
     and workout_id = p_workout_id;

  if found then
    -- `kind` is fixed at creation: it is what governs which engine (strength
    -- or conditioning) the body's blocks belong to, so changing it is a
    -- different workout, not a further edit of this one.
    if v_draft.kind is distinct from p_kind then
      raise exception 'a draft cannot change kind once created' using errcode = 'invalid_parameter_value';
    end if;
    if p_base_version is null or v_draft.base_version <> p_base_version then
      raise exception 'stale draft version' using errcode = 'serialization_failure';
    end if;
    update public.coach_workout_drafts
       set body = p_body, base_version = base_version + 1,
           updated_at = now(), updated_by = v_actor
     where id = v_draft.id
    returning * into v_draft;
    return v_draft;
  end if;

  -- First save. A caller that believes a version already exists cannot be
  -- creating the first one.
  if p_base_version is not null then
    raise exception 'stale draft version' using errcode = 'serialization_failure';
  end if;

  -- The private, single-athlete template is created lazily. Only this
  -- function ever sets `athlete_user_id` on program_templates, and
  -- `coaches_athlete` has already been proven true above, so the template is
  -- guaranteed to belong to an athlete really coached in this organisation.
  -- No CHECK constraint expresses this — Postgres forbids a subquery inside
  -- one, the exact reason `program_assignment_weekdays` uses array
  -- containment instead. This is the write path, and it is the only one.
  insert into public.program_templates (
    organization_id, domain, name, athlete_user_id, created_by, status
  ) values (
    p_organization_id, p_kind, 'Coach-authored workout', p_athlete_user_id, v_actor, 'draft'
  ) returning id into v_template_id;

  -- ON CONFLICT, not check-then-insert: two concurrent first saves for the
  -- same (organisation, athlete, workout_id) must not each believe they won
  -- and create two private templates for one client-side Workout.
  insert into public.coach_workout_drafts (
    organization_id, athlete_user_id, coach_user_id, workout_id, template_id,
    kind, body, base_version, updated_by
  ) values (
    p_organization_id, p_athlete_user_id, v_actor, p_workout_id, v_template_id,
    p_kind, p_body, 0, v_actor
  )
  on conflict (organization_id, athlete_user_id, workout_id) do nothing
  returning * into v_draft;

  if v_draft.id is not null then
    return v_draft;
  end if;

  -- Lost the race: a concurrent first save already created the draft. Remove
  -- the template this call just inserted rather than leaving a dead private
  -- template behind, then report the same conflict any other losing caller
  -- of an optimistic-concurrency write in this system gets.
  delete from public.program_templates where id = v_template_id;
  raise exception 'stale draft version' using errcode = 'serialization_failure';
end;
$$;

revoke all on function public.save_workout_draft(uuid, uuid, text, text, jsonb, integer) from public, anon;
grant execute on function public.save_workout_draft(uuid, uuid, text, text, jsonb, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. get_athlete_workout_library — a thin, stable read wrapper. The table's
-- own RLS already authorizes a direct select; this exists so the read
-- contract is one canonical, versioned surface, matching
-- get_athlete_training_summary rather than leaving every caller to
-- reconstruct the same filter.
-- ---------------------------------------------------------------------------

create or replace function public.get_athlete_workout_library(
  p_organization_id uuid,
  p_athlete_user_id uuid
)
returns setof public.coach_workout_drafts
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if not public.coaches_athlete(p_organization_id, p_athlete_user_id) then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  return query
  select * from public.coach_workout_drafts
   where organization_id = p_organization_id and athlete_user_id = p_athlete_user_id
   order by updated_at desc;
end;
$$;

revoke all on function public.get_athlete_workout_library(uuid, uuid) from public, anon;
grant execute on function public.get_athlete_workout_library(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. publish_workout_draft — the ONLY path from a mutable draft to an
-- immutable, assignable, audited program. It snapshots the draft into a new
-- program_template_versions row, then calls the existing, unmodified-in-
-- signature create_program_assignment in the same transaction. It writes NO
-- second audit trail — the assignment IS the record, exactly as it already
-- is for a coach assigning a shared, organisation-wide template.
-- ---------------------------------------------------------------------------

create or replace function public.publish_workout_draft(
  p_organization_id uuid,
  p_athlete_user_id uuid,
  p_workout_id text,
  p_base_version integer,
  p_preferred_start_date date,
  p_preferred_weekdays smallint[],
  p_idempotency_key text
)
returns public.program_assignments
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_draft public.coach_workout_drafts;
  v_existing_decision public.coach_decisions;
  v_existing_assignment public.program_assignments;
  v_next_version integer;
  v_version_id uuid;
  v_assignment public.program_assignments;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if not public.coaches_athlete(p_organization_id, p_athlete_user_id) then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'idempotency key required' using errcode = 'invalid_parameter_value';
  end if;

  -- Checked here, not left to create_program_assignment's own replay guard
  -- alone: without this, a retry after a dropped connection would still mint
  -- a fresh, unused program_template_versions row on every attempt before
  -- ever reaching that guard. Checking first makes a retry a true no-op.
  select * into v_existing_decision from public.coach_decisions
   where organization_id = p_organization_id
     and athlete_user_id = p_athlete_user_id
     and kind = 'assignment_created'
     and idempotency_key = p_idempotency_key;
  if found then
    select * into v_existing_assignment from public.program_assignments
     where id = (v_existing_decision.payload ->> 'assignment_id')::uuid
       and organization_id = p_organization_id
       and athlete_user_id = p_athlete_user_id;
    if v_existing_assignment is null then
      raise exception 'not permitted' using errcode = 'insufficient_privilege';
    end if;
    return v_existing_assignment;
  end if;

  select * into v_draft from public.coach_workout_drafts
   where organization_id = p_organization_id
     and athlete_user_id = p_athlete_user_id
     and workout_id = p_workout_id;
  if not found then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;
  if v_draft.base_version <> p_base_version then
    raise exception 'stale draft version' using errcode = 'serialization_failure';
  end if;

  -- One-off dated workouts have no home in program_assignments, which models
  -- a single start date plus a recurring weekday set only. CoachAuthoring
  -- genuinely produces this shape (Workout.dates) — reject rather than
  -- silently drop real coach intent.
  if v_draft.body ? 'dates'
     and jsonb_typeof(v_draft.body -> 'dates') = 'array'
     and jsonb_array_length(v_draft.body -> 'dates') > 0 then
    raise exception 'one-off dated workouts cannot be published; use a recurring weekday schedule' using errcode = 'invalid_parameter_value';
  end if;

  select coalesce(max(version), 0) + 1 into v_next_version
    from public.program_template_versions where template_id = v_draft.template_id;

  insert into public.program_template_versions (template_id, version, body, published_by)
  values (v_draft.template_id, v_next_version, v_draft.body, v_actor)
  returning id into v_version_id;

  update public.program_templates set status = 'published', updated_at = now()
   where id = v_draft.template_id;

  -- create_program_assignment re-checks coaches_athlete() and the
  -- organisation+athlete ownership of the version itself — belt-and-braces,
  -- not redundant: it is a SECURITY DEFINER function called from another,
  -- and it must hold on its own regardless of what its caller already
  -- checked.
  v_assignment := public.create_program_assignment(
    p_organization_id, p_athlete_user_id, v_version_id,
    p_preferred_start_date, p_preferred_weekdays, p_idempotency_key
  );

  return v_assignment;
end;
$$;

revoke all on function public.publish_workout_draft(uuid, uuid, text, integer, date, smallint[], text) from public, anon;
grant execute on function public.publish_workout_draft(uuid, uuid, text, integer, date, smallint[], text) to authenticated;

-- Rollback, for the staging rehearsal this repository requires before any
-- release. Order matters: dependants first. `create_program_assignment`'s
-- amendment (§4) is NOT reversible by a drop — reverting it means
-- re-deploying 20260808_arc_coach_workspace.sql's original function body.
--
--   drop function if exists public.publish_workout_draft(uuid, uuid, text, integer, date, smallint[], text);
--   drop function if exists public.get_athlete_workout_library(uuid, uuid);
--   drop function if exists public.save_workout_draft(uuid, uuid, text, text, jsonb, integer);
--   drop table if exists public.coach_workout_drafts;
--   drop function if exists public.can_read_program_template(uuid, uuid);
--   alter table public.program_templates drop column if exists athlete_user_id;
