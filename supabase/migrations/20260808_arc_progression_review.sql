-- ---------------------------------------------------------------------------
-- ARC coach workspace — progression proposals, athlete trends, nutrition
-- review, and the read-only week/session projections.
--
-- Builds docs/ARC_LAYER3_DESIGN.md §§1-5: everything except
-- get_athlete_workout_library (§6, already built in
-- 20260808_arc_workout_library.sql). Every design-stage critique finding in
-- §4 is fixed here, not deferred:
--
--   1. push_progression_proposal / push_trend_snapshot are SECURITY DEFINER
--      commands, never a bare "auth.uid() = athlete_user_id" RLS INSERT
--      policy -- nothing stops an athlete device claiming an organisation it
--      is not enrolled in as 'athlete' except a body check, so that check has
--      to live in a function, not a policy.
--   2. Idempotency on progression_proposal_snapshots is scoped to
--      (organization_id, athlete_user_id, domain, client_key, source_at) --
--      domain included, and client_key is the real progression key
--      (movement/format), never the free-text display `subject`, which a
--      strength and a conditioning proposal could otherwise share.
--   3. progression_proposal_snapshots.id is server-minted
--      (gen_random_uuid()), never trusted from the client. The device's own
--      locally-minted string ids (e.g. `strength:<sessionId>:<moveKey>:<at>`)
--      are not UUIDs and are never written to this column.
--   4. decide_progression_proposal joins progression_proposal_snapshots by
--      (id, organization_id, athlete_user_id) before writing anything, and
--      builds the receipt from THAT row -- never from caller-supplied
--      subject/before/after text.
--   5. progression_proposal_snapshots carries a real `hard boolean not null`
--      column, populated by the device at push time in place of the raw
--      constraint `reason` string -- a coach can be told a proposal is
--      pain/illness-blocked without ever seeing what the athlete reported.
--   6. get_athlete_nutrition_window checks nutrition_read_grants AND
--      coaches_athlete() together, belt-and-braces, the same fix the layer-2
--      review already applied to coaches_athlete() itself. Neither check
--      alone is sufficient.
--
-- Sign-off 8 (docs/ARC_LAYER3_DESIGN.md §5) is closed by inspection, recorded
-- here rather than left implicit: `PlanDecision.explanation` in
-- packages/coordinator/src/coordinator.ts is fixed, static prose per reason
-- code ("Pain hold is active; this higher-risk proposal requires
-- modification..."), never interpolated with the athlete's own free-text
-- input. get_athlete_week_plan passes `decisions` through unfiltered because
-- it is already safe -- it discloses no more than `has_safety_flag` already
-- does, in the same coarse shape sign-off 3 chose for progression.
--
-- Sign-offs 3, 4, 5, 7 (progression sanitisation is hard:boolean;
-- SessionDrawer is read-only in v1; trend snapshots are push-on-open only;
-- nothing here is pruned) are built to their stated defaults, per
-- docs/ARC_LAYER3_DESIGN.md §5.
--
-- Same hard rules as every other migration in this system: no client role
-- holds INSERT on anything here; every write is a SECURITY DEFINER command
-- that derives the actor from auth.uid() and checks authorization as its
-- first statement; no table here carries FORCE ROW LEVEL SECURITY, for the
-- reason recorded in docs/RISK_REGISTER.md.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. progression_proposal_snapshots — the athlete's device pushes a frozen
-- copy of a proposal it already computed. The math stays client-side,
-- forever; this table is read-only review material for a coach.
-- ---------------------------------------------------------------------------

create table if not exists public.progression_proposal_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  athlete_user_id uuid not null references auth.users(id) on delete cascade,
  domain text not null,
  -- Display string only -- NOT part of the idempotency key. `client_key` is
  -- the real progression key (the movement or conditioning format identity)
  -- and is what actually discriminates one proposal from another.
  subject text not null,
  client_key text not null,
  before jsonb,
  after jsonb not null,
  confidence text not null,
  -- The sanitised safety signal, in place of the raw constraint `reason`
  -- string. A coach learns a proposal is pain/illness-blocked; they do not
  -- learn what the athlete reported -- the same boundary `has_safety_flag`
  -- already draws for the training summary.
  hard boolean not null default false,
  direction text not null,
  rule_set_version text not null default 'v1',
  source_at timestamptz not null,
  created_at timestamptz not null default now(),
  status text not null default 'pending',
  constraint progression_proposal_domain check (domain in ('strength', 'conditioning')),
  constraint progression_proposal_confidence check (confidence in ('low', 'medium', 'high')),
  constraint progression_proposal_direction check (direction in ('increase', 'hold', 'decrease', 'review')),
  constraint progression_proposal_status check (status in ('pending', 'approved', 'declined')),
  constraint progression_proposal_before_object check (before is null or jsonb_typeof(before) = 'object'),
  constraint progression_proposal_after_object check (jsonb_typeof(after) = 'object'),
  -- domain in the key: a strength and a conditioning proposal from the same
  -- athlete can share a client_key and a source_at (both are session-level
  -- timestamps in the real client code) without this.
  unique (organization_id, athlete_user_id, domain, client_key, source_at)
);

