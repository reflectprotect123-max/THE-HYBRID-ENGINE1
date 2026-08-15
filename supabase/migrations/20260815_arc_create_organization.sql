-- ============================================================================
-- ARC — an organisation can be CREATED
--
-- THE CHICKEN WITH NO EGG. `public.organizations` has carried a SELECT policy
-- since 20260808 and no INSERT policy for anybody, no RPC, no seed row and no
-- UI. Every coach table hangs off `organization_id`:
--
--   coach_athlete_invites, coach_athlete_assignments, coach_week_plans,
--   coach_workout_drafts, program_templates, program_assignments,
--   progression_proposal_snapshots, athlete_trend_snapshots, coach_decisions
--
-- so with no org there is no roster, no invite, no published week — nothing.
-- `redeem_coach_invite` inserts a MEMBERSHIP into an organisation that must
-- already exist, and `create_coach_invite` requires the caller to already be
-- its owner or coach. Neither can bootstrap the first row.
--
-- The bench says so plainly on Settings: "You are not an owner or coach of any
-- organisation, so there is nothing to invite an athlete into." That message
-- was accurate and had no cure. This is the cure.
--
-- WHY AN RPC RATHER THAN AN INSERT POLICY.
--
-- An organisation and its owner membership are ONE fact. A policy allowing
-- `insert into organizations` would let a client create an org and then fail,
-- crash or simply stop before writing the membership — leaving a row that
-- satisfies every constraint, belongs to nobody, and can never be reached
-- again because every read path goes through `organization_memberships`. An
-- orphan org is invisible garbage that only accumulates.
--
-- Doing both in one security-definer function makes that impossible: the pair
-- commits together or not at all.
--
-- WHAT IT DELIBERATELY DOES NOT DO.
--
--   * It does not take an owner id. The caller becomes the owner, full stop.
--     Accepting a user id here would let anyone mint an organisation owned by
--     someone else, and `auth.uid()` is the only identity this function can
--     actually verify.
--   * It does not put the creator on their own roster. That is
--     `redeem_coach_invite`'s job via 20260814_arc_self_coaching, and keeping
--     it separate means consent still passes through the same single door —
--     an athlete assignment is only ever created by the athlete redeeming.
--   * It does not limit how many organisations one person may own. A cap is a
--     product decision and this is plumbing; if one is ever wanted it belongs
--     in a policy above this, not buried in a bootstrap.
-- ============================================================================

create or replace function public.create_organization(p_name text)
returns public.organizations
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_org public.organizations;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  -- Trimmed and checked HERE as well as by `organizations_name_present`. The
  -- constraint would reject '   ' with a constraint-violation error that reads
  -- as a bug to anyone watching the network tab; this rejects it with a
  -- sentence about the input.
  if length(v_name) = 0 then
    raise exception 'an organisation needs a name' using errcode = 'invalid_parameter_value';
  end if;
  if length(v_name) > 120 then
    raise exception 'that name is too long' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.organizations (name, created_by)
  values (v_name, v_actor)
  returning * into v_org;

  -- The other half of the same fact. `revoked_at` is left null and the status
  -- is 'active', which `organization_membership_revoked_at` requires to agree
  -- — the same constraint that broke `redeem_coach_invite` when its upsert was
  -- once retyped from memory.
  insert into public.organization_memberships (organization_id, user_id, role, status)
  values (v_org.id, v_actor, 'owner', 'active');

  return v_org;
end;
$$;

revoke all on function public.create_organization(text) from public, anon;
grant execute on function public.create_organization(text) to authenticated;

comment on function public.create_organization(text) is
  'Create an organisation owned by the CALLER, with their owner membership, in '
  'one transaction. The only way an organisation comes into existence: '
  'public.organizations has no INSERT policy for any role, deliberately, so an '
  'org can never exist without an owner.';

-- ---------------------------------------------------------------------------
-- ROLLBACK
--
--   drop function if exists public.create_organization(text);
--
-- Organisations already created STAY. Dropping the ability to create one must
-- not delete the rosters, invites and published weeks hanging off the ones
-- that exist — and with no INSERT policy on the table, dropping this function
-- restores exactly the previous state: nothing can make a new one.
-- ---------------------------------------------------------------------------
