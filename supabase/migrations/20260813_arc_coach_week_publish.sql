-- ============================================================================
-- ARC — a coach authors a week, and publishes it as the athlete's week
--
-- WHAT THIS CHANGES, STATED PLAINLY AT THE TOP
--
-- Since 20260804_fitness_ecosystem_contracts.sql, exactly one component has
-- been allowed to decide an athlete's week, and it was not a convention — it
-- was a constraint:
--
--     constraint athlete_plan_writer check (writer = 'coordinator')
--
-- The database physically refused a weekly plan written by anything else, and
-- `publish_athlete_weekly_plan` writes against `auth.uid()`, so even that path
-- could only ever be the athlete's own device writing its own week.
--
-- The owner decided on 13 August 2026 that a coach's published week wins
-- outright for a coached athlete. This migration is where that becomes true.
-- The constraint widens to `in ('coordinator', 'coach')` and a new command
-- lets a coach write into an athlete's row — the only cross-user write in the
-- ecosystem tables, and the reason every check below is where it is.
--
-- WHAT IT DOES NOT CHANGE
--
-- The per-session safety layer. `@hybrid/auto-coach` applies whole-athlete
-- constraints to ONE session and never programs a week; taking the WEEK from
-- the Coordinator does not take the SESSION from the safety resolver. A pain
-- or illness flag still holds a coach's session, and the coach is told. That
-- is a different layer at a different granularity, and it is deliberately
-- untouched here — removing it was not asked for and would be an injury
-- safety change wearing a scheduling change's clothes.
--
-- A self-coached athlete is entirely unaffected. No coach, no coach row, and
-- `publish_athlete_weekly_plan` behaves exactly as it always has.
--
-- TWO CORRECTIONS TO THE DESIGN DOC, FOUND BY READING THE SCHEMA
--
-- docs/superpowers/specs/2026-08-13-coach-publishes-the-week-design.md says a
-- coordinator-written row "is not deleted, it stays as the fallback". It
-- cannot: `athlete_weekly_plans` is keyed `primary key (user_id, week_start)`,
-- so there is one row per athlete per week and a coach publish REPLACES it.
--
-- That turns out to be the better model rather than a compromise. The stored
-- row is a published artefact, not the source: the Coordinator computes the
-- week ON DEVICE from proposals, locally and offline. So an athlete who leaves
-- a roster loses nothing — their device regenerates the week on the next
-- reconcile. The fallback was never the row. The fallback is the Coordinator.
--
-- The doc also did not mention `revision`. It is load-bearing: the existing
-- upsert only wins `where revision < excluded.revision`, so a coach publish
-- that does not clear the row's current revision is silently DISCARDED — the
-- write returns, nothing changes, and the coach is told it worked. The command
-- below reads the current revision and steps past it, inside the same
-- transaction and behind a row lock.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The constraint that made this impossible.
--
-- Dropped and re-added rather than altered, because a check constraint cannot
-- be widened in place. Existing rows all carry 'coordinator' and satisfy the
-- new predicate, so this does not rewrite data.
-- ---------------------------------------------------------------------------
alter table public.athlete_weekly_plans
  drop constraint if exists athlete_plan_writer;

alter table public.athlete_weekly_plans
  add constraint athlete_plan_writer check (writer in ('coordinator', 'coach'));

comment on constraint athlete_plan_writer on public.athlete_weekly_plans is
  'Who decided this week. ''coordinator'' is the athlete''s own device. ''coach'' '
  'is a week published through publish_coach_week and it wins for as long as it '
  'stands. Widened 13 August 2026; it read (writer = ''coordinator'') from 4 August.';

-- ---------------------------------------------------------------------------
-- 1b. `coach_decisions.kind` is a CLOSED set, and a publish is a new kind.
--
-- Found by the behaviour check rather than by reading: the first publish
-- failed on the constraint, which is exactly what a closed union is for. It
-- widens deliberately here rather than being loosened to free text — the whole
-- value of the set is that a decision kind cannot be invented by a caller.
-- ---------------------------------------------------------------------------
alter table public.coach_decisions
  drop constraint if exists coach_decision_kind;