create index if not exists progression_proposals_athlete_idx
  on public.progression_proposal_snapshots (organization_id, athlete_user_id, status);

alter table public.progression_proposal_snapshots enable row level security;

drop policy if exists progression_proposals_read on public.progression_proposal_snapshots;
create policy progression_proposals_read on public.progression_proposal_snapshots for select to authenticated
  using (
    athlete_user_id = auth.uid()
    or public.coaches_athlete(organization_id, athlete_user_id)
    or public.is_org_member(organization_id, array['owner'])
  );

-- No INSERT/UPDATE/DELETE policy. push_progression_proposal and
-- decide_progression_proposal are the only write paths, both SECURITY
-- DEFINER, both running as the table owner.

revoke all on public.progression_proposal_snapshots from anon;
grant select on public.progression_proposal_snapshots to authenticated;

-- ---------------------------------------------------------------------------
-- 2. athlete_trend_snapshots — pre-reduced trend series (top-K e1RM, one erg
-- series, hard-session budget). The engine already reduced these client-side;
-- this is the OUTPUT only, opaque jsonb, no math in SQL.
-- ---------------------------------------------------------------------------

create table if not exists public.athlete_trend_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  athlete_user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  points jsonb not null default '[]'::jsonb,
  generated_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint trend_snapshot_kind check (kind in ('lift_trend', 'erg_trend', 'hard_budget')),
  constraint trend_snapshot_points_array check (jsonb_typeof(points) = 'array'),
  unique (organization_id, athlete_user_id, kind, generated_at)
);

create index if not exists trend_snapshots_athlete_kind_idx
  on public.athlete_trend_snapshots (organization_id, athlete_user_id, kind, generated_at desc);

alter table public.athlete_trend_snapshots enable row level security;

drop policy if exists trend_snapshots_read on public.athlete_trend_snapshots;
create policy trend_snapshots_read on public.athlete_trend_snapshots for select to authenticated
  using (
    athlete_user_id = auth.uid()
    or public.coaches_athlete(organization_id, athlete_user_id)
    or public.is_org_member(organization_id, array['owner'])
  );

revoke all on public.athlete_trend_snapshots from anon;
grant select on public.athlete_trend_snapshots to authenticated;

-- ---------------------------------------------------------------------------
-- 3. nutrition_read_grants — athlete-controlled, revocable, per-coach
-- consent for the raw nutrition detail tier. One row per (organisation,
-- athlete, coach); `revoked_at` alone is the source of truth, toggled by
-- set_nutrition_read_grant. There is no separate `status` column to disagree
-- with it, so the layer-2 "decorative revoked_at" bug class does not recur
-- here -- there is nothing else for it to disagree with.
-- ---------------------------------------------------------------------------

create table if not exists public.nutrition_read_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  athlete_user_id uuid not null references auth.users(id) on delete cascade,
  granted_to uuid not null references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (organization_id, athlete_user_id, granted_to)
);

alter table public.nutrition_read_grants enable row level security;

