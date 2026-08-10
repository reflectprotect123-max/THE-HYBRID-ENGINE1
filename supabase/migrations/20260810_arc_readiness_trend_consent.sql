-- ============================================================================
-- ARC Layer 3 — readiness trend consent
--
-- Extends 20260808_arc_progression_review.sql's athlete_trend_snapshots /
-- push_trend_snapshot / get_athlete_trend_series mechanism (already real,
-- already shipping lift_trend / erg_trend / hard_budget to the coach bench)
-- with a fourth kind: 'readiness_trend' — raw HRV, resting heart rate, sleep
-- performance and strain points, the one tier whole-athlete-state has always
-- deliberately withheld from every reader (see packages/whole-athlete-state:
-- it exposes a derived readiness score/band, never the raw WHOOP series).
--
-- Extending the existing mechanism to carry raw biometrics on the same
-- shelf as lift/erg trends would be wrong without also widening the GATE:
-- lift_trend/erg_trend/hard_budget are training performance data, gated
-- only by coaches_athlete(). Raw HRV/RHR/sleep/strain is exactly the kind
-- of privileged read this codebase already has a pattern for — nutrition's
-- raw-detail tier (nutrition_read_grants: athlete-controlled, revocable,
-- per-coach, every read logged). This migration gives readiness_trend the
-- SAME pattern, reusing the SAME generic coach_read_audit table, rather
-- than inventing a third consent shape.
--
-- Three things change, nothing removed:
--   1. athlete_trend_snapshots' kind constraint widens to allow
--      'readiness_trend' (same idempotent drop/re-add idiom as
--      20260807_nutrition_domain.sql's domain-constraint widening).
--   2. athlete_trend_snapshots' RLS read policy gains a readiness_trend-only
--      branch requiring an unrevoked readiness_read_grants row — every
--      other kind's read path is byte-for-byte unchanged.
--   3. push_trend_snapshot and get_athlete_trend_series are replaced with
--      versions that accept the new kind; get_athlete_trend_series also now
--      checks the grant and logs to coach_read_audit, but ONLY when
--      p_kind = 'readiness_trend' — lift_trend/erg_trend/hard_budget keep
--      their original, ungated, unlogged behavior exactly as it ships today.
--
-- Nothing here touches pain/illness safety flags or lets HRV act as a
-- gate on anything — this is a read path for a coach's OWN dashboard
-- tile, subject to the athlete's own consent, same boundary nutrition
-- already draws.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Widen the kind constraint.
-- ---------------------------------------------------------------------------

alter table public.athlete_trend_snapshots
  drop constraint if exists trend_snapshot_kind;

alter table public.athlete_trend_snapshots
  add constraint trend_snapshot_kind
  check (kind in ('lift_trend', 'erg_trend', 'hard_budget', 'readiness_trend'));

-- ---------------------------------------------------------------------------
-- 2. readiness_read_grants — same shape as nutrition_read_grants: one row
-- per (organisation, athlete, coach), revoked_at alone is the source of
-- truth, no separate status column to disagree with it.
-- ---------------------------------------------------------------------------

create table if not exists public.readiness_read_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  athlete_user_id uuid not null references auth.users(id) on delete cascade,
  granted_to uuid not null references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (organization_id, athlete_user_id, granted_to)
);

alter table public.readiness_read_grants enable row level security;

drop policy if exists readiness_read_grants_read on public.readiness_read_grants;
create policy readiness_read_grants_read on public.readiness_read_grants for select to authenticated
  using (
    athlete_user_id = auth.uid()
    or granted_to = auth.uid()
    or public.is_org_member(organization_id, array['owner'])
  );

revoke all on public.readiness_read_grants from anon;
grant select on public.readiness_read_grants to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Re-gate athlete_trend_snapshots' read policy: readiness_trend rows
-- additionally require an unrevoked grant; every other kind is byte-for-byte
-- the same condition it has always had.
-- ---------------------------------------------------------------------------

