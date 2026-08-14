-- ============================================================================
-- ARC — a coach may be their own athlete
--
-- The owner asked to write their own weeks: to author a week on the bench and
-- have it be their week, rather than assemble it session by session and let
-- the Coordinator arrange it. Every part of that already exists — the builder,
-- `publish_coach_week`, the merge precedence, the phone rendering. The only
-- thing in the way was that they could not get onto their own roster.
--
-- WHAT WAS BLOCKING IT, AND WHY IT WAS RIGHT AT THE TIME
--
-- 20260808_arc_coach_workspace.sql:
--
--     constraint coach_athlete_distinct check (coach_user_id <> athlete_user_id)
--
-- with a comment worth quoting, because it names the real cost of this
-- migration rather than a style preference: "A coach is not their own client.
-- This is not pedantry: without it, the bench's 'own data' mode and its
-- 'client' mode become the same query and the truth boundary the handoff
-- protects disappears."
--
-- That boundary is real. `listClients` returns `[...ENGINE_LOCAL, ...roster]`,
-- so a self-assignment makes the signed-in user appear TWICE — once as
-- `engine-local`, read from local stores and offline, and once as
-- `roster-summary`, read from the server. Two entries, one person, two
-- different answers, and no way for the coach to tell which they picked.
--
-- THAT IS AN APPLICATION PROBLEM, AND IT IS SOLVED IN THE APPLICATION.
-- `listClients` now folds a self-row into the engine-local entry instead of
-- appending a second one. The constraint was enforcing a UI invariant from the
-- database, which is the wrong layer for it — the database's job here is to say
-- who may read whose training, and "you may read your own" was never in doubt.
--
-- WHAT THIS DOES NOT RELAX
--
-- Nothing about anyone else's data. `coaches_athlete` still requires an active
-- assignment AND an active coach-side membership AND an active athlete-side
-- membership, all unchanged. A self-assignment authorises exactly one new
-- thing: reading and publishing to YOURSELF, which you could already do by
-- every other route in the system.
--
-- The invite flow is still the only way a row appears. Self-coaching is not
-- automatic and no row is created for anybody by this migration — the owner
-- mints a code and redeems it, deliberately, the same as any other athlete.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The table constraint.
-- ---------------------------------------------------------------------------
alter table public.coach_athlete_assignments
  drop constraint if exists coach_athlete_distinct;

comment on table public.coach_athlete_assignments is
  'Who coaches whom. A coach MAY be their own athlete (14 August 2026) — the '
  'row is still created only by redeeming an invite, and it authorises nothing '
  'beyond what that person could already see about themselves. The '
  'coach_athlete_distinct constraint that forbade it was enforcing a UI '
  'invariant from the database; listClients folds a self-row into the '
  'engine-local entry instead.';

