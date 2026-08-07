-- The parts of a Supabase project the migrations assume already exist.
--
-- `auth.uid()` here is not a constant. RLS is only provable if two different
-- athletes can be simulated in the same cluster, so this mirrors Supabase's own
-- implementation: read the `sub` claim out of the request-scoped GUC that
-- PostgREST sets per connection. A session becomes athlete X with
--
--   select set_config('request.jwt.claims', '{"sub":"<uuid>"}', true);
--   set local role authenticated;
--
-- and `set local role` matters as much as the claim — postgres is a superuser
-- and superusers bypass RLS entirely, so a check that forgets to drop role
-- proves nothing.
--
-- With no claim set, auth.uid() falls back to the original fixed test user so
-- the ecosystem RPC checks keep working unchanged.

create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
insert into auth.users values
  ('11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
on conflict do nothing;

create or replace function auth.uid() returns uuid language sql stable as $f$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub',
    '11111111-1111-1111-1111-111111111111'
  )::uuid
$f$;

do $d$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $d$;

-- Supabase grants these at the project level; a bare cluster does not.
grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated;