drop policy if exists trend_snapshots_read on public.athlete_trend_snapshots;
create policy trend_snapshots_read on public.athlete_trend_snapshots for select to authenticated
  using (
    athlete_user_id = auth.uid()
    or public.is_org_member(organization_id, array['owner'])
    or (
      public.coaches_athlete(organization_id, athlete_user_id)
      and (
        kind <> 'readiness_trend'
        or exists (
          select 1 from public.readiness_read_grants g
           where g.organization_id = athlete_trend_snapshots.organization_id
             and g.athlete_user_id = athlete_trend_snapshots.athlete_user_id
             and g.granted_to = auth.uid()
             and g.revoked_at is null
        )
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 4. set_readiness_read_grant — the athlete's own toggle, same
-- coach_athlete_assignments/organization_memberships shape as
-- set_nutrition_read_grant (the CALLER is the athlete here, checking
-- someone else coaches them — the asymmetric inline join is intentional,
-- see that function's own comment in 20260808_arc_progression_review.sql).
-- ---------------------------------------------------------------------------

create or replace function public.set_readiness_read_grant(
  p_organization_id uuid,
  p_granted_to uuid,
  p_grant boolean
)
returns public.readiness_read_grants
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_row public.readiness_read_grants;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if not public.is_org_member(p_organization_id, array['athlete']) then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;
  if not exists (
    select 1
    from public.coach_athlete_assignments a
    join public.organization_memberships mc
      on mc.organization_id = a.organization_id and mc.user_id = a.coach_user_id
    join public.organization_memberships ma
      on ma.organization_id = a.organization_id and ma.user_id = a.athlete_user_id
    where a.organization_id = p_organization_id
      and a.coach_user_id = p_granted_to
      and a.athlete_user_id = v_actor
      and a.status = 'active'
      and mc.status = 'active' and mc.role in ('owner', 'coach')
      and ma.status = 'active'
  ) then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  insert into public.readiness_read_grants (organization_id, athlete_user_id, granted_to, revoked_at)
  values (p_organization_id, v_actor, p_granted_to, case when p_grant then null else now() end)
  on conflict (organization_id, athlete_user_id, granted_to)
  do update set revoked_at = case when p_grant then null else now() end
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.set_readiness_read_grant(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_readiness_read_grant(uuid, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. push_trend_snapshot — widen the kind check only. Everything else is
-- the original 20260808 body, unchanged.
-- ---------------------------------------------------------------------------

create or replace function public.push_trend_snapshot(
  p_organization_id uuid,
  p_kind text,
  p_points jsonb,
  p_generated_at timestamptz
)
returns public.athlete_trend_snapshots
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_row public.athlete_trend_snapshots;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if not public.is_org_member(p_organization_id, array['athlete']) then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;
  if p_kind not in ('lift_trend', 'erg_trend', 'hard_budget', 'readiness_trend') then
    raise exception 'invalid kind' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_typeof(p_points) is distinct from 'array' then
    raise exception 'invalid points' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.athlete_trend_snapshots (organization_id, athlete_user_id, kind, points, generated_at)
  values (p_organization_id, v_actor, p_kind, p_points, p_generated_at)
  on conflict (organization_id, athlete_user_id, kind, generated_at)
  do update set points = excluded.points
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.push_trend_snapshot(uuid, text, jsonb, timestamptz) from public, anon;
grant execute on function public.push_trend_snapshot(uuid, text, jsonb, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. get_athlete_trend_series — adds a readiness_trend-only grant check and
-- audit log, in the same transaction as the read (mirrors
-- get_athlete_nutrition_window's own comment: "so the athlete can see
-- exactly when their raw data was read and by whom"). lift_trend / erg_trend
-- / hard_budget keep their original single coaches_athlete() check, no
-- grant, no audit row — unchanged from 20260808's shipped behavior.
-- ---------------------------------------------------------------------------

create or replace function public.get_athlete_trend_series(
  p_organization_id uuid,
  p_athlete_user_id uuid,
  p_kind text
)
returns public.athlete_trend_snapshots
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_row public.athlete_trend_snapshots;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if not public.coaches_athlete(p_organization_id, p_athlete_user_id) then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;
  if p_kind = 'readiness_trend' and not exists (
    select 1 from public.readiness_read_grants
     where organization_id = p_organization_id
       and athlete_user_id = p_athlete_user_id
       and granted_to = v_actor
       and revoked_at is null
  ) then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  select * into v_row from public.athlete_trend_snapshots
   where organization_id = p_organization_id
     and athlete_user_id = p_athlete_user_id
     and kind = p_kind
   order by generated_at desc
   limit 1;

  if p_kind = 'readiness_trend' then
    insert into public.coach_read_audit (organization_id, coach_user_id, athlete_user_id, rpc_name)
    values (p_organization_id, v_actor, p_athlete_user_id, 'get_athlete_trend_series:readiness_trend');
  end if;

  return v_row;
end;
$$;

revoke all on function public.get_athlete_trend_series(uuid, uuid, text) from public, anon;
grant execute on function public.get_athlete_trend_series(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Rollback (manual, not run automatically):
--
--   drop function if exists public.get_athlete_trend_series(uuid, uuid, text);
--   drop function if exists public.push_trend_snapshot(uuid, text, jsonb, timestamptz);
--   drop function if exists public.set_readiness_read_grant(uuid, uuid, boolean);
--   drop policy if exists trend_snapshots_read on public.athlete_trend_snapshots;
--   -- re-apply 20260808_arc_progression_review.sql's original
--   -- push_trend_snapshot / get_athlete_trend_series / trend_snapshots_read
--   -- bodies (kind check without 'readiness_trend') before running:
--   alter table public.athlete_trend_snapshots drop constraint if exists trend_snapshot_kind;
--   alter table public.athlete_trend_snapshots
--     add constraint trend_snapshot_kind check (kind in ('lift_trend', 'erg_trend', 'hard_budget'));
--   drop table if exists public.readiness_read_grants;
-- ============================================================================