drop policy if exists nutrition_read_grants_read on public.nutrition_read_grants;
create policy nutrition_read_grants_read on public.nutrition_read_grants for select to authenticated
  using (
    athlete_user_id = auth.uid()
    or granted_to = auth.uid()
    or public.is_org_member(organization_id, array['owner'])
  );

revoke all on public.nutrition_read_grants from anon;
grant select on public.nutrition_read_grants to authenticated;

-- ---------------------------------------------------------------------------
-- 4. coach_read_audit — an athlete-visible log of privileged READS (the
-- nutrition window, per-session detail). Separate from coach_decisions
-- because a read is not a decision, and it would be dishonest to log it in a
-- table whose whole purpose is auditing changes made TO an athlete's plan.
-- Immutable, same as every other audit table in this system.
-- ---------------------------------------------------------------------------

create table if not exists public.coach_read_audit (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  coach_user_id uuid not null references auth.users(id) on delete restrict,
  athlete_user_id uuid not null references auth.users(id) on delete cascade,
  rpc_name text not null,
  at timestamptz not null default now()
);

create index if not exists coach_read_audit_athlete_idx
  on public.coach_read_audit (athlete_user_id, at desc);

alter table public.coach_read_audit enable row level security;

drop policy if exists coach_read_audit_read on public.coach_read_audit;
create policy coach_read_audit_read on public.coach_read_audit for select to authenticated
  using (
    athlete_user_id = auth.uid()
    or public.coaches_athlete(organization_id, athlete_user_id)
    or public.is_org_member(organization_id, array['owner'])
  );

revoke all on public.coach_read_audit from anon;
grant select on public.coach_read_audit to authenticated;

drop trigger if exists coach_read_audit_immutable on public.coach_read_audit;
create trigger coach_read_audit_immutable
  before update or delete on public.coach_read_audit
  for each row execute function public.deny_mutation();

drop trigger if exists coach_read_audit_no_truncate on public.coach_read_audit;
create trigger coach_read_audit_no_truncate
  before truncate on public.coach_read_audit
  for each statement execute function public.deny_truncate();

-- ---------------------------------------------------------------------------
-- 5. push_progression_proposal — the athlete's device is the only writer,
-- and it is always writing ITS OWN proposal: there is no p_athlete_user_id
-- parameter, so there is nothing for a caller to lie about.
-- ---------------------------------------------------------------------------

