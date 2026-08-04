-- Fitness Ecosystem cross-app contract
--
-- Apply after supabase-schema.sql. The legacy public.app_state row remains a
-- compatibility bridge for existing installs; new product releases must use
-- these independently owned rows so a stale Strength or Conditioning client
-- cannot overwrite another domain's state.
--
-- This migration deliberately stores opaque JSON snapshots. The compatibility
-- boundary is the row ownership, schema version, revision and RLS contract;
-- internal engine objects can evolve without making every table relational on
-- day one.

create table if not exists public.athlete_core (
  user_id uuid primary key references auth.users(id) on delete cascade,
  schema_version integer not null default 1,
  revision bigint not null default 0,
  writer text not null default 'client',
  state jsonb not null default '{}'::jsonb,
  client_updated_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint athlete_core_state_object check (jsonb_typeof(state) = 'object'),
  constraint athlete_core_revision_nonnegative check (revision >= 0)
);

create table if not exists public.athlete_domain_snapshots (
  user_id uuid not null references auth.users(id) on delete cascade,
  domain text not null,
  schema_version integer not null default 1,
  revision bigint not null default 0,
  writer text not null,
  snapshot jsonb not null default '{}'::jsonb,
  client_updated_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, domain),
  constraint athlete_domain_name check (domain in ('strength', 'conditioning', 'athlete_state', 'coordinator')),
  constraint athlete_domain_snapshot_object check (jsonb_typeof(snapshot) = 'object'),
  constraint athlete_domain_revision_nonnegative check (revision >= 0)
);

create table if not exists public.athlete_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null,
  event_type text not null,
  source_domain text not null,
  occurred_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, idempotency_key),
  constraint athlete_event_type check (event_type in (
    'workout_completed',
    'workout_modified',
    'training_load_recorded',
    'body_weight_recorded',
    'readiness_recorded',
    'nutrition_target_updated'
  )),
  constraint athlete_event_source check (source_domain in ('core', 'strength', 'conditioning', 'athlete_state', 'coordinator')),
  constraint athlete_event_payload_object check (jsonb_typeof(payload) = 'object')
);

create table if not exists public.athlete_weekly_plans (
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  schema_version integer not null default 1,
  revision bigint not null default 0,
  writer text not null default 'coordinator',
  plan jsonb not null default '{}'::jsonb,
  client_generated_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, week_start),
  constraint athlete_plan_writer check (writer = 'coordinator'),
  constraint athlete_plan_object check (jsonb_typeof(plan) = 'object'),
  constraint athlete_plan_revision_nonnegative check (revision >= 0)
);

-- The service role is not used by client apps. Authenticated clients can see
-- only their own rows, and the monotonic RPCs below are the supported writes.
alter table public.athlete_core enable row level security;
alter table public.athlete_domain_snapshots enable row level security;
alter table public.athlete_events enable row level security;
alter table public.athlete_weekly_plans enable row level security;

drop policy if exists athlete_core_select on public.athlete_core;
create policy athlete_core_select on public.athlete_core for select using (auth.uid() = user_id);
drop policy if exists athlete_core_delete on public.athlete_core;
create policy athlete_core_delete on public.athlete_core for delete using (auth.uid() = user_id);

drop policy if exists athlete_domain_select on public.athlete_domain_snapshots;
create policy athlete_domain_select on public.athlete_domain_snapshots for select using (auth.uid() = user_id);
drop policy if exists athlete_domain_delete on public.athlete_domain_snapshots;
create policy athlete_domain_delete on public.athlete_domain_snapshots for delete using (auth.uid() = user_id);

drop policy if exists athlete_events_select on public.athlete_events;
create policy athlete_events_select on public.athlete_events for select using (auth.uid() = user_id);
drop policy if exists athlete_events_delete on public.athlete_events;
create policy athlete_events_delete on public.athlete_events for delete using (auth.uid() = user_id);

drop policy if exists athlete_plans_select on public.athlete_weekly_plans;
create policy athlete_plans_select on public.athlete_weekly_plans for select using (auth.uid() = user_id);
drop policy if exists athlete_plans_delete on public.athlete_weekly_plans;
create policy athlete_plans_delete on public.athlete_weekly_plans for delete using (auth.uid() = user_id);

create or replace function public.touch_ecosystem_row()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_athlete_core_touch on public.athlete_core;
create trigger trg_athlete_core_touch before insert or update on public.athlete_core
  for each row execute function public.touch_ecosystem_row();
drop trigger if exists trg_athlete_domain_touch on public.athlete_domain_snapshots;
create trigger trg_athlete_domain_touch before insert or update on public.athlete_domain_snapshots
  for each row execute function public.touch_ecosystem_row();
drop trigger if exists trg_athlete_plan_touch on public.athlete_weekly_plans;
create trigger trg_athlete_plan_touch before insert or update on public.athlete_weekly_plans
  for each row execute function public.touch_ecosystem_row();

