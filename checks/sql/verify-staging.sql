-- ---------------------------------------------------------------------------
-- ARC coach workspace — staging verification.
--
-- checks/migrations-apply.mjs proves all of this against a THROWAWAY local
-- Postgres cluster this repo builds and destroys itself. It has never once
-- touched a real Supabase project. This file is the same kind of proof, run
-- by a human against the REAL staging database, after the migrations below
-- have actually been applied there.
--
-- HOW TO RUN
--
--   1. Apply the four migrations to staging first, in this order (the
--      filenames already sort correctly):
--        supabase/migrations/20260808_arc_coach_workspace.sql
--        supabase/migrations/20260808_arc_program_assignment_lifecycle.sql
--        supabase/migrations/20260808_arc_progression_review.sql
--        supabase/migrations/20260808_arc_workout_library.sql
--      via `supabase db push` or `psql <connection-string> -f <file>` for
--      each, in order.
--
--   2. Run this file with the STAGING PROJECT'S DIRECT POSTGRES CONNECTION
--      STRING — Supabase dashboard → Settings → Database → Connection
--      string (the "URI" one, port 5432 or the pooler's 6543, NOT the anon
--      key and NOT a PostgREST URL). That string is as sensitive as a
--      service-role key: keep it in your shell environment, never in chat,
--      never committed.
--
--        psql "$STAGING_DATABASE_URL" -f checks/sql/verify-staging.sql
--
-- WHY THIS IS SAFE TO RUN AGAINST REAL STAGING
--
-- Every behavioural check below (section 2) runs inside ONE transaction that
-- ends in an explicit `rollback` at the bottom of this file — never
-- `commit`. The fake organisation, memberships, athlete, coach and rows it
-- creates to prove the RLS boundaries are never persisted, pass or fail.
-- Postgres also auto-rolls-back an open transaction if the connection drops
-- for any reason (a network blip, psql being killed), so there is no path
-- that leaves residue in staging.
--
-- Section 1 (schema shape) is READ-ONLY and runs outside the transaction —
-- it only ever selects from the catalog.
--
-- WHAT "PASS"/"FAIL" MEANS HERE
--
-- Every check is a `do $$ ... exception when others ...$$` block, the exact
-- shape `checks/migrations-apply.mjs` uses, for the exact same reason: a
-- genuinely unexpected error in one check (a typo, a function that does not
-- exist) must not abort the whole script or cascade into every check after
-- it silently "failing" for the wrong reason. Read the FAIL line itself —
-- it says which check and, for a refusal-shaped check, the SQLSTATE.
-- ---------------------------------------------------------------------------

\set QUIET on
\pset pager off
\set QUIET off

\echo '=== ARC staging verification ==='
\echo ''
\echo '--- Section 1: schema shape (read-only, no transaction) ---'
\echo ''

do $$
declare
  v_expected text[] := array[
    'organizations', 'organization_memberships', 'coach_athlete_assignments',
    'program_templates', 'program_template_versions', 'training_block_templates',
    'program_assignments', 'assignment_input_versions', 'coach_decisions',
    'decision_receipts', 'progression_proposal_snapshots', 'athlete_trend_snapshots',
    'nutrition_read_grants', 'coach_read_audit', 'coach_workout_drafts'
  ];
  v_missing text[];
  v_no_rls text[];
  v_client_write text[];
  v_t text;
begin
  select array_agg(t) into v_missing
    from unnest(v_expected) t
   where not exists (select 1 from pg_tables where schemaname = 'public' and tablename = t);
  if v_missing is null then
    raise notice 'PASS — all % ARC tables exist', array_length(v_expected, 1);
  else
    raise notice 'FAIL — missing tables: %', v_missing;
  end if;

  select array_agg(t) into v_no_rls
    from unnest(v_expected) t
    join pg_tables pt on pt.tablename = t and pt.schemaname = 'public'
   where not pt.rowsecurity;
  if v_no_rls is null then
    raise notice 'PASS — row level security is enabled on every ARC table';
  else
    raise notice 'FAIL — RLS not enabled on: %', v_no_rls;
  end if;

  -- The load-bearing structural guarantee across every ARC migration: no
  -- client role holds INSERT, UPDATE or DELETE on ANY of these tables. If
  -- this ever finds one, every write goes through a SECURITY DEFINER
  -- command instead of that policy, and something drifted from the design.
  select array_agg(distinct tablename || ':' || cmd) into v_client_write
    from pg_policies
   where schemaname = 'public'
     and tablename = any(v_expected)
     and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
     and 'authenticated' = any(roles);
  if v_client_write is null then
    raise notice 'PASS — no client-role write policy exists on any ARC table';
  else
    raise notice 'FAIL — a client role can write directly: %', v_client_write;
  end if;
