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
