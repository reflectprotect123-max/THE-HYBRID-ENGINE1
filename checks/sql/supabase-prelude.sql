create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
insert into auth.users values ('11111111-1111-1111-1111-111111111111') on conflict do nothing;
create or replace function auth.uid() returns uuid language sql stable as $f$ select '11111111-1111-1111-1111-111111111111'::uuid $f$;
do $d$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $d$;
