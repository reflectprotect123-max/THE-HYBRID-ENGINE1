-- ============================================================================
-- ARC — how an athlete GETS onto a roster, and how they get a name
--
-- Two gaps, one migration, one principle holding both together.
--
-- GAP 1: THERE WAS NO WAY TO ADD AN ATHLETE AT ALL.
--
-- 20260808_arc_coach_workspace.sql creates `coach_athlete_assignments` — the
-- row without which a coach sees nothing — and grants `authenticated` SELECT
-- and nothing else. That is deliberate and stays: no client role holds INSERT
-- on any coach table, because a direct table write would be trusting a
-- client-supplied organisation id. But no SECURITY DEFINER command was ever
-- written for this table either, so the only way a roster row has ever come
-- into existence is somebody typing SQL. A coach could not add an athlete.
--
-- THE CONSENT MODEL: A CODE THE COACH OFFERS AND THE ATHLETE REDEEMS.
--
-- The obvious shape — `add_athlete_to_roster(p_athlete_user_id)` — is the one
-- shape this must not have. It would let anyone holding a coach membership
-- attach themselves to a stranger's account by id and immediately begin
-- reading that person's training summaries, safety flags and, with the
-- existing grant tables, their raw nutrition and readiness. A user id is not
-- a secret; it appears in every row the system writes.
--
-- So the link is made in two halves, by two different people:
--
--   * `create_coach_invite` mints an opaque, expiring, revocable code owned by
--     the CALLING coach and their organisation. It names no athlete, links
--     nobody, and grants no read of anything. A coach who creates a thousand
--     of them has a roster of zero.
--   * `redeem_coach_invite` is called by the ATHLETE, from their own session,
--     with a code they were given out of band. That call — and only that call
--     — writes the `coach_athlete_assignments` row, and it writes it with the
--     athlete's own `auth.uid()` in `athlete_user_id`. The coach cannot
--     supply it, guess it, or move it.
--
-- The athlete's action is therefore what makes the link active, which is the
-- requirement. It also means the code is the ONLY secret in the flow, and it
-- is treated as one: 128 bits from `gen_random_bytes`, unique, expiring
-- (14 days by default), revocable by its creator, readable only by the coach
-- who minted it and the athlete who redeemed it, and single-use — the
-- `accepted_at` stamp is taken under a row lock so two simultaneous redeems
-- cannot both win.
--
-- WHY NO coach_decisions/decision_receipts ROW IS WRITTEN HERE.
--
-- Every other command in this schema pairs its write with a decision and a
-- receipt, because those record something a COACH did TO an athlete and the
-- athlete is owed an account of it. Joining a roster is not that: the athlete
-- is the actor, and the invite row already carries the whole audit — who
-- minted it, when, when it expired, who accepted it and when. Minting a
-- decision whose `actor_user_id` is the athlete would put the athlete's own
-- consent in the ledger of things done to them.
--
-- GAP 2: ROSTER ATHLETES HAD NO NAMES.
--
-- `listClients()` rendered `Athlete 3f2a1b9c` off the uuid, because no profile
-- table was readable across athletes. `athlete_profiles` is the minimum that
-- fixes it honestly:
--
--   * the athlete owns it. `set_athlete_display_name` derives the row from
--     `auth.uid()`; there is no parameter for whose name is being set, and
--     passing null DELETES the row, so the withdrawal is as available as the
--     grant.
--   * a coach reads it only through the established relationship — the same
--     active-assignment-plus-both-memberships test every other read uses,
--     via `coaches_athlete_anywhere`.
--   * ABSENCE STAYS ABSENCE. Nothing here backfills a name from an email
--     address or a uuid. No row means no name, and the client keeps printing
--     the id-shaped placeholder, which reads as missing data rather than as a
--     person who does not exist.
--
-- WHAT IS DELIBERATELY NOT HERE: an athlete-facing UI for `redeem_coach_invite`
-- or `set_athlete_display_name`. The athlete web app is parked (CLAUDE.md,
-- 13 August 2026) and the athlete product is the Android app, which is out of
-- scope for the change that added this file. Both functions are the athlete's
-- half of the contract and are callable today; the screen that calls them is
-- somebody else's commit.
-- ============================================================================

