-- ============================================================================
-- ARC — an athlete can see who their coach is
--
-- A one-policy migration, and it exists because building the Android side of
-- the coach week found the read was refused.
--
-- DATED THE 14th ON PURPOSE. Migrations apply in filename order, and this one
-- rewrites a policy on `athlete_profiles` — a table created by
-- 20260813_arc_roster_invites_and_names.sql. Named for the 13th it sorted
-- BEFORE that file (`c` < `r`) and failed on a table that did not exist yet.
-- The check caught it; the date is also simply true.
--
-- 20260813_arc_roster_invites_and_names.sql gave everybody a display name they
-- own, and read it out under:
--
--     user_id = auth.uid() or public.coaches_athlete_anywhere(user_id)
--
-- Which is: my own row, or a row belonging to someone I COACH. Both branches
-- point the same way down the relationship. An athlete reading their COACH's
-- row matches neither — `coaches_athlete_anywhere(coach_id)` asks "do I coach
-- my coach", which is false — so the read was refused and the phone had no
-- name to attribute a published week to.
--
-- The asymmetry was not a decision, it was an omission: the coach could see
-- the athlete's chosen name and the athlete could not see the coach's. A
-- published week arriving from "your coach" with no name is worse than
-- impersonal, it is unverifiable — the one thing an athlete should be able to
-- check about a session that appeared in their week is who put it there.
--
-- WHAT THIS DOES NOT DO
--
-- It does not open the table. The new branch is exactly as narrow as the old
-- one and points the other way along the SAME edge: a coach who actively
-- coaches me, in an organisation where we are both active members. No name
-- becomes readable that was not already deliberately published by the person
-- it belongs to, and a coach with no display name stays nameless — absence
-- stays absence, per the rule the original migration set.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The inverse of `coaches_athlete_anywhere`, and deliberately its mirror
-- image rather than a looser query: same joins, same active-membership
-- requirements, same role restriction, with `auth.uid()` moved from the coach
-- side of the relationship to the athlete side.
--
-- SECURITY DEFINER for the same reason the original is: it reads
-- `coach_athlete_assignments` and `organization_memberships`, and a policy
-- that had to be evaluated under the caller's own RLS could not see the rows
-- it needs to answer.
-- ---------------------------------------------------------------------------
create or replace function public.is_my_coach(coach uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.coach_athlete_assignments a
    join public.organization_memberships mc
      on mc.organization_id = a.organization_id
     and mc.user_id = a.coach_user_id
    join public.organization_memberships ma
      on ma.organization_id = a.organization_id
     and ma.user_id = a.athlete_user_id
    where a.athlete_user_id = auth.uid()
      and a.coach_user_id = coach
      and a.status = 'active'
      and mc.status = 'active'
      and mc.role in ('owner', 'coach')
      and ma.status = 'active'
  );
$$;

revoke all on function public.is_my_coach(uuid) from public, anon;
grant execute on function public.is_my_coach(uuid) to authenticated;

comment on function public.is_my_coach(uuid) is
  'True when the named user actively coaches the CALLER. The mirror of '
  'coaches_athlete_anywhere, which answers the same question from the other end.';

-- ---------------------------------------------------------------------------
-- The policy, rewritten whole rather than added to, because a second policy on
-- the same table and command ORs with the first and the combined rule then
-- lives in two places. One policy, three branches, all visible together.
-- ---------------------------------------------------------------------------
drop policy if exists athlete_profiles_read on public.athlete_profiles;
create policy athlete_profiles_read on public.athlete_profiles for select to authenticated
  using (
    user_id = auth.uid()
    or public.coaches_athlete_anywhere(user_id)
    or public.is_my_coach(user_id)
  );

-- ---------------------------------------------------------------------------
-- ROLLBACK
--
--   drop policy if exists athlete_profiles_read on public.athlete_profiles;
--   create policy athlete_profiles_read on public.athlete_profiles for select to authenticated
--     using (user_id = auth.uid() or public.coaches_athlete_anywhere(user_id));
--   drop function if exists public.is_my_coach(uuid);
--
-- Reverting this does not lose data. It returns the athlete to seeing
-- "your coach" without a name, which is what the Android card falls back to
-- when the read returns nothing.
-- ---------------------------------------------------------------------------
