-- Nutrition domain admitted to the fitness ecosystem contract
--
-- MacroTrack is being rebuilt inside this repository as a third world, so the
-- ecosystem boundary gains a fourth owned domain: `nutrition`. The applied
-- migration 20260804_fitness_ecosystem_contracts.sql is never edited — it is
-- already live and old clients still read against it — so the domain arrives
-- here, as a widening of the two check constraints that enumerate domains.
--
-- This migration is additive only. Every value previously accepted is still
-- accepted, so no existing row can be rejected by the re-added constraints and
-- the drop/add pair cannot fail validation on live data. It grants no new
-- capability to anon, changes no RLS policy, and adds no table: nutrition rows
-- are still written exclusively through the same monotonic, security-definer
-- RPCs, under the same per-user ownership rules as every other domain.
--
-- The domain's contents are deliberately not modelled here. Athlete nutrition
-- data (log entries, weight entries, macro program, check-ins) travels as an
-- opaque JSON snapshot in its own partition, exactly as Strength and
-- Conditioning do, so nutrition sync and training sync cannot corrupt each
-- other. The relational food catalogue is a separate, later migration.
--
-- Apply in staging and rehearse the rollback below before enabling any
-- nutrition sync flag.

alter table public.athlete_domain_snapshots
  drop constraint if exists athlete_domain_name;
alter table public.athlete_domain_snapshots
  add constraint athlete_domain_name check (domain in ('strength', 'conditioning', 'athlete_state', 'coordinator', 'nutrition'));

alter table public.athlete_events
  drop constraint if exists athlete_event_source;
alter table public.athlete_events
  add constraint athlete_event_source check (source_domain in ('core', 'strength', 'conditioning', 'athlete_state', 'coordinator', 'nutrition'));

-- The table constraints are not the only gate. 20260804's own comment states
-- that "the monotonic RPCs below are the supported writes", and both write
-- functions re-check the domain in plpgsql before touching the table. Widening
-- only the constraints would leave `raise exception 'invalid domain'` as the
-- real boundary, so the two guards are replaced in lockstep here. The function
-- bodies are otherwise byte-identical to 20260804: same signature, same
-- security definer + search_path, same monotonic revision predicate, so the
-- existing grants and revokes continue to apply unchanged.

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
  if p_domain not in ('strength', 'conditioning', 'athlete_state', 'coordinator', 'nutrition') then raise exception 'invalid domain'; end if;
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
  if p_source_domain not in ('core', 'strength', 'conditioning', 'athlete_state', 'coordinator', 'nutrition') then raise exception 'invalid source domain'; end if;
  if jsonb_typeof(p_payload) <> 'object' then raise exception 'event payload must be a JSON object'; end if;
  insert into public.athlete_events(user_id, idempotency_key, event_type, source_domain, occurred_at, payload)
    values (v_uid, p_idempotency_key, p_event_type, p_source_domain, p_occurred_at, p_payload)
  on conflict (user_id, idempotency_key) do nothing;
  get diagnostics v_rows = row_count;
  v_changed := v_rows > 0;
  return v_changed;
end;
$$;

revoke all on function public.upsert_athlete_domain_snapshot(text, integer, bigint, text, timestamptz, jsonb) from public;
grant execute on function public.upsert_athlete_domain_snapshot(text, integer, bigint, text, timestamptz, jsonb) to authenticated;
revoke all on function public.record_athlete_event(text, text, text, timestamptz, jsonb) from public;
grant execute on function public.record_athlete_event(text, text, text, timestamptz, jsonb) to authenticated;

-- ROLLBACK
--
-- Narrowing is NOT unconditionally safe: if any nutrition row was written
-- before the rollback, re-adding the narrow constraints will fail validation.
-- Check first, and delete or re-home those rows before running the rollback:
--
--   select count(*) from public.athlete_domain_snapshots where domain = 'nutrition';
--   select count(*) from public.athlete_events where source_domain = 'nutrition';
--
-- Then:
--
--   alter table public.athlete_domain_snapshots
--     drop constraint if exists athlete_domain_name;
--   alter table public.athlete_domain_snapshots
--     add constraint athlete_domain_name check (domain in ('strength', 'conditioning', 'athlete_state', 'coordinator'));
--
--   alter table public.athlete_events
--     drop constraint if exists athlete_event_source;
--   alter table public.athlete_events
--     add constraint athlete_event_source check (source_domain in ('core', 'strength', 'conditioning', 'athlete_state', 'coordinator'));
--
-- and restore the two RPC guards by re-running the corresponding
-- `create or replace function` blocks from
-- supabase/migrations/20260804_fitness_ecosystem_contracts.sql verbatim, which
-- resets both domain lists to their pre-nutrition values.