end $$;

do $$
declare
  v_expected text[] := array[
    'is_org_member', 'coaches_athlete', 'deny_mutation', 'deny_truncate',
    'create_program_assignment', 'get_athlete_training_summary',
    'accept_program_assignment', 'decline_program_assignment',
    'push_progression_proposal', 'get_athlete_progression_proposals',
    'decide_progression_proposal', 'push_trend_snapshot', 'get_athlete_trend_series',
    'set_nutrition_read_grant', 'get_athlete_nutrition_summary', 'get_athlete_nutrition_window',
    'get_athlete_week_plan', 'request_session_detail', 'can_read_program_template',
    'save_workout_draft', 'get_athlete_workout_library', 'publish_workout_draft'
  ];
  v_missing text[];
  v_public_execute text[];
begin
  select array_agg(f) into v_missing
    from unnest(v_expected) f
   where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                       where n.nspname = 'public' and p.proname = f);
  if v_missing is null then
    raise notice 'PASS — all % ARC functions exist', array_length(v_expected, 1);
  else
    raise notice 'FAIL — missing functions: %', v_missing;
  end if;

  -- Default PUBLIC EXECUTE is granted to every new function unless revoked.
  -- A function still callable by `public`/`anon` is reachable by an
  -- unauthenticated caller, whatever its own auth.uid() check does inside.
  select array_agg(p.proname) into v_public_execute
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = any(v_expected)
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_public_execute is null then
    raise notice 'PASS — anon holds EXECUTE on none of the ARC functions';
  else
    raise notice 'FAIL — anon can call: %', v_public_execute;
  end if;
end $$;

\echo ''
\echo '--- Section 2: behavioural checks (transactional, ALWAYS rolled back) ---'
\echo ''

begin;

do $$
declare
  org_1 uuid := '11111111-1111-1111-1111-111111111111';
  org_2 uuid := '22222222-2222-2222-2222-222222222222';
  coach_1 uuid := 'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1';
  coach_2 uuid := 'c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2';
  athlete_a uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  athlete_b uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  tpl uuid := '33333333-3333-3333-3333-333333333333';
  tplv uuid := '44444444-4444-4444-4444-444444444444';
  assign uuid := '66666666-6666-6666-6666-666666666666';
begin
  insert into auth.users (id) values (coach_1), (coach_2), (athlete_a), (athlete_b)
    on conflict do nothing;
  insert into public.organizations (id, name, created_by) values
    (org_1, 'Staging Verify Org 1', coach_1),
    (org_2, 'Staging Verify Org 2', coach_2);
  insert into public.organization_memberships (organization_id, user_id, role, status) values
    (org_1, coach_1, 'coach', 'active'),
    (org_1, athlete_a, 'athlete', 'active'),
    (org_2, coach_2, 'coach', 'active'),
    (org_2, athlete_b, 'athlete', 'active');
  insert into public.coach_athlete_assignments (organization_id, coach_user_id, athlete_user_id) values
    (org_1, coach_1, athlete_a);
  insert into public.program_templates (id, organization_id, domain, name, created_by)
    values (tpl, org_1, 'strength', 'Verify Template', coach_1);
  insert into public.program_template_versions (id, template_id, version, published_by)
    values (tplv, tpl, 1, coach_1);
  insert into public.program_assignments (id, organization_id, athlete_user_id, template_version_id, preferred_start_date, preferred_weekdays, created_by)
    values (assign, org_1, athlete_a, tplv, current_date, '{1,3,5}', coach_1);

  raise notice 'PASS — fixture data seeded (rolls back at the end of this script)';
exception when others then
  raise notice 'FAIL — seeding the fixture itself failed [%] %, every check below is meaningless', sqlstate, sqlerrm;
end $$;

-- Become a real client role for every check below: RLS does nothing for the
-- role that owns/created these tables, and this connection almost certainly
-- IS that role (the direct Postgres connection string is a superuser or the
-- table owner). Without this, every check below would silently pass no
-- matter how broken the policies actually are.
do $$ begin perform set_config('request.jwt.claims', '{"sub":"c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1"}', true); end $$;
set local role authenticated;

do $$
declare
  n integer;