alter table public.coach_decisions
  add constraint coach_decision_kind check (kind in (
    'assignment_created', 'assignment_updated', 'assignment_accepted',
    'assignment_withdrawn', 'progression_approved', 'progression_declined',
    'template_published', 'week_published'
  ));

-- ---------------------------------------------------------------------------
-- 2. The coach's authored week.
--
-- NOT a program_template. Templates are single-domain, carry a progression
-- model, and are reusable across athletes. A published week is a specific set
-- of dated sessions, for one athlete, mixing both domains, authored once.
--
-- Keyed per ATHLETE rather than per target-that-might-be-a-team. A team
-- publish will fan out into one row per member, because divergence is the
-- normal case — one athlete is injured in week 2 and their copy must change
-- without touching anyone else's. A shared row would have to be split the
-- first time it was used.
-- ---------------------------------------------------------------------------
create table if not exists public.coach_week_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  coach_user_id uuid not null references auth.users(id) on delete cascade,
  athlete_user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coach_week_plan_status check (status in ('draft', 'published')),
  -- Monday. Enforced rather than trusted: a week keyed on an arbitrary day
  -- would let two "weeks" overlap and both claim the same dates.
  constraint coach_week_plan_monday check (extract(isodow from week_start) = 1),
  constraint coach_week_plan_unique unique (organization_id, athlete_user_id, week_start)
);

-- ---------------------------------------------------------------------------
-- 3. Immutable versions.
--
-- Versioning is not optional here. A coach edits a published week; the athlete
-- may already have trained Monday off version 1. One immutable row per publish
-- is what makes "what did they actually see" answerable later, and it is the
-- shape program_template_versions already uses.
-- ---------------------------------------------------------------------------
create table if not exists public.coach_week_plan_versions (
  id uuid primary key default gen_random_uuid(),
  week_plan_id uuid not null references public.coach_week_plans(id) on delete cascade,
  version integer not null,
  body jsonb not null,
  published_at timestamptz not null default now(),
  published_by uuid references auth.users(id) on delete set null,
  constraint coach_week_version_positive check (version > 0),
  constraint coach_week_version_object check (jsonb_typeof(body) = 'object'),
  constraint coach_week_version_unique unique (week_plan_id, version)
);

create index if not exists coach_week_plans_by_coach
  on public.coach_week_plans (coach_user_id, week_start desc);
create index if not exists coach_week_plans_by_athlete
  on public.coach_week_plans (athlete_user_id, week_start desc);