-- `gen_random_bytes` lives here. 20260807_macrotrack_food_catalogue.sql already
-- creates it and this is idempotent; stating it makes the dependency local
-- rather than a migration-ordering assumption.
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. The invite.
--
-- Timestamps are the source of truth for state; there is no `status` column,
-- for the reason 20260808 gives twice already — a status and a timestamp that
-- can disagree will eventually disagree, and the audit trail loses. Status is
-- DERIVED (open / accepted / revoked / expired) by whoever reads it.
-- ---------------------------------------------------------------------------

create table if not exists public.coach_athlete_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  coach_user_id uuid not null references auth.users(id) on delete cascade,
  -- Stored in the clear, not hashed, and that is a decision rather than an
  -- oversight: the coach has to be able to re-read the code to send it to the
  -- athlete, which a hash makes impossible. What bounds the exposure instead
  -- is everything else about the column — it is high-entropy, short-lived,
  -- single-use, revocable, and readable by exactly two accounts.
  code text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  constraint coach_invite_code_shape check (code ~ '^[0-9A-F]{32}$'),
  constraint coach_invite_expiry check (expires_at > created_at),
  -- Half an acceptance is not a state this table has. A stamp without an
  -- account, or an account without a stamp, would read as redeemed to one
  -- query and open to another.
  constraint coach_invite_accepted_pair check ((accepted_at is null) = (accepted_by is null))
);

create index if not exists coach_athlete_invites_coach_idx
  on public.coach_athlete_invites (coach_user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. The athlete's own display name.
--
-- One column of content. Not a profile system: no avatar, no email, no date of
-- birth, nothing a coach did not need in order to stop calling this person a
-- hexadecimal fragment. Widening it is a product decision with its own
-- consent question, not a convenience.
-- ---------------------------------------------------------------------------

create table if not exists public.athlete_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  updated_at timestamptz not null default now(),
  constraint athlete_profile_display_name_present
    check (length(btrim(display_name)) between 1 and 80)
);

-- ---------------------------------------------------------------------------
-- 3. `coaches_athlete_anywhere` — `coaches_athlete` without the organisation.
--
-- Every existing read is tenant-scoped because every existing read is about
-- training data, which belongs to an organisation. A display name does not:
-- `athlete_profiles` is keyed on the user alone, so the question a policy on
-- it has to ask is "does the caller coach this person AT ALL", in any
-- organisation. Same three-row test as `coaches_athlete` — the assignment is
-- active, the coach's membership is active and privileged, and the ATHLETE's
-- membership is active — with the organisation filter dropped and nothing
-- else relaxed. An athlete who leaves the organisation takes their name back
-- with everything else.
-- ---------------------------------------------------------------------------

create or replace function public.coaches_athlete_anywhere(athlete uuid)
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
    where a.coach_user_id = auth.uid()
      and a.athlete_user_id = athlete
      and a.status = 'active'
      and mc.status = 'active'
      and mc.role in ('owner', 'coach')
      and ma.status = 'active'
  );
$$;

