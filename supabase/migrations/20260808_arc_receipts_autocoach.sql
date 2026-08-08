-- ---------------------------------------------------------------------------
-- ARC coach workspace — visibility into what auto-coach did.
--
-- docs/RISK_REGISTER.md R3 (severity 4): `@hybrid/auto-coach`'s apply/undo
-- ledger (apps/web/src/autocoach/ledger.ts) is device-local only, its own
-- localStorage key, "invisible to sync" by explicit design comment. That was
-- the right call before a real coach existed to read it. Now a roster coach
-- can watch a session's trend, progression proposal and week plan without
-- ever learning the system itself modified, forked or dropped a session
-- under a pain/illness/interference constraint before the athlete ever saw
-- it -- which is exactly the "I told my coach X but the record says Y" gap
-- ARC layer 3 exists to close for every other domain.
--
-- SAME MECHANISM AS EVERY OTHER PUSH IN THIS SYSTEM, not a new one:
-- push_autocoach_receipt (SECURITY DEFINER, athlete-derived actor, idempotent
-- on a natural key) and get_athlete_autocoach_receipts (SECURITY DEFINER,
-- coaches_athlete()-gated), mirroring push_trend_snapshot /
-- get_athlete_trend_series in 20260808_arc_progression_review.sql exactly.
--
-- What is deliberately NOT pushed, matching the boundary every other layer-3
-- table already draws (progression_proposal_snapshots strips free-text
-- `reason`/`evidence`; get_athlete_week_plan carries no block/set detail):
-- `LedgerEntry.beforeBlocks` (the full pre-mutation block content of the
-- session -- block/set detail) and `forkedWorkoutId` (a raw internal
-- reference with no meaning to a coach). `operations` is safe to carry as-is
-- -- ResolutionOperation is already a structured, reviewed shape
-- (targetPath/before/after as short strings, reasonCode, materiality), the
-- same class of information a coach already legitimately sees today: the
-- "PROJECTION: the pain flag travels" test proves a coach is already told
-- WHEN a safety flag changed a session, just not that auto-coach specifically
-- acted on it. `reason_codes` is the StateConstraint code, not the athlete's
-- free-text report -- same tier as `hard boolean` on a progression proposal.
--
-- Same hard rules as every other migration in this system: no client role
-- holds INSERT on anything here; the write is a SECURITY DEFINER command that
-- derives the actor from auth.uid() and checks authorization as its first
-- statement; no table here carries FORCE ROW LEVEL SECURITY, for the reason
-- recorded in docs/RISK_REGISTER.md.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. autocoach_receipts — the athlete's device pushes a summary of what
-- auto-coach did to one session. Read-only review material for a coach,
-- exactly like a trend snapshot; never a write path back into training.
-- ---------------------------------------------------------------------------

create table if not exists public.autocoach_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  athlete_user_id uuid not null references auth.users(id) on delete cascade,
  -- LedgerEntry.id (e.g. "ac-<time36>-<rand6>") -- device-minted, but only
  -- ever used as an idempotency key, never trusted as a global identifier
  -- the way progression_proposal_snapshots.id explicitly is NOT trusted from
  -- the client either (this table's own `id` is still server-minted above).
  client_entry_id text not null,
  occurred_at timestamptz not null,
  session_date date not null,
  workout_id text not null,
  action text not null,
  was_forked boolean not null default false,
  operations jsonb not null default '[]'::jsonb,
  reason_codes text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  constraint autocoach_receipt_action check (action in ('applied', 'undone')),
  constraint autocoach_receipt_operations_array check (jsonb_typeof(operations) = 'array'),
  constraint autocoach_receipt_entry_id_nonempty check (length(btrim(client_entry_id)) > 0),
  -- A retried push (dropped connection, app killed mid-sync) must replay,
  -- never duplicate -- the same idempotency shape as every other push table.
  unique (organization_id, athlete_user_id, client_entry_id)
);

create index if not exists autocoach_receipts_athlete_idx
  on public.autocoach_receipts (organization_id, athlete_user_id, occurred_at desc);

alter table public.autocoach_receipts enable row level security;