-- ---------------------------------------------------------------------------
-- 4. The command.
--
-- One transaction: the version row, the athlete's weekly plan, and the
-- receipt. A coach who sees "published" must be able to trust that the athlete
-- can see it, and three separate writes cannot promise that.
-- ---------------------------------------------------------------------------
create or replace function public.publish_coach_week(
  p_organization_id uuid,
  p_athlete_user_id uuid,
  p_week_start date,
  p_body jsonb,
  p_idempotency_key text,
  p_base_version integer default null
)
returns public.coach_week_plan_versions
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_plan public.coach_week_plans;
  v_version public.coach_week_plan_versions;
  v_next integer;
  v_current integer;
  v_existing public.coach_decisions;
  v_decision_id uuid;
  v_revision bigint;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  -- Same authorisation as every other coach command, and the same deliberately
  -- identical message whether the organisation, the athlete, or the coaching
  -- relationship is what is missing. Distinguishing them lets a caller
  -- enumerate athletes.
  if not public.coaches_athlete(p_organization_id, p_athlete_user_id) then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'idempotency key required' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_typeof(p_body) <> 'object' then
    raise exception 'week body must be a JSON object' using errcode = 'invalid_parameter_value';
  end if;
  if extract(isodow from p_week_start) <> 1 then
    raise exception 'week must start on a Monday' using errcode = 'invalid_parameter_value';
  end if;

  -- A replay returns the ORIGINAL version rather than erroring or publishing
  -- twice. Every parameter of the scope is in the lookup: this function is
  -- SECURITY DEFINER, so no statement here is filtered by RLS, and whatever
  -- the predicate does not say, nothing else says.
  select * into v_existing from public.coach_decisions
   where organization_id = p_organization_id
     and athlete_user_id = p_athlete_user_id
     and kind = 'week_published'
     and idempotency_key = p_idempotency_key;
  if found then
    select v.* into v_version from public.coach_week_plan_versions v
      join public.coach_week_plans p on p.id = v.week_plan_id
     where v.id = (v_existing.payload ->> 'version_id')::uuid
       and p.organization_id = p_organization_id
       and p.athlete_user_id = p_athlete_user_id;
    if v_version is null then
      -- The receipt names a version we are not entitled to return. Returning
      -- null would surface client-side as a success with no row, which is how
      -- a write that never happened gets reported as one.
      raise exception 'not permitted' using errcode = 'insufficient_privilege';
    end if;
    return v_version;
  end if;

  insert into public.coach_week_plans (organization_id, coach_user_id, athlete_user_id, week_start, status)
    values (p_organization_id, v_actor, p_athlete_user_id, p_week_start, 'published')
  on conflict (organization_id, athlete_user_id, week_start) do update
    set status = 'published', updated_at = now()
  returning * into v_plan;

  -- Serialise concurrent publishes to the same week. Without this, two coaches
  -- both read version 3 and both try to write version 4.
  select * into v_plan from public.coach_week_plans where id = v_plan.id for update;

  select coalesce(max(version), 0) into v_current
    from public.coach_week_plan_versions where week_plan_id = v_plan.id;

  -- Optimistic lock. A caller that supplies the version it believes it is
  -- editing gets a loud refusal rather than silently overwriting a colleague's
  -- newer week. Null opts out, for a first publish or a deliberate force.
  if p_base_version is not null and p_base_version <> v_current then
    raise exception 'week was modified by someone else' using errcode = 'serialization_failure';
  end if;

  v_next := v_current + 1;

  insert into public.coach_week_plan_versions (week_plan_id, version, body, published_by)
    values (v_plan.id, v_next, p_body, v_actor)
  returning * into v_version;

  -- The athlete's own row. THE CROSS-USER WRITE, and the only one in these
  -- tables — which is why every check above had to pass before reaching it.
  --
  -- The revision is read and stepped past rather than supplied. The existing
  -- upsert in publish_athlete_weekly_plan only wins `where revision <
  -- excluded.revision`, so a coach publish carrying a stale or equal revision
  -- would be DISCARDED — the statement succeeds, nothing changes, and the
  -- coach is told it worked. Reading it here, inside this transaction, is what
  -- makes the publish actually land.
  select coalesce(revision, 0) into v_revision
    from public.athlete_weekly_plans
   where user_id = p_athlete_user_id and week_start = p_week_start
     for update;

  insert into public.athlete_weekly_plans (user_id, week_start, schema_version, revision, writer, plan, client_generated_at)
    values (p_athlete_user_id, p_week_start, 1, coalesce(v_revision, 0) + 1, 'coach', p_body, now())
  on conflict (user_id, week_start) do update set
    schema_version = excluded.schema_version,
    revision = excluded.revision,
    writer = 'coach',
    plan = excluded.plan,
    client_generated_at = excluded.client_generated_at,
    updated_at = now();

  insert into public.coach_decisions (organization_id, actor_user_id, athlete_user_id, kind, idempotency_key, base_version, payload)
    values (p_organization_id, v_actor, p_athlete_user_id, 'week_published', p_idempotency_key,
            case when p_base_version is null then null else p_base_version::text end,
            jsonb_build_object(
              'version_id', v_version.id,
              'week_plan_id', v_plan.id,
              'week_start', p_week_start,
              'version', v_next))
  returning id into v_decision_id;

  -- The athlete's own view of what happened. Separate from the decision
  -- payload because the athlete's account of a change is not the coach's
  -- command — and because this is the row their device reads to say "your
  -- coach published your week" rather than silently swapping it underneath
  -- them.
  insert into public.decision_receipts (decision_id, organization_id, athlete_user_id, summary, detail)
    values (v_decision_id, p_organization_id, p_athlete_user_id,
            'Your coach published your week.',
            jsonb_build_object('week_start', p_week_start, 'version', v_next));

  return v_version;