revoke all on function public.coaches_athlete_anywhere(uuid) from public, anon;
grant execute on function public.coaches_athlete_anywhere(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Row level security. Reads only, as everywhere else in this schema.
-- ---------------------------------------------------------------------------

alter table public.coach_athlete_invites enable row level security;
alter table public.athlete_profiles enable row level security;

-- `force row level security` is absent here for the same reason it is absent
-- from every table in 20260808: the owner exemption IS the write path, and
-- every write below is a SECURITY DEFINER command that does its own checks.

-- The coach who minted it, the athlete who redeemed it, and the organisation
-- owner. Nobody else, and in particular NOT "any coach in the organisation" —
-- the code is a bearer secret, and a colleague who can read it can spend it.
drop policy if exists coach_athlete_invites_read on public.coach_athlete_invites;
create policy coach_athlete_invites_read on public.coach_athlete_invites for select to authenticated
  using (
    coach_user_id = auth.uid()
    or accepted_by = auth.uid()
    or public.is_org_member(organization_id, array['owner'])
  );

-- Self, or a coach who currently coaches this athlete. No `owner` branch: an
-- owner who does not coach this person has no relationship to read the name
-- through, and "owns the organisation" is not the consent the athlete gave.
drop policy if exists athlete_profiles_read on public.athlete_profiles;
create policy athlete_profiles_read on public.athlete_profiles for select to authenticated
  using (
    user_id = auth.uid()
    or public.coaches_athlete_anywhere(user_id)
  );

revoke all on public.coach_athlete_invites from anon;
revoke all on public.athlete_profiles from anon;

grant select on public.coach_athlete_invites to authenticated;
grant select on public.athlete_profiles to authenticated;

-- AND EXPLICITLY TAKE THE WRITES BACK, WHICH THE EARLIER MIGRATIONS DO NOT.
--
-- Supabase grants `select, insert, update, delete` on tables in `public` to
-- `anon`/`authenticated` by DEFAULT PRIVILEGE, so a table created here arrives
-- already writable and a later `grant select` does not narrow that — grants
-- are additive. What has been standing in for these two lines everywhere else
-- is RLS with no write policy, and for INSERT that really is a refusal.
--
-- For UPDATE and DELETE it is not. RLS FILTERS: with no policy the statement
-- matches zero rows and SUCCEEDS, affecting nothing. The outcome is still
-- fail-closed — no row changes — but the caller is told it worked, and a
-- probe that asserts "this was refused" passes for the wrong reason or fails
-- for a confusing one. Saying it in privileges makes the refusal real, and
-- costs nothing: every write here goes through a SECURITY DEFINER command
-- that runs as the owner.
revoke insert, update, delete on public.coach_athlete_invites from authenticated;
revoke insert, update, delete on public.athlete_profiles from authenticated;

-- ---------------------------------------------------------------------------
-- 5. `create_coach_invite` — the coach's half. Links nobody.
-- ---------------------------------------------------------------------------

create or replace function public.create_coach_invite(
  p_organization_id uuid,
  p_expires_in_days integer default 14
)
returns public.coach_athlete_invites
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_row public.coach_athlete_invites;
  v_open integer;
  v_attempt integer := 0;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  -- Only an owner or a coach of THIS organisation. An athlete member cannot
  -- mint invites into an organisation they merely belong to.
  if not public.is_org_member(p_organization_id, array['owner', 'coach']) then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;
  if p_expires_in_days is null or p_expires_in_days < 1 or p_expires_in_days > 30 then
    raise exception 'invalid expiry' using errcode = 'invalid_parameter_value';
  end if;

  -- A cap on live codes. Not rate limiting — it is a bound on how many valid
  -- bearer secrets one coach can have in the world at once, which is the
  -- quantity that matters if any of them leaks.
  select count(*) into v_open
    from public.coach_athlete_invites
   where coach_user_id = v_actor
     and organization_id = p_organization_id
     and accepted_at is null
     and revoked_at is null
     and expires_at > now();
  if v_open >= 25 then
    raise exception 'too many open invites' using errcode = 'invalid_parameter_value';
  end if;

  -- 128 bits, hex. The retry exists because `code` is unique and a collision,
  -- while absurd, is a constraint violation rather than a silent duplicate;
  -- three attempts and then an honest failure beats a loop that cannot end.
  loop
    v_attempt := v_attempt + 1;
    begin
      insert into public.coach_athlete_invites (organization_id, coach_user_id, code, expires_at)
      values (
        p_organization_id,
        v_actor,
        upper(encode(gen_random_bytes(16), 'hex')),
        now() + make_interval(days => p_expires_in_days)
      )
      returning * into v_row;
      return v_row;
    exception when unique_violation then
      if v_attempt >= 3 then
        raise exception 'could not mint an invite code' using errcode = 'internal_error';
      end if;
    end;
  end loop;
end;
$$;

revoke all on function public.create_coach_invite(uuid, integer) from public, anon;
grant execute on function public.create_coach_invite(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. `revoke_coach_invite` — kill a code that has escaped.
--
-- It does NOT unlink an athlete who already redeemed it. Revoking a spent
-- code and ending a coaching relationship are different acts with different
-- consent stories, and collapsing them would let a coach's cleanup silently
-- cut an athlete off — or, read the other way, make an athlete believe their
-- link was severed when it was not. Ending a relationship is
-- `coach_athlete_assignments.status = 'revoked'`, which is not this function.
-- ---------------------------------------------------------------------------

create or replace function public.revoke_coach_invite(p_invite_id uuid)
returns public.coach_athlete_invites
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_row public.coach_athlete_invites;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  select * into v_row from public.coach_athlete_invites
   where id = p_invite_id
   for update;
  -- Same message for "no such invite" and "not yours", so this cannot be used
  -- to confirm an id exists.
  if v_row.id is null
     or (v_row.coach_user_id <> v_actor
         and not public.is_org_member(v_row.organization_id, array['owner'])) then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  if v_row.accepted_at is not null then
    raise exception 'invite already redeemed' using errcode = 'invalid_parameter_value';
  end if;

  update public.coach_athlete_invites
     set revoked_at = coalesce(revoked_at, now())
   where id = p_invite_id
   returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.revoke_coach_invite(uuid) from public, anon;
grant execute on function public.revoke_coach_invite(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. `redeem_coach_invite` — the ATHLETE's half. This is the call that
-- creates the roster row, and the only one that can.
--
-- `athlete_user_id` comes from `auth.uid()`. There is no parameter for it and
-- there must never be one: the whole consent model is that the person joining
-- the roster is the person making the call.
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

  -- `coach_athlete_distinct` on the target table would raise anyway; saying so
  -- plainly is better than a constraint name in the coach's face.
  if v_invite.coach_user_id = v_actor then
    raise exception 'a coach cannot be their own athlete' using errcode = 'invalid_parameter_value';
  end if;

  -- Membership first: `coaches_athlete` requires an ACTIVE athlete-side
  -- membership, so an assignment written without one would be a roster row
  -- that authorises nothing — the coach would see the athlete in no query at
  -- all and have no way to tell why.
  --
  -- The `where` on DO UPDATE is load-bearing: it reactivates a lapsed athlete
  -- membership (they are consenting again, right now) but leaves an existing
  -- owner/coach/support membership exactly as it is. Redeeming an invite must
  -- not be able to demote a colleague to 'athlete'.
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
-- 8. `set_athlete_display_name` — the athlete's name, set by the athlete.
--
-- Null or blank DELETES the row and returns no record. That is the withdrawal
-- half of the consent, and it has to be as easy as the grant: an athlete who
-- can publish a name to their coach and cannot unpublish it did not really
-- own it.
-- ---------------------------------------------------------------------------

create or replace function public.set_athlete_display_name(p_display_name text)
returns public.athlete_profiles
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_name text;
  v_row public.athlete_profiles;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  v_name := btrim(coalesce(p_display_name, ''));
  if v_name = '' then
    delete from public.athlete_profiles where user_id = v_actor;
    return null;
  end if;
  if length(v_name) > 80 then
    raise exception 'display name too long' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.athlete_profiles (user_id, display_name, updated_at)
  values (v_actor, v_name, now())
  on conflict (user_id) do update
    set display_name = excluded.display_name, updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.set_athlete_display_name(text) from public, anon;
grant execute on function public.set_athlete_display_name(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Rollback, for the staging rehearsal this repository requires before any
-- release. Order matters: functions first, then the tables they touch.
--
-- Note what rolling this back DOES NOT undo: roster rows and athlete
-- memberships written by `redeem_coach_invite` stay, because they live in
-- 20260808's tables and are indistinguishable from rows made by hand. That is
-- correct — an athlete who consented is still coached — but it means this
-- rollback removes the PATH, not its results.
--
--   drop function if exists public.set_athlete_display_name(text);
--   drop function if exists public.redeem_coach_invite(text);
--   drop function if exists public.revoke_coach_invite(uuid);
--   drop function if exists public.create_coach_invite(uuid, integer);
--   drop policy if exists athlete_profiles_read on public.athlete_profiles;
--   drop policy if exists coach_athlete_invites_read on public.coach_athlete_invites;
--   drop table if exists public.athlete_profiles;
--   drop table if exists public.coach_athlete_invites;
--   drop function if exists public.coaches_athlete_anywhere(uuid);
--   -- pgcrypto is left in place; other migrations rely on it.
-- ============================================================================