drop policy if exists autocoach_receipts_read on public.autocoach_receipts;
create policy autocoach_receipts_read on public.autocoach_receipts for select to authenticated
  using (
    athlete_user_id = auth.uid()
    or public.coaches_athlete(organization_id, athlete_user_id)
    or public.is_org_member(organization_id, array['owner'])
  );

-- No insert/update/delete policy for ANY role: the table is written only
-- through push_autocoach_receipt below.
revoke all on public.autocoach_receipts from anon;
grant select on public.autocoach_receipts to authenticated;

-- ---------------------------------------------------------------------------
-- 2. push_autocoach_receipt — the athlete's own device only. Mirrors
-- push_trend_snapshot's shape exactly: is_org_member(org, ['athlete']) is
-- the whole authorization check, because the actor IS the subject.
-- ---------------------------------------------------------------------------

create or replace function public.push_autocoach_receipt(
  p_organization_id uuid,
  p_client_entry_id text,
  p_occurred_at timestamptz,
  p_session_date date,
  p_workout_id text,
  p_action text,
  p_was_forked boolean,
  p_operations jsonb,
  p_reason_codes text[]
)
returns public.autocoach_receipts
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_row public.autocoach_receipts;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if not public.is_org_member(p_organization_id, array['athlete']) then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;
  if p_action not in ('applied', 'undone') then
    raise exception 'invalid action' using errcode = 'invalid_parameter_value';
  end if;
  if p_client_entry_id is null or length(btrim(p_client_entry_id)) = 0 then
    raise exception 'client entry id required' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_typeof(p_operations) is distinct from 'array' then
    raise exception 'invalid operations' using errcode = 'invalid_parameter_value';
  end if;

  -- Idempotent push: a retry after a dropped connection returns the ORIGINAL
  -- row rather than erroring or duplicating -- the no-op update trick every
  -- other push RPC in this system uses, so RETURNING has a row to give back
  -- on conflict without actually overwriting anything.
  insert into public.autocoach_receipts (
    organization_id, athlete_user_id, client_entry_id, occurred_at,
    session_date, workout_id, action, was_forked, operations, reason_codes
  ) values (
    p_organization_id, v_actor, p_client_entry_id, p_occurred_at,
    p_session_date, p_workout_id, p_action, p_was_forked, p_operations, coalesce(p_reason_codes, '{}')
  )
  on conflict (organization_id, athlete_user_id, client_entry_id)
  do update set client_entry_id = autocoach_receipts.client_entry_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.push_autocoach_receipt(uuid, text, timestamptz, date, text, text, boolean, jsonb, text[]) from public, anon;
grant execute on function public.push_autocoach_receipt(uuid, text, timestamptz, date, text, text, boolean, jsonb, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. get_athlete_autocoach_receipts — coach-only, mirrors
-- get_athlete_trend_series: the athlete's own device already holds its own
-- ledger locally and has no need to read this back.
-- ---------------------------------------------------------------------------

create or replace function public.get_athlete_autocoach_receipts(
  p_organization_id uuid,
  p_athlete_user_id uuid,
  p_limit integer default 30
)
returns setof public.autocoach_receipts
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if not public.coaches_athlete(p_organization_id, p_athlete_user_id) then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  return query
    select * from public.autocoach_receipts
     where organization_id = p_organization_id
       and athlete_user_id = p_athlete_user_id
     order by occurred_at desc
     limit greatest(1, least(coalesce(p_limit, 30), 100));
end;
$$;

revoke all on function public.get_athlete_autocoach_receipts(uuid, uuid, integer) from public, anon;
grant execute on function public.get_athlete_autocoach_receipts(uuid, uuid, integer) to authenticated;

-- Rollback, for the staging rehearsal this repository requires before any
-- release. Order matters: dependants first.
--
--   drop function if exists public.get_athlete_autocoach_receipts(uuid, uuid, integer);
--   drop function if exists public.push_autocoach_receipt(uuid, text, timestamptz, date, text, text, boolean, jsonb, text[]);
--   drop table if exists public.autocoach_receipts;
