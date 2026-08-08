-- ---------------------------------------------------------------------------
-- Product isolation — staging verification.
--
-- A DIFFERENT boundary from checks/sql/verify-staging.sql, which proves the
-- ARC coach workspace (organisations, coaches, athletes, roles). This proves
-- the older, separate guarantee: a Strength push can never see or overwrite
-- Conditioning's data, and vice versa, and neither can smuggle itself in
-- under a bogus label. That system is packages/engine/src/ecosystem.ts +
-- supabase/migrations/20260804_fitness_ecosystem_contracts.sql (widened by
-- 20260807_nutrition_domain.sql) — untouched by today's ARC work, and
-- already unit-tested locally in packages/engine/src/ecosystem*.test.ts.
-- This is that same guarantee, proven against the real database instead of
-- pure JS, plus the two NEW domain-tagged ARC tables from today
-- (progression_proposal_snapshots, athlete_trend_snapshots) that carry the
-- same kind of tag and deserve the same check.
--
-- HOW TO RUN, same requirements as verify-staging.sql: apply the migrations
-- first, then run this with the STAGING PROJECT'S DIRECT POSTGRES CONNECTION
-- STRING (never the anon key, never pasted into chat):
--
--   psql "$STAGING_DATABASE_URL" -f checks/sql/verify-staging-product-isolation.sql
--
-- WHY THIS IS SAFE TO RUN AGAINST REAL STAGING: identical shape to
-- verify-staging.sql. Section 1 is read-only. Section 2 runs inside ONE
-- transaction that ends in an explicit `rollback`, never `commit`; Postgres
-- also auto-rolls-back on a dropped connection. Nothing here is ever
-- persisted in staging, pass or fail.
-- ---------------------------------------------------------------------------

\set QUIET on
\pset pager off
\set QUIET off

\echo '=== Product isolation — staging verification ==='
\echo ''
\echo '--- Section 1: schema shape (read-only, no transaction) ---'
\echo ''

do $$
begin
  -- The whole guarantee starts here: one row PER (user, domain), not one row
  -- per user. If this were ever weakened to just `primary key (user_id)`,
  -- a Conditioning write would physically overwrite Strength's row instead
  -- of merely sharing a table with it.
  if exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    where t.relname = 'athlete_domain_snapshots' and c.contype = 'p'
      and pg_get_constraintdef(c.oid) = 'PRIMARY KEY (user_id, domain)'
  ) then
    raise notice 'PASS — athlete_domain_snapshots is keyed per (user_id, domain), not per user';
  else
    raise notice 'FAIL — athlete_domain_snapshots'' primary key is not (user_id, domain) as expected';
  end if;

  if exists (
    select 1 from pg_tables where schemaname = 'public' and tablename = 'athlete_domain_snapshots'
  ) and (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'athlete_domain_snapshots') then
    raise notice 'PASS — row level security is enabled on athlete_domain_snapshots';
  else
    raise notice 'FAIL — athlete_domain_snapshots is missing or has RLS disabled';
  end if;
end $$;

\echo ''
\echo '--- Section 2: behavioural checks (transactional, ALWAYS rolled back) ---'
\echo ''

begin;

do $$
declare
  athlete_p uuid := 'd0d0d0d0-d0d0-d0d0-d0d0-d0d0d0d0d0d0';
begin
  insert into auth.users (id) values (athlete_p) on conflict do nothing;
  raise notice 'PASS — fixture athlete seeded (rolls back at the end of this script)';
exception when others then
  raise notice 'FAIL — seeding the fixture itself failed [%] %, every check below is meaningless', sqlstate, sqlerrm;
end $$;

do $$ begin perform set_config('request.jwt.claims', '{"sub":"d0d0d0d0-d0d0-d0d0-d0d0-d0d0d0d0d0d0"}', true); end $$;
set local role authenticated;

do $$
declare
  strength_ok boolean;
  conditioning_ok boolean;