end;
$$;

revoke all on function public.publish_coach_week(uuid, uuid, date, jsonb, text, integer) from public, anon;
grant execute on function public.publish_coach_week(uuid, uuid, date, jsonb, text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. RLS, and explicit revokes on top of it.
--
-- RLS alone is NOT enough for UPDATE and DELETE, and this is the trap the
-- roster-invite migration found the hard way on 13 August: for INSERT a
-- missing policy is a refusal, but for UPDATE and DELETE it is not — RLS
-- FILTERS, so the statement matches zero rows and SUCCEEDS. A client would be
-- told its delete worked. Fail-closed either way, but only the revoke makes
-- the refusal honest.
--
-- Reads are permitted for the two parties who are in the relationship: the
-- coach who wrote it, and the athlete it is about. An athlete being able to
-- read the week that governs their training is not a concession, it is the
-- point.
-- ---------------------------------------------------------------------------
alter table public.coach_week_plans enable row level security;
alter table public.coach_week_plan_versions enable row level security;

drop policy if exists coach_week_plans_read on public.coach_week_plans;
create policy coach_week_plans_read on public.coach_week_plans for select to authenticated
  using (
    athlete_user_id = auth.uid()
    or public.coaches_athlete(organization_id, athlete_user_id)
  );

drop policy if exists coach_week_versions_read on public.coach_week_plan_versions;
create policy coach_week_versions_read on public.coach_week_plan_versions for select to authenticated
  using (exists (
    select 1 from public.coach_week_plans p
     where p.id = coach_week_plan_versions.week_plan_id
       and (p.athlete_user_id = auth.uid()
            or public.coaches_athlete(p.organization_id, p.athlete_user_id))
  ));

revoke all on public.coach_week_plans from anon;
revoke all on public.coach_week_plan_versions from anon;
revoke insert, update, delete on public.coach_week_plans from authenticated;
revoke insert, update, delete on public.coach_week_plan_versions from authenticated;
grant select on public.coach_week_plans to authenticated;
grant select on public.coach_week_plan_versions to authenticated;

comment on table public.coach_week_plans is
  'A coach-authored week for one athlete. Written only by publish_coach_week; no '
  'client role holds INSERT, UPDATE or DELETE.';
comment on table public.coach_week_plan_versions is
  'Immutable snapshot per publish. A coach may edit a published week, and the '
  'athlete may already have trained off an earlier version — this is what makes '
  '"what did they actually see" answerable.';

-- ---------------------------------------------------------------------------
-- ROLLBACK
--
-- Note the ORDER and the caveat. Narrowing the writer constraint back will
-- FAIL while any coach-written row exists, which is correct — it refuses
-- rather than silently discarding a published week. Clear those rows first,
-- deliberately, knowing each athlete's device regenerates its own week on the
-- next reconcile.
--
--   drop function if exists public.publish_coach_week(uuid, uuid, date, jsonb, text, integer);
--   drop table if exists public.coach_week_plan_versions;
--   drop table if exists public.coach_week_plans;
--   -- then, only when no coach-written weeks remain:
--   -- delete from public.athlete_weekly_plans where writer = 'coach';
--   alter table public.athlete_weekly_plans drop constraint if exists athlete_plan_writer;
--   alter table public.athlete_weekly_plans
--     add constraint athlete_plan_writer check (writer = 'coordinator');
-- ---------------------------------------------------------------------------
