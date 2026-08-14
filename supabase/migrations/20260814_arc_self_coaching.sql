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
-- Every other refusal stays exactly as it was: unknown, expired, revoked and
-- already-spent codes all still raise the SAME message, so the function is
-- still not an oracle a guesser can use to find a live code.
-- ---------------------------------------------------------------------------
create or replace function public.redeem_coach_invite(p_code text)
returns public.coach_athlete_assignments
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_norm text;
  v_invite public.coach_athlete_invites;
  v_row public.coach_athlete_assignments;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  -- Normalising lives HERE and nowhere else, so a client that trims differently
  -- cannot make a valid code invalid or the reverse.
  v_norm := upper(regexp_replace(coalesce(p_code, ''), '[^a-zA-Z0-9]', '', 'g'));
  if length(v_norm) = 0 then
    raise exception 'invite not found or no longer valid' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_invite from public.coach_athlete_invites
   where code = v_norm
     for update;

  -- ONE message for every rejection — unknown, expired, revoked, spent.
  -- Distinguishing them tells a guesser when they have found a real code.
  if not found
     or v_invite.revoked_at is not null
     or v_invite.accepted_at is not null
     or v_invite.expires_at <= now() then
    raise exception 'invite not found or no longer valid' using errcode = 'invalid_parameter_value';
  end if;

  /*
   * THE SELF-COACHING REFUSAL WAS HERE, and is deliberately gone:
   *
   *   if v_invite.coach_user_id = v_actor then
   *     raise exception 'a coach cannot be their own athlete';
   *   end if;
   *
   * Removed 14 August 2026 with `coach_athlete_distinct`. A person minting a
   * code and redeeming it themselves is consenting to exactly one thing —
   * seeing their own training on their own bench — and every other guard in
   * this function still applies to them unchanged.
   */

  insert into public.organization_memberships (organization_id, user_id, role, status)
  values (v_invite.organization_id, v_actor, 'athlete', 'active')
  on conflict (organization_id, user_id) do update
    set status = 'active'
  where public.organization_memberships.role = 'athlete';

  insert into public.coach_athlete_assignments (organization_id, coach_user_id, athlete_user_id, status)
  values (v_invite.organization_id, v_invite.coach_user_id, v_actor, 'active')
  on conflict (organization_id, coach_user_id, athlete_user_id) do update
    set status = 'active', revoked_at = null
  returning * into v_row;

  update public.coach_athlete_invites
     set accepted_at = now(), accepted_by = v_actor
   where id = v_invite.id;

  return v_row;
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
