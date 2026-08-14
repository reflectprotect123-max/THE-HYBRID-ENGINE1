-- ============================================================================
-- ARC — two repairs to the coach-published week
--
-- Both were found by an adversarial review of the 14 August branch, both are
-- small, and both are in the path an owner publishing their own week actually
-- walks. Neither changes any table's shape.
--
-- They are in ONE migration because they are the same feature and would
-- otherwise be two files applied minutes apart; they are described separately
-- below because they are unrelated faults.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. A DEVICE WRITE COULD SILENTLY REPLACE A COACH'S WEEK.
--
-- `athlete_plan_writer` was widened on 13 August from `check (writer =
-- 'coordinator')` to `in ('coordinator', 'coach')`, and `publish_coach_week`
-- was carefully taught to step PAST the current revision so a coach publish
-- cannot be discarded as stale.
--
-- The reverse was never closed. `publish_athlete_weekly_plan` — the athlete's
-- own device path, applied 4 August — upserts with `writer = 'coordinator'`
-- and NO writer predicate:
--
--     on conflict (user_id, week_start) do update set … writer = 'coordinator', …
--     where public.athlete_weekly_plans.revision < excluded.revision
--        or (…equal revision and newer timestamp…)
--
-- So any call carrying a revision above the coach's replaces the coach's week,
-- stamps it 'coordinator', and returns true. The coach is never told. Their
-- week simply stops being the athlete's week.
--
-- WHY IT NEVER FIRED, AND WHY IT IS STILL WORTH CLOSING.
--
-- No client has ever called this function — `git grep publish_athlete_weekly_plan`
-- over `apps/` and `packages/` returns nothing, at any commit. The comments
-- around it claimed otherwise ("the athlete's own device was the only thing
-- that could write a week"), and those comments were wrong rather than
-- describing something since removed. So this is latent by accident.
--
-- And the Coordinator was deleted on 14 August 2026, which makes it worse
-- rather than better: the only layer that would ever have had a legitimate
-- reason to write a coordinator week is gone, so a future call to this
-- function is now MORE likely to be a mistake than a design. Closing it costs
-- nothing and removes a loaded gun pointed at the one invariant the coach-week
-- feature bought.
--
-- The refusal is deliberately SILENT — it returns false rather than raising.
-- The function's contract is "true if I changed the row", every existing
-- caller-shaped path already handles false (a stale revision has always
-- returned false), and raising would turn a no-op into an error for a client
-- that has done nothing wrong. A caller that wants to know can read the row.
-- ---------------------------------------------------------------------------
create or replace function public.publish_athlete_weekly_plan(
  p_week_start date,
  p_schema_version integer,
  p_revision bigint,
  p_client_generated_at timestamptz,
  p_plan jsonb
)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_changed boolean := false; v_rows integer;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if jsonb_typeof(p_plan) <> 'object' then raise exception 'plan must be a JSON object'; end if;
  insert into public.athlete_weekly_plans(user_id, week_start, schema_version, revision, writer, plan, client_generated_at)
    values (v_uid, p_week_start, p_schema_version, p_revision, 'coordinator', p_plan, p_client_generated_at)
  on conflict (user_id, week_start) do update set
    schema_version = excluded.schema_version,
    revision = excluded.revision,
    writer = 'coordinator',
    plan = excluded.plan,
    client_generated_at = excluded.client_generated_at
  -- THE NEW CLAUSE. A coach owns the week they published; a device write does
  -- not get to take it, at any revision. Everything after it is 20260804's
  -- original staleness rule, unchanged.
  where public.athlete_weekly_plans.writer <> 'coach'
    and (public.athlete_weekly_plans.revision < excluded.revision
         or (public.athlete_weekly_plans.revision = excluded.revision
             and coalesce(public.athlete_weekly_plans.client_generated_at, '-infinity'::timestamptz)
                 <= coalesce(excluded.client_generated_at, '-infinity'::timestamptz)));
  get diagnostics v_rows = row_count;
  v_changed := v_rows > 0;
  return v_changed;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. THE ATHLETE WAS TOLD THE WRONG COACH PUBLISHED THEIR WEEK.
--
-- `coach_week_plans` is unique on `(organization_id, athlete_user_id,
-- week_start)` — NOT coach-scoped, deliberately, because one athlete has one
-- week per organisation. But `coach_user_id` was written on INSERT only:
--
--     on conflict (organization_id, athlete_user_id, week_start) do update
--       set status = 'published', updated_at = now()      -- coach_user_id untouched
--
-- So when a second coach in the same organisation republishes that athlete's
-- week — a colleague covering, a handover, the ordinary case a shared roster
-- exists for — the BODY becomes theirs and the attribution stays with whoever
-- published first.
--
-- `readCoachWeekAttribution` on the phone reads exactly that column, and
-- `arc-coach-week.ts` states the purpose plainly: "who put this session in my
-- week is the one thing an athlete should be able to check". A confidently
-- wrong name is worse than the null that module works hard to preserve
-- elsewhere — a null reads as "your coach", which is true.
--
-- The fix is one line. `v_actor` is the coach who is publishing NOW, and the
-- version row (`coach_week_plan_versions.published_by`) already records them
-- correctly, so this brings the two into agreement rather than inventing a
-- new source of truth.
--
-- Reproduced whole because Postgres cannot patch a function body. Diff it
-- against 20260813_arc_coach_week_publish.sql: `set coach_user_id = v_actor,`
-- is the only line added, and nothing else is touched.
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
    -- `coach_user_id = v_actor` ADDED 14 August 2026, and it is the only line
    -- in this body that differs from 20260813's. Without it the column was
    -- written on INSERT only, so a second coach republishing an athlete's week
    -- replaced the BODY and left the attribution with whoever published first.
    -- `coach_week_plan_versions.published_by` already recorded the right coach;
    -- this makes the two agree.
    set coach_user_id = v_actor, status = 'published', updated_at = now()
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
-- ROLLBACK
--
-- Both are function bodies, so rolling back means re-applying the previous
-- versions verbatim:
--
--   * `publish_athlete_weekly_plan` from 20260804_fitness_ecosystem_contracts.sql
--     (drop the `writer <> 'coach' and` clause).
--   * `publish_coach_week` from 20260813_arc_coach_week_publish.sql
--     (drop `set coach_user_id = v_actor,`).
--
-- Neither touches data, so nothing needs unwinding first. Note that rolling
-- back #2 does NOT restore wrong attributions already corrected — rows
-- republished after this lands carry the correct coach, which is the point.
-- ---------------------------------------------------------------------------