create or replace function public.push_progression_proposal(
  p_organization_id uuid,
  p_domain text,
  p_subject text,
  p_client_key text,
  p_before jsonb,
  p_after jsonb,
  p_confidence text,
  p_hard boolean,
  p_direction text,
  p_source_at timestamptz
)
returns public.progression_proposal_snapshots
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_row public.progression_proposal_snapshots;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if not public.is_org_member(p_organization_id, array['athlete']) then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;
  if p_domain not in ('strength', 'conditioning') then
    raise exception 'invalid domain' using errcode = 'invalid_parameter_value';
  end if;
  if p_client_key is null or length(btrim(p_client_key)) = 0 then
    raise exception 'client key required' using errcode = 'invalid_parameter_value';
  end if;

  -- Idempotent push: a retry after a dropped connection returns the ORIGINAL
  -- row rather than erroring or duplicating. The update is a genuine no-op
  -- (re-assigning the same value) purely so RETURNING has a row to give back
  -- on conflict.
  insert into public.progression_proposal_snapshots (
    organization_id, athlete_user_id, domain, subject, client_key,
    before, after, confidence, hard, direction, source_at
  ) values (
    p_organization_id, v_actor, p_domain, p_subject, p_client_key,
    p_before, p_after, p_confidence, p_hard, p_direction, p_source_at
  )
  on conflict (organization_id, athlete_user_id, domain, client_key, source_at)
  do update set subject = progression_proposal_snapshots.subject
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.push_progression_proposal(uuid, text, text, text, jsonb, jsonb, text, boolean, text, timestamptz) from public, anon;
grant execute on function public.push_progression_proposal(uuid, text, text, text, jsonb, jsonb, text, boolean, text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. get_athlete_progression_proposals — pending proposals for a coach's
-- review. Gated by coaches_athlete alone, the same tier as the training
-- summary counts: no lift number here is more sensitive than what
-- get_athlete_training_summary already discloses.
-- ---------------------------------------------------------------------------

create or replace function public.get_athlete_progression_proposals(
  p_organization_id uuid,
  p_athlete_user_id uuid
)
returns setof public.progression_proposal_snapshots
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if not public.coaches_athlete(p_organization_id, p_athlete_user_id) then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  return query
  select * from public.progression_proposal_snapshots
   where organization_id = p_organization_id
     and athlete_user_id = p_athlete_user_id
     and status = 'pending'
   order by created_at desc;
end;
$$;

revoke all on function public.get_athlete_progression_proposals(uuid, uuid) from public, anon;
grant execute on function public.get_athlete_progression_proposals(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. decide_progression_proposal — the coach's decision. Writes
-- coach_decisions + decision_receipts ONLY, exactly like
-- create_program_assignment; the one additional write is flipping this
-- proposal's own `status`, the single mutable column on an otherwise frozen
-- row. The engine is never told what to compute -- the athlete's device
-- reads the receipt on its own next sync and decides for itself whether the
-- proposal's `before` value still matches its local baseline before ever
-- calling the existing, unmodified applyApprovedProposal().
--
-- `kind` already exists in coach_decisions' enum
-- ('progression_approved'/'progression_declined', from
-- 20260808_arc_coach_workspace.sql) -- no schema change needed there. "Hold"
-- is not a decision in this system: a proposal simply stays `pending` until
-- a coach approves or declines it, a deliberate v1 simplification over the
-- old local-only three-way decision model.
-- ---------------------------------------------------------------------------

create or replace function public.decide_progression_proposal(
  p_organization_id uuid,
  p_athlete_user_id uuid,
  p_proposal_id uuid,
  p_decision text,
  p_idempotency_key text
)
returns public.coach_decisions
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_kind text;
  v_proposal public.progression_proposal_snapshots;
  v_existing public.coach_decisions;
  v_decision public.coach_decisions;
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

  v_kind := case p_decision
    when 'approved' then 'progression_approved'
    when 'declined' then 'progression_declined'
    else null
  end;
  if v_kind is null then
    raise exception 'invalid decision' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_existing from public.coach_decisions
   where organization_id = p_organization_id
     and athlete_user_id = p_athlete_user_id
     and kind = v_kind
     and idempotency_key = p_idempotency_key;
  if found then
    return v_existing;
  end if;

  -- The proposal being decided must actually belong to this (org, athlete),
  -- and the receipt is built from THIS row, never from caller-supplied text
  -- -- a coach's client cannot invent what a proposal said.
  select * into v_proposal from public.progression_proposal_snapshots
   where id = p_proposal_id
     and organization_id = p_organization_id
     and athlete_user_id = p_athlete_user_id;
  if not found then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;
  if v_proposal.status <> 'pending' then
    raise exception 'proposal already decided' using errcode = 'serialization_failure';
  end if;

  update public.progression_proposal_snapshots
     set status = case p_decision when 'approved' then 'approved' else 'declined' end
   where id = v_proposal.id;

  insert into public.coach_decisions (
    organization_id, athlete_user_id, actor_user_id, kind, idempotency_key, payload
  ) values (
    p_organization_id, p_athlete_user_id, v_actor, v_kind, p_idempotency_key,
    jsonb_build_object('proposal_id', v_proposal.id, 'domain', v_proposal.domain, 'subject', v_proposal.subject)
  ) returning * into v_decision;

  insert into public.decision_receipts (
    decision_id, organization_id, athlete_user_id, summary, detail
  ) values (
    v_decision.id, p_organization_id, p_athlete_user_id,
    case p_decision
      when 'approved' then 'A progression was approved.'
      else 'A progression was declined.'
    end,
    jsonb_build_object('proposal_id', v_proposal.id, 'domain', v_proposal.domain, 'subject', v_proposal.subject)
  );

  return v_decision;
end;
$$;

revoke all on function public.decide_progression_proposal(uuid, uuid, uuid, text, text) from public, anon;
grant execute on function public.decide_progression_proposal(uuid, uuid, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. push_trend_snapshot / get_athlete_trend_series — same shape as
-- progression: the device pushes what it already computed; SQL never
-- reduces raw session history into a trend.
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
  if p_kind not in ('lift_trend', 'erg_trend', 'hard_budget') then
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

create or replace function public.get_athlete_trend_series(
  p_organization_id uuid,
  p_athlete_user_id uuid,
  p_kind text
)
returns public.athlete_trend_snapshots
language plpgsql security definer set search_path = public as $$
declare
  v_row public.athlete_trend_snapshots;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if not public.coaches_athlete(p_organization_id, p_athlete_user_id) then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  select * into v_row from public.athlete_trend_snapshots
   where organization_id = p_organization_id
     and athlete_user_id = p_athlete_user_id
     and kind = p_kind
   order by generated_at desc
   limit 1;

  return v_row;
end;
$$;

revoke all on function public.get_athlete_trend_series(uuid, uuid, text) from public, anon;
grant execute on function public.get_athlete_trend_series(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. set_nutrition_read_grant — the athlete's own consent toggle. The
-- grantee must be a coach who really coaches this athlete right now;
-- `coaches_athlete()` cannot be reused directly here because it is
-- asymmetric by design (it always checks auth.uid() AS THE COACH), and here
-- the CALLER is the athlete, checking whether someone ELSE coaches them. The
-- same three-way join is inlined rather than generalising the already
-- security-reviewed coaches_athlete() into something broader.
-- ---------------------------------------------------------------------------

create or replace function public.set_nutrition_read_grant(
  p_organization_id uuid,
  p_granted_to uuid,
  p_grant boolean
)
returns public.nutrition_read_grants
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_row public.nutrition_read_grants;
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

  insert into public.nutrition_read_grants (organization_id, athlete_user_id, granted_to, revoked_at)
  values (p_organization_id, v_actor, p_granted_to, case when p_grant then null else now() end)
  on conflict (organization_id, athlete_user_id, granted_to)
  do update set revoked_at = case when p_grant then null else now() end
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.set_nutrition_read_grant(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_nutrition_read_grant(uuid, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. get_athlete_nutrition_summary — the counts-only tier. No raw macro or
-- weight VALUE crosses here, only a logged/window day count (the same shape
-- as the training summary's completed/planned) and two ALREADY-COMPUTED
-- signals read off the nutrition engine's own output (trend direction from
-- expenditure_estimates.trend_slope_kg_per_week, confidence from the same
-- row's `confidence` column) -- this function does not derive a trend
-- itself, only sign-tests one the engine already computed. Gated by
-- coaches_athlete alone, no consent grant required.
-- ---------------------------------------------------------------------------

create or replace function public.get_athlete_nutrition_summary(
  p_organization_id uuid,
  p_athlete_user_id uuid,
  p_week_start date
)
returns table (
  logged_days integer,
  window_days integer,
  trend_direction text,
  estimate_confidence text
)
language plpgsql security definer set search_path = public as $$
declare
  v_week_end date := p_week_start + 6;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if not public.coaches_athlete(p_organization_id, p_athlete_user_id) then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    (select count(*)::integer from public.daily_log_status
      where user_id = p_athlete_user_id
        and log_date between p_week_start and v_week_end
        and status in ('complete', 'partial', 'fasted')),
    7,
    (select case
       when e.trend_slope_kg_per_week > 0.05 then 'gaining'
       when e.trend_slope_kg_per_week < -0.05 then 'losing'
       else 'stable'
     end
     from public.expenditure_estimates e
     where e.user_id = p_athlete_user_id
     order by e.created_at desc limit 1),
    (select e.confidence from public.expenditure_estimates e
      where e.user_id = p_athlete_user_id
      order by e.created_at desc limit 1);
end;
$$;

revoke all on function public.get_athlete_nutrition_summary(uuid, uuid, date) from public, anon;
grant execute on function public.get_athlete_nutrition_summary(uuid, uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. get_athlete_nutrition_window — the raw-detail tier. Requires BOTH
-- coaches_athlete() AND an unrevoked nutrition_read_grants row for THIS
-- coach, checked together -- finding 6. Every call is logged to
-- coach_read_audit in the same transaction as the read, so the athlete can
-- see exactly when their raw data was read and by whom. No individual
-- food_log_entries row is exposed (barcode-level detail is explicitly out of
-- scope per docs/ARC_CLAUDE_HANDOFF.md) -- only daily coverage status,
-- weight entries, macro targets and the latest check-in.
-- ---------------------------------------------------------------------------

create or replace function public.get_athlete_nutrition_window(
  p_organization_id uuid,
  p_athlete_user_id uuid,
  p_week_start date
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_week_end date := p_week_start + 6;
  v_result jsonb;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if not public.coaches_athlete(p_organization_id, p_athlete_user_id) then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;
  if not exists (
    select 1 from public.nutrition_read_grants
     where organization_id = p_organization_id
       and athlete_user_id = p_athlete_user_id
       and granted_to = v_actor
       and revoked_at is null
  ) then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  select jsonb_build_object(
    'dailyStatus', coalesce((
      select jsonb_agg(jsonb_build_object('date', log_date, 'status', status, 'note', note) order by log_date)
        from public.daily_log_status
       where user_id = p_athlete_user_id and log_date between p_week_start and v_week_end
    ), '[]'::jsonb),
    'weightEntries', coalesce((
      select jsonb_agg(jsonb_build_object('measuredAt', measured_at, 'weightKg', weight_kg) order by measured_at)
        from public.weight_entries
       where user_id = p_athlete_user_id and measured_at::date between p_week_start and v_week_end
    ), '[]'::jsonb),
    'macroTargets', coalesce((
      select jsonb_agg(jsonb_build_object(
               'date', d.target_date, 'calories', d.calories,
               'proteinG', d.protein_g, 'carbsG', d.carbs_g, 'fatG', d.fat_g) order by d.target_date)
        from public.macro_program_days d
        join public.macro_programs p on p.id = d.program_id
       where p.user_id = p_athlete_user_id and d.target_date between p_week_start and v_week_end
    ), '[]'::jsonb),
    'latestCheckIn', (
      select jsonb_build_object(
               'status', status, 'explanation', explanation,
               'proposedCalories', proposed_calories, 'proposedProteinG', proposed_protein_g,
               'proposedCarbsG', proposed_carbs_g, 'proposedFatG', proposed_fat_g)
        from public.weekly_check_ins
       where user_id = p_athlete_user_id and week_start <= v_week_end
       order by week_start desc limit 1
    )
  ) into v_result;

  insert into public.coach_read_audit (organization_id, coach_user_id, athlete_user_id, rpc_name)
  values (p_organization_id, v_actor, p_athlete_user_id, 'get_athlete_nutrition_window');

  return v_result;
end;
$$;

revoke all on function public.get_athlete_nutrition_window(uuid, uuid, date) from public, anon;
grant execute on function public.get_athlete_nutrition_window(uuid, uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 12. get_athlete_week_plan — entries, decisions and session SUMMARIES only,
-- never block/set detail. Defensive jsonb-shape guards throughout: both
-- athlete_weekly_plans.plan and athlete_domain_snapshots.snapshot are
-- unconstrained, client-written JSON, the exact shape that crashed the
-- training-summary projection before a jsonb_typeof guard was added there.
-- ---------------------------------------------------------------------------

create or replace function public.get_athlete_week_plan(
  p_organization_id uuid,
  p_athlete_user_id uuid,
  p_week_start date
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_week_end date := p_week_start + 6;
  v_raw_plan jsonb;
  v_plan jsonb;
  v_sessions jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if not public.coaches_athlete(p_organization_id, p_athlete_user_id) then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  select plan into v_raw_plan from public.athlete_weekly_plans
   where user_id = p_athlete_user_id and week_start = p_week_start;

  select jsonb_build_object(
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
               'proposalId', e.value -> 'proposalId', 'domain', e.value -> 'domain',
               'date', e.value -> 'date', 'status', e.value -> 'status', 'title', e.value -> 'title'))
        from jsonb_array_elements(
               case when jsonb_typeof(v_raw_plan -> 'entries') = 'array'
                    then v_raw_plan -> 'entries' else '[]'::jsonb end) e
    ), '[]'::jsonb),
    -- `decisions[].explanation` is fixed, static prose per reasonCode (see
    -- packages/coordinator/src/coordinator.ts) -- safe to pass through
    -- unfiltered, unlike the athlete-authored fields above.
    'decisions', case when jsonb_typeof(v_raw_plan -> 'decisions') = 'array'
                       then v_raw_plan -> 'decisions' else '[]'::jsonb end
  ) into v_plan;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.value ->> 'id', 'kind', s.value ->> 'kind', 'date', s.value ->> 'date',
           'status', s.value ->> 'status', 'name', s.value ->> 'name') order by s.value ->> 'date'), '[]'::jsonb)
    into v_sessions
  from public.athlete_domain_snapshots d,
       lateral jsonb_array_elements(
         case when jsonb_typeof(d.snapshot -> 'sessions') = 'array'
              then d.snapshot -> 'sessions' else '[]'::jsonb end) s
  where d.user_id = p_athlete_user_id
    and d.domain in ('strength', 'conditioning')
    and (s.value ->> 'date') between p_week_start::text and v_week_end::text;

  return jsonb_build_object('plan', v_plan, 'sessions', v_sessions);
end;
$$;

revoke all on function public.get_athlete_week_plan(uuid, uuid, date) from public, anon;
grant execute on function public.get_athlete_week_plan(uuid, uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 13. request_session_detail — the per-session detail tier (SessionDrawer),
-- read-only in v1 per sign-off 4: no propose_session_edit exists. Every call
-- is logged to coach_read_audit, same as the nutrition window.
-- ---------------------------------------------------------------------------

create or replace function public.request_session_detail(
  p_organization_id uuid,
  p_athlete_user_id uuid,
  p_session_id text
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_session jsonb;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if not public.coaches_athlete(p_organization_id, p_athlete_user_id) then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  select s.value into v_session
  from public.athlete_domain_snapshots d,
       lateral jsonb_array_elements(
         case when jsonb_typeof(d.snapshot -> 'sessions') = 'array'
              then d.snapshot -> 'sessions' else '[]'::jsonb end) s
  where d.user_id = p_athlete_user_id
    and d.domain in ('strength', 'conditioning')
    and s.value ->> 'id' = p_session_id
  limit 1;

  if v_session is null then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  insert into public.coach_read_audit (organization_id, coach_user_id, athlete_user_id, rpc_name)
  values (p_organization_id, v_actor, p_athlete_user_id, 'request_session_detail');

  return v_session;
end;
$$;

revoke all on function public.request_session_detail(uuid, uuid, text) from public, anon;
grant execute on function public.request_session_detail(uuid, uuid, text) to authenticated;

-- Rollback, for the staging rehearsal this repository requires before any
-- release. Order matters: dependants first.
--
--   drop function if exists public.request_session_detail(uuid, uuid, text);
--   drop function if exists public.get_athlete_week_plan(uuid, uuid, date);
--   drop function if exists public.get_athlete_nutrition_window(uuid, uuid, date);
--   drop function if exists public.get_athlete_nutrition_summary(uuid, uuid, date);
--   drop function if exists public.set_nutrition_read_grant(uuid, uuid, boolean);
--   drop function if exists public.get_athlete_trend_series(uuid, uuid, text);
--   drop function if exists public.push_trend_snapshot(uuid, text, jsonb, timestamptz);
--   drop function if exists public.decide_progression_proposal(uuid, uuid, uuid, text, text);
--   drop function if exists public.get_athlete_progression_proposals(uuid, uuid);
--   drop function if exists public.push_progression_proposal(uuid, text, text, text, jsonb, jsonb, text, boolean, text, timestamptz);
--   drop table if exists public.coach_read_audit;
--   drop table if exists public.nutrition_read_grants;
--   drop table if exists public.athlete_trend_snapshots;
--   drop table if exists public.progression_proposal_snapshots;