-- ---------------------------------------------------------------------------
-- 2. The command's own guard.
--
-- Reproduced whole because Postgres cannot patch a function body. This is
-- 20260813's `redeem_coach_invite` with ONE branch removed — the
-- `coach_user_id = v_actor` refusal — and nothing else touched. Diff it
-- against that file if you are checking.
--
-- THAT SENTENCE WAS A LIE THE FIRST TIME IT WAS WRITTEN, and the way it was
-- false is worth recording rather than quietly correcting. The first version
-- of this file was retyped from memory instead of copied, and the retyping
-- dropped `revoked_at = null` from the membership upsert. The target table
-- carries
--
--     check ((status = 'revoked') = (revoked_at is not null))
--
-- so setting `status = 'active'` while leaving a stamped `revoked_at` violates
-- it and aborts the WHOLE redemption. An athlete who had ever been revoked
-- could never rejoin — and no check caught it, because every redeem check
-- uses an athlete who is either new or has never been revoked. The same
-- retyping also weakened the code-shape gate from `^[0-9A-F]{32}$` to
-- "length > 0" and deleted three comments explaining load-bearing lines.
--
-- The body below is now a genuine copy. If you change it, COPY it.
--
-- Every other refusal stays exactly as it was: unknown, expired, revoked and
-- already-spent codes all still raise the SAME message, so the function is
-- still not an oracle a guesser can use to find a live code.
-- ---------------------------------------------------------------------------
create or replace function public.redeem_coach_invite(p_code text)
returns public.coach_athlete_assignments
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_code text;
  v_invite public.coach_athlete_invites;
  v_assignment public.coach_athlete_assignments;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  -- People retype codes with spaces and dashes in them. Normalising here is
  -- kindness, not laxity — the comparison below is still exact.
  v_code := upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Fa-f]', '', 'g'));
  if v_code !~ '^[0-9A-F]{32}$' then
    raise exception 'invite not found or no longer valid' using errcode = 'invalid_parameter_value';
  end if;

  -- FOR UPDATE, so two simultaneous redeems of one code serialise and the
  -- second finds `accepted_at` already stamped. Without the lock both would
  -- read it open and both would write.
  select * into v_invite from public.coach_athlete_invites
   where code = v_code
   for update;

  -- ONE message for every rejection — unknown, expired, revoked, already
  -- spent. Distinguishing them turns this function into an oracle that tells
  -- a guesser when they have found a real code.
  if v_invite.id is null
     or v_invite.revoked_at is not null
     or v_invite.accepted_at is not null
     or v_invite.expires_at <= now() then
    raise exception 'invite not found or no longer valid' using errcode = 'invalid_parameter_value';
  end if;

  /*
   * THE SELF-COACHING REFUSAL WAS HERE, and is deliberately gone:
   *
   *   -- `coach_athlete_distinct` on the target table would raise anyway; saying so
   *   -- plainly is better than a constraint name in the coach's face.
   *   if v_invite.coach_user_id = v_actor then
   *     raise exception 'a coach cannot be their own athlete' using errcode = 'invalid_parameter_value';
   *   end if;
   *
   * Removed 14 August 2026 with `coach_athlete_distinct`. A person minting a
   * code and redeeming it themselves is consenting to exactly one thing —
   * seeing their own training on their own bench — and every other guard in
   * this function still applies to them unchanged.
   */

  -- Membership first: `coaches_athlete` requires an ACTIVE athlete-side
  -- membership, so an assignment written without one would be a roster row
  -- that authorises nothing — the coach would see the athlete in no query at
  -- all and have no way to tell why.
  --
  -- The `where` on DO UPDATE is load-bearing: it reactivates a lapsed athlete
  -- membership (they are consenting again, right now) but leaves an existing
  -- owner/coach/support membership exactly as it is. Redeeming an invite must
  -- not be able to demote a colleague to 'athlete'.
  --
  -- `revoked_at = null` is load-bearing too, and for a reason the column name
  -- does not advertise: `organization_membership_revoked_at` asserts that the
  -- stamp and the status agree, so clearing the status without clearing the
  -- stamp is not untidy, it is a constraint violation that aborts the redeem.
  insert into public.organization_memberships (organization_id, user_id, role, status)
  values (v_invite.organization_id, v_actor, 'athlete', 'active')
  on conflict (organization_id, user_id) do update
    set status = 'active', revoked_at = null
    where organization_memberships.role = 'athlete';

  insert into public.coach_athlete_assignments (organization_id, coach_user_id, athlete_user_id, status)
  values (v_invite.organization_id, v_invite.coach_user_id, v_actor, 'active')
  on conflict (organization_id, coach_user_id, athlete_user_id) do update
    set status = 'active', revoked_at = null
  returning * into v_assignment;

  update public.coach_athlete_invites
     set accepted_at = now(), accepted_by = v_actor
   where id = v_invite.id;

  return v_assignment;
end;
$$;

revoke all on function public.redeem_coach_invite(text) from public, anon;
grant execute on function public.redeem_coach_invite(text) to authenticated;

-- ---------------------------------------------------------------------------
-- ROLLBACK
--
-- Re-adding the constraint FAILS while any self-assignment exists, which is
-- correct — it refuses rather than silently unlinking someone from their own
-- roster. Clear those rows first, deliberately.
--
--   -- delete from public.coach_athlete_assignments where coach_user_id = athlete_user_id;
--   alter table public.coach_athlete_assignments
--     add constraint coach_athlete_distinct check (coach_user_id <> athlete_user_id);
--   -- and re-apply 20260813's redeem_coach_invite verbatim, guard included.
-- ---------------------------------------------------------------------------