begin
  select count(*) into n from public.program_assignments where id = '66666666-6666-6666-6666-666666666666';
  if n = 1 then
    raise notice 'PASS — the legitimate read works (coach sees their own athlete''s assignment) — every FAIL below is meaningful';
  else
    raise notice 'FAIL — the legitimate read itself returned % rows, not 1 — RLS or the fixture is broken; STOP and investigate before trusting anything below', n;
  end if;
end $$;

do $$ begin perform set_config('request.jwt.claims', '{"sub":"c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2"}', true); end $$;

do $$
declare
  n integer;
begin
  select count(*) into n from public.program_assignments where id = '66666666-6666-6666-6666-666666666666';
  if n = 0 then
    raise notice 'PASS — CROSS-TENANT: a coach in another organisation sees nothing';
  else
    raise notice 'FAIL — CROSS-TENANT: org 2''s coach read % of org 1''s assignments', n;
  end if;
end $$;

do $$
declare
  n integer;
begin
  select count(*) into n from public.progression_proposal_snapshots
   where athlete_user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  if n = 0 then
    raise notice 'PASS — CROSS-ATHLETE: a coach not coaching this athlete reads no progression proposals';
  else
    raise notice 'FAIL — CROSS-ATHLETE: a non-coaching coach read % progression proposal(s)', n;
  end if;
end $$;

do $$ begin perform set_config('request.jwt.claims', '{"sub":"c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1"}', true); end $$;

do $$
begin
  update public.coach_decisions set kind = 'template_published' where organization_id = '11111111-1111-1111-1111-111111111111';
  raise notice 'FAIL — IMMUTABLE: a coach_decisions row was updated';
exception when others then
  raise notice 'PASS — IMMUTABLE: coach_decisions cannot be updated [%]', sqlstate;
end $$;

do $$
begin
  perform public.create_program_assignment(
    '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '44444444-4444-4444-4444-444444444444', current_date + 7, '{2,4}'::smallint[], 'staging-verify-1');
  raise notice 'PASS — COMMAND: a coach can assign a shared template to their own athlete';
exception when others then
  raise notice 'FAIL — COMMAND: the legitimate assignment command was refused [%] %', sqlstate, sqlerrm;
end $$;

do $$
begin
  perform public.create_program_assignment(
    '11111111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '44444444-4444-4444-4444-444444444444', current_date + 7, '{2,4}'::smallint[], 'staging-verify-2');
  raise notice 'FAIL — COMMAND: a coach assigned a program to an athlete who is not theirs';
exception when others then
  raise notice 'PASS — COMMAND: a coach cannot assign to an athlete who is not theirs [%]', sqlstate;
end $$;

do $$
declare
  v_state text;
begin
  select state into v_state from public.accept_program_assignment(
    '11111111-1111-1111-1111-111111111111', '66666666-6666-6666-6666-666666666666', 'staging-verify-accept-wrong-actor');
  raise notice 'FAIL — LIFECYCLE: a coach accepted their own athlete''s assignment (got state %)', v_state;
exception when others then
  raise notice 'PASS — LIFECYCLE: a coach cannot accept an athlete''s assignment [%]', sqlstate;
end $$;

do $$ begin perform set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}', true); end $$;

do $$
declare
  v_state text;
begin
  select state into v_state from public.accept_program_assignment(
    '11111111-1111-1111-1111-111111111111', '66666666-6666-6666-6666-666666666666', 'staging-verify-accept-1');
  if v_state = 'accepted' then
    raise notice 'PASS — LIFECYCLE: the athlete accepts their own assignment';
  else
    raise notice 'FAIL — LIFECYCLE: expected accepted, got %', v_state;
  end if;
exception when others then
  raise notice 'FAIL — LIFECYCLE: the athlete''s own accept was refused [%] %', sqlstate, sqlerrm;
end $$;

do $$
begin
  perform public.push_progression_proposal(
    '11111111-1111-1111-1111-111111111111', 'strength', 'Staging Verify Squat', 'strength:verify-squat',
    null, '{"kg":100,"at":1000}'::jsonb, 'high', false, 'increase', now());
  raise notice 'PASS — PROGRESSION: the athlete can push their own proposal';
exception when others then
  raise notice 'FAIL — PROGRESSION: the athlete''s own push was refused [%] %', sqlstate, sqlerrm;
end $$;

\echo ''
\echo 'Rolling back every fixture row created above — nothing persists in staging.'
rollback;

\echo ''
\echo '=== Done. Read every FAIL line above; a clean run prints none. ==='
