-- THE Hybrid System — cloud sync schema
-- Run this once in your Supabase project's SQL Editor (Dashboard → SQL Editor → New query → paste → Run).
--
-- Design: one row per signed-in user, holding the entire app state as a
-- single JSON blob. This mirrors the app's existing local-first model (it
-- already keeps one big state object in localStorage) instead of splitting
-- everything into a relational schema — far less to build and maintain for
-- a single-user app, at the cost of not being queryable row-by-row in SQL.
-- If you ever want real per-exercise/per-session querying in Supabase later,
-- this table can be migrated without touching auth.

create table if not exists public.app_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

-- Row Level Security: every user can only ever see/write their own row.
-- This is what actually protects the data — the app's anon key is public
-- by design (it ships in the browser), so RLS is the real security boundary.
alter table public.app_state enable row level security;

drop policy if exists "select own state" on public.app_state;
create policy "select own state" on public.app_state
  for select using (auth.uid() = user_id);

drop policy if exists "insert own state" on public.app_state;
create policy "insert own state" on public.app_state
  for insert with check (auth.uid() = user_id);

drop policy if exists "update own state" on public.app_state;
create policy "update own state" on public.app_state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "delete own state" on public.app_state;
create policy "delete own state" on public.app_state
  for delete using (auth.uid() = user_id);

-- Keep updated_at accurate server-side regardless of what the client sends,
-- since the client uses this timestamp to decide which copy (local vs
-- remote) wins during sync.
create or replace function public.set_app_state_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_app_state_updated_at on public.app_state;
create trigger trg_app_state_updated_at
  before insert or update on public.app_state
  for each row execute function public.set_app_state_updated_at();


-- =====================================================================
-- Coach website (Entity 2) — additive. The app_state table above is
-- untouched. Run this whole block once in the SQL Editor; every object is
-- create-if-not-exists / drop-if-exists so re-running is safe.
-- =====================================================================

-- Coach's private authoring library (one JSON blob per coach). Athletes never
-- select this; only the owning coach can read/write it.
create table if not exists public.coach_library (
  coach_id uuid primary key references auth.users(id) on delete cascade,
  library jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.coach_library enable row level security;
drop policy if exists cl_all on public.coach_library;
create policy cl_all on public.coach_library for all
  using (auth.uid() = coach_id) with check (auth.uid() = coach_id);

-- Coach <-> athlete link, token-gated. There is deliberately no athlete UPDATE
-- policy: the only way to claim a link is the security-definer claim_invite RPC.
create table if not exists public.coach_athletes (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references auth.users(id) on delete cascade,
  athlete_id uuid null references auth.users(id) on delete cascade,
  invite_token text not null unique,
  status text not null default 'pending',
  label text,
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);
alter table public.coach_athletes enable row level security;
drop policy if exists ca_coach_all on public.coach_athletes;
create policy ca_coach_all on public.coach_athletes for all
  using (auth.uid() = coach_id) with check (auth.uid() = coach_id);
drop policy if exists ca_athlete_read on public.coach_athletes;
create policy ca_athlete_read on public.coach_athletes for select
  using (auth.uid() = athlete_id and status = 'active');

-- Consensual-link check (security definer). Standalone execute is revoked so it
-- can't be used as a membership oracle; it is only called inside the policies
-- below (which run as the definer).
create or replace function public.is_active_athlete_of(p_coach uuid, p_athlete uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select p_coach = p_athlete or exists (
    select 1 from public.coach_athletes ca
    where ca.coach_id = p_coach and ca.athlete_id = p_athlete and ca.status = 'active');
$$;
revoke all on function public.is_active_athlete_of(uuid, uuid) from public, authenticated;

-- Claim an invite. The token IS the capability; the row is re-checked under a
-- FOR UPDATE lock so an invite can never be double-claimed.
create or replace function public.claim_invite(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_row public.coach_athletes;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select * into v_row from public.coach_athletes
    where invite_token = p_token and status = 'pending' and athlete_id is null for update;
  if not found then raise exception 'invalid or already-used invite'; end if;
  update public.coach_athletes set athlete_id = v_uid, status = 'active', accepted_at = now()
    where id = v_row.id;
  return jsonb_build_object('coach_id', v_row.coach_id, 'label', v_row.label);
end; $$;
revoke all on function public.claim_invite(text) from public;
grant execute on function public.claim_invite(text) to authenticated;

-- Programs (grouping for the week/day board).
create table if not exists public.programs (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references auth.users(id) on delete cascade,
  athlete_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Program',
  weeks int not null default 4,
  created_at timestamptz not null default now()
);
alter table public.programs enable row level security;
drop policy if exists pr_coach on public.programs;
create policy pr_coach on public.programs for all
  using (auth.uid() = coach_id) with check (auth.uid() = coach_id);
drop policy if exists pr_athlete_read on public.programs;
create policy pr_athlete_read on public.programs for select using (auth.uid() = athlete_id);

-- Assignments — the only cross-account handoff. Each row is a self-contained
-- phone-shape session snapshot the athlete materializes onto their calendar.
create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references auth.users(id) on delete cascade,
  athlete_id uuid not null references auth.users(id) on delete cascade,
  program_id uuid null references public.programs(id) on delete cascade,
  week_index int null,
  day_index int null,
  scheduled_date date null,
  session_snapshot jsonb not null,
  status text not null default 'assigned',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A TOTAL unique index, usable as a PostgREST onConflict arbiter. Postgres
-- treats NULLs as distinct, so ad-hoc rows (program_id/week/day NULL) never
-- collide, while program-slot rows upsert idempotently.
drop index if exists assignments_slot_uniq;
create unique index assignments_slot_uniq
  on public.assignments (coach_id, athlete_id, program_id, week_index, day_index);

alter table public.assignments enable row level security;
drop policy if exists as_insert on public.assignments;
create policy as_insert on public.assignments for insert
  with check (auth.uid() = coach_id and public.is_active_athlete_of(coach_id, athlete_id));
drop policy if exists as_update on public.assignments;
create policy as_update on public.assignments for update using (auth.uid() = coach_id)
  with check (auth.uid() = coach_id and public.is_active_athlete_of(coach_id, athlete_id));
drop policy if exists as_delete on public.assignments;
create policy as_delete on public.assignments for delete using (auth.uid() = coach_id);
drop policy if exists as_select_coach on public.assignments;
create policy as_select_coach on public.assignments for select using (auth.uid() = coach_id);
drop policy if exists as_select_athlete on public.assignments;
create policy as_select_athlete on public.assignments for select
  using (auth.uid() = athlete_id and status = 'assigned');

create or replace function public.touch_assignments() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists trg_assignments_touch on public.assignments;
create trigger trg_assignments_touch before insert or update on public.assignments
  for each row execute function public.touch_assignments();