-- Monotonic writes. The row is updated only when the incoming revision is
-- newer; equal revisions are accepted only when the writer and client time
-- are newer, making retries idempotent without allowing an old offline build
-- to roll data backwards.
create or replace function public.upsert_athlete_core(
  p_schema_version integer,
  p_revision bigint,
  p_writer text,
  p_client_updated_at timestamptz,
  p_state jsonb
)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_changed boolean := false; v_rows integer;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if jsonb_typeof(p_state) <> 'object' then raise exception 'state must be a JSON object'; end if;
  insert into public.athlete_core(user_id, schema_version, revision, writer, state, client_updated_at)
    values (v_uid, p_schema_version, p_revision, p_writer, p_state, p_client_updated_at)
  on conflict (user_id) do update set
    schema_version = excluded.schema_version,
    revision = excluded.revision,
    writer = excluded.writer,
    state = excluded.state,
    client_updated_at = excluded.client_updated_at
  where public.athlete_core.revision < excluded.revision
     or (public.athlete_core.revision = excluded.revision
         and coalesce(public.athlete_core.client_updated_at, '-infinity'::timestamptz)
             <= coalesce(excluded.client_updated_at, '-infinity'::timestamptz));
  get diagnostics v_rows = row_count;
  v_changed := v_rows > 0;
  return v_changed;
end;
$$;

create or replace function public.upsert_athlete_domain_snapshot(
  p_domain text,
  p_schema_version integer,
  p_revision bigint,
  p_writer text,
  p_client_updated_at timestamptz,
  p_snapshot jsonb
)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_changed boolean := false; v_rows integer;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_domain not in ('strength', 'conditioning', 'athlete_state', 'coordinator') then raise exception 'invalid domain'; end if;
  if jsonb_typeof(p_snapshot) <> 'object' then raise exception 'snapshot must be a JSON object'; end if;
  insert into public.athlete_domain_snapshots(user_id, domain, schema_version, revision, writer, snapshot, client_updated_at)
    values (v_uid, p_domain, p_schema_version, p_revision, p_writer, p_snapshot, p_client_updated_at)
  on conflict (user_id, domain) do update set
    schema_version = excluded.schema_version,
    revision = excluded.revision,
    writer = excluded.writer,
    snapshot = excluded.snapshot,
    client_updated_at = excluded.client_updated_at
  where public.athlete_domain_snapshots.revision < excluded.revision
     or (public.athlete_domain_snapshots.revision = excluded.revision
         and coalesce(public.athlete_domain_snapshots.client_updated_at, '-infinity'::timestamptz)
             <= coalesce(excluded.client_updated_at, '-infinity'::timestamptz));
  get diagnostics v_rows = row_count;
  v_changed := v_rows > 0;
  return v_changed;
end;
$$;

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
  where public.athlete_weekly_plans.revision < excluded.revision
     or (public.athlete_weekly_plans.revision = excluded.revision
         and coalesce(public.athlete_weekly_plans.client_generated_at, '-infinity'::timestamptz)
             <= coalesce(excluded.client_generated_at, '-infinity'::timestamptz));
  get diagnostics v_rows = row_count;
  v_changed := v_rows > 0;
  return v_changed;
end;
$$;

create or replace function public.record_athlete_event(
  p_idempotency_key text,
  p_event_type text,
  p_source_domain text,
  p_occurred_at timestamptz,
  p_payload jsonb
)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_changed boolean := false; v_rows integer;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_event_type not in ('workout_completed', 'workout_modified', 'training_load_recorded', 'body_weight_recorded', 'readiness_recorded', 'nutrition_target_updated') then raise exception 'invalid event type'; end if;
  if p_source_domain not in ('core', 'strength', 'conditioning', 'athlete_state', 'coordinator') then raise exception 'invalid source domain'; end if;
  if jsonb_typeof(p_payload) <> 'object' then raise exception 'event payload must be a JSON object'; end if;
  insert into public.athlete_events(user_id, idempotency_key, event_type, source_domain, occurred_at, payload)
    values (v_uid, p_idempotency_key, p_event_type, p_source_domain, p_occurred_at, p_payload)
  on conflict (user_id, idempotency_key) do nothing;
  get diagnostics v_rows = row_count;
  v_changed := v_rows > 0;
  return v_changed;
end;
$$;

revoke all on function public.upsert_athlete_core(integer, bigint, text, timestamptz, jsonb) from public;
grant execute on function public.upsert_athlete_core(integer, bigint, text, timestamptz, jsonb) to authenticated;
revoke all on function public.upsert_athlete_domain_snapshot(text, integer, bigint, text, timestamptz, jsonb) from public;
grant execute on function public.upsert_athlete_domain_snapshot(text, integer, bigint, text, timestamptz, jsonb) to authenticated;
revoke all on function public.publish_athlete_weekly_plan(date, integer, bigint, timestamptz, jsonb) from public;
grant execute on function public.publish_athlete_weekly_plan(date, integer, bigint, timestamptz, jsonb) to authenticated;
revoke all on function public.record_athlete_event(text, text, text, timestamptz, jsonb) from public;
grant execute on function public.record_athlete_event(text, text, text, timestamptz, jsonb) to authenticated;