begin
  strength_ok := public.upsert_athlete_domain_snapshot('strength', 1, 1, 'verify:strength', now(), '{"marker":"strength-only"}'::jsonb);
  conditioning_ok := public.upsert_athlete_domain_snapshot('conditioning', 1, 1, 'verify:conditioning', now(), '{"marker":"conditioning-only"}'::jsonb);
  if strength_ok and conditioning_ok then
    raise notice 'PASS — a strength push and a conditioning push both write, as two separate calls';
  else
    raise notice 'FAIL — strength_ok=% conditioning_ok=%, expected both true', strength_ok, conditioning_ok;
  end if;
end $$;

do $$
declare
  n integer;
  strength_marker text;
  conditioning_marker text;
begin
  select count(*) into n from public.athlete_domain_snapshots
   where user_id = 'd0d0d0d0-d0d0-d0d0-d0d0-d0d0d0d0d0d0' and domain in ('strength', 'conditioning');
  select snapshot ->> 'marker' into strength_marker from public.athlete_domain_snapshots
   where user_id = 'd0d0d0d0-d0d0-d0d0-d0d0-d0d0d0d0d0d0' and domain = 'strength';
  select snapshot ->> 'marker' into conditioning_marker from public.athlete_domain_snapshots
   where user_id = 'd0d0d0d0-d0d0-d0d0-d0d0-d0d0d0d0d0d0' and domain = 'conditioning';

  if n = 2 and strength_marker = 'strength-only' and conditioning_marker = 'conditioning-only' then
    raise notice 'PASS — CROSS-DOMAIN: two distinct rows exist, and neither push overwrote or altered the other''s content';
  else
    raise notice 'FAIL — CROSS-DOMAIN: expected 2 rows with untouched markers, got % rows, strength=%, conditioning=%', n, strength_marker, conditioning_marker;
  end if;
end $$;

do $$
declare
  strength_rev bigint;
begin
  -- A CONDITIONING write must not bump STRENGTH's revision. If it did, a
  -- strength-only client pulling later would believe ITS OWN domain had
  -- changed on the server and go looking for an update that was never
  -- theirs to find.
  select revision into strength_rev from public.athlete_domain_snapshots
   where user_id = 'd0d0d0d0-d0d0-d0d0-d0d0-d0d0d0d0d0d0' and domain = 'strength';
  perform public.upsert_athlete_domain_snapshot('conditioning', 1, 2, 'verify:conditioning', now(), '{"marker":"conditioning-only-v2"}'::jsonb);
  if (select revision from public.athlete_domain_snapshots
       where user_id = 'd0d0d0d0-d0d0-d0d0-d0d0-d0d0d0d0d0d0' and domain = 'strength') = strength_rev then
    raise notice 'PASS — CROSS-DOMAIN: a conditioning revision bump left strength''s revision untouched';
  else
    raise notice 'FAIL — CROSS-DOMAIN: pushing conditioning changed strength''s revision';
  end if;
end $$;

do $$
begin
  perform public.upsert_athlete_domain_snapshot('not_a_real_domain', 1, 1, 'verify', now(), '{}'::jsonb);
  raise notice 'FAIL — a bogus domain value was accepted rather than rejected';
exception when others then
  raise notice 'PASS — a bogus domain value is refused, not silently stored under an invented label [%]', sqlstate;
end $$;

do $$
begin
  perform public.record_athlete_event('verify-evt-1', 'workout_completed', 'not_a_real_domain', now(), '{}'::jsonb);
  raise notice 'FAIL — record_athlete_event accepted a bogus source_domain';
exception when others then
  raise notice 'PASS — record_athlete_event refuses a bogus source_domain [%]', sqlstate;
end $$;

-- The two NEW domain-tagged ARC tables from today (docs/ARC_LAYER3_DESIGN.md
-- finding 2): the SAME collision class fixed there (a strength and a
-- conditioning proposal sharing a key/timestamp) is re-checked here, against
-- the real database, not just the throwaway one migrations-apply.mjs builds.
--
-- `reset role` first: the session is still impersonating `authenticated`
-- from the athlete impersonation above, and none of organizations,
-- organization_memberships or coach_athlete_assignments grants that role
-- INSERT (by design — every ARC write goes through a SECURITY DEFINER
-- command, never a client role writing the table directly). Seeding fixture
-- rows needs the connection's real, owning role, same split
-- checks/migrations-apply.mjs uses between `asOwnerSql` and `asAthlete`.
reset role;

do $$
declare
  org uuid := 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  coach uuid := 'e1e1e1e1-e1e1-e1e1-e1e1-e1e1e1e1e1e1';
  n integer;
begin
  insert into auth.users (id) values (coach) on conflict do nothing;
  insert into public.organizations (id, name, created_by) values (org, 'Product Isolation Verify Org', coach);
  insert into public.organization_memberships (organization_id, user_id, role, status) values
    (org, coach, 'coach', 'active'),
    (org, 'd0d0d0d0-d0d0-d0d0-d0d0-d0d0d0d0d0d0', 'athlete', 'active');
  insert into public.coach_athlete_assignments (organization_id, coach_user_id, athlete_user_id)
    values (org, coach, 'd0d0d0d0-d0d0-d0d0-d0d0-d0d0d0d0d0d0');
exception when others then
  raise notice 'FAIL — seeding the product-isolation fixture failed [%] %, the two checks below are meaningless', sqlstate, sqlerrm;
end $$;

-- Back to the athlete, for the actual pushes: push_progression_proposal and
-- push_trend_snapshot both derive the actor from auth.uid(), and this keeps
-- the calls under the same role a real client connection would use.
set local role authenticated;

do $$
declare
  org uuid := 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  n integer;
begin
  perform public.push_progression_proposal(org, 'strength', 'Verify Squat', 'shared-key', null, '{"kg":100}'::jsonb, 'high', false, 'increase', '2026-01-01T00:00:00Z');
  perform public.push_progression_proposal(org, 'conditioning', 'Verify Row', 'shared-key', null, '{"level":1}'::jsonb, 'high', false, 'increase', '2026-01-01T00:00:00Z');

  select count(*) into n from public.progression_proposal_snapshots
   where athlete_user_id = 'd0d0d0d0-d0d0-d0d0-d0d0-d0d0d0d0d0d0'
     and client_key = 'shared-key' and source_at = '2026-01-01T00:00:00Z'::timestamptz;
  if n = 2 then
    raise notice 'PASS — PROGRESSION: a strength and a conditioning proposal sharing a key/timestamp coexist as two rows, not one collision';
  else
    raise notice 'FAIL — PROGRESSION: expected 2 distinct proposals, got %', n;
  end if;
exception when others then
  raise notice 'FAIL — PROGRESSION isolation check itself errored [%] %', sqlstate, sqlerrm;
end $$;

do $$
declare
  lift_points text;
  erg_points text;
begin
  perform public.push_trend_snapshot('ffffffff-ffff-ffff-ffff-ffffffffffff', 'lift_trend', '[{"marker":"lift-only"}]'::jsonb, '2026-01-01T00:00:00Z');
  perform public.push_trend_snapshot('ffffffff-ffff-ffff-ffff-ffffffffffff', 'erg_trend', '[{"marker":"erg-only"}]'::jsonb, '2026-01-01T00:00:00Z');
  select points::text into lift_points from public.athlete_trend_snapshots
   where athlete_user_id = 'd0d0d0d0-d0d0-d0d0-d0d0-d0d0d0d0d0d0' and kind = 'lift_trend';
  select points::text into erg_points from public.athlete_trend_snapshots
   where athlete_user_id = 'd0d0d0d0-d0d0-d0d0-d0d0-d0d0d0d0d0d0' and kind = 'erg_trend';
  if lift_points like '%lift-only%' and erg_points like '%erg-only%' then
    raise notice 'PASS — TRENDS: a lift_trend push and an erg_trend push at the same timestamp coexist, unmixed';
  else
    raise notice 'FAIL — TRENDS: lift=%s erg=%s — one may have overwritten the other', lift_points, erg_points;
  end if;
exception when others then
  raise notice 'FAIL — TRENDS isolation check itself errored [%] %', sqlstate, sqlerrm;
end $$;

\echo ''
\echo 'Rolling back every fixture row created above — nothing persists in staging.'
rollback;

\echo ''
\echo '=== Done. Read every FAIL line above; a clean run prints none. ==='
