-- ---------------------------------------------------------------------------
-- ARC coach workspace — closes the still-open half of the erasure gap
-- recorded in docs/RISK_REGISTER.md: `coach_decisions.actor_user_id` was
-- `not null ... on delete restrict`, which blocks deleting a COACH's
-- `auth.users` row outright. An erasure request for a coach could never be
-- satisfied while a single `coach_decisions` row referenced them.
--
-- DECIDED: anonymise the actor, never transfer it. The decision row and its
-- receipt belong to the ATHLETE's history — the athlete needs to keep
-- knowing WHAT happened and WHEN, not WHO, once that identity is erased.
-- Reassigning `actor_user_id` to some other identity (an org owner, a
-- system account) would misattribute a real action to someone who did not
-- take it — worse for the audit trail than a null, which openly says "the
-- actor's account no longer exists" rather than quietly lying about it.
--
-- WIDENING THE COLUMN IS NOT ENOUGH ON ITS OWN. `on delete set null`
-- performs the nulling as an UPDATE, and `coach_decisions_immutable`'s
-- trigger function (`deny_mutation()`, in 20260808_arc_coach_workspace.sql)
-- refuses every UPDATE unconditionally — its only escape hatch is for
-- DELETE on an already-orphaned row. Without also handling the trigger, the
-- FK's own cascade would fire straight into `deny_mutation()` and be
-- rejected, and coach erasure would still be blocked — just by a different
-- error, from a different layer, which is a worse failure to debug than the
-- one being fixed. `deny_mutation()` itself is shared by several other
-- tables (`decision_receipts`, `assignment_input_versions`,
-- `program_template_versions`) and is left completely untouched — only
-- `coach_decisions` gets a narrower trigger function, and it permits EXACTLY
-- one shape of update: `actor_user_id` moving from some value to null, with
-- every OTHER column byte-for-byte unchanged. A hand-crafted UPDATE that
-- also touched `kind`/`payload`/`idempotency_key` (or anything else) is
-- still refused, by the same `restrict_violation` error as before.
-- ---------------------------------------------------------------------------

alter table public.coach_decisions alter column actor_user_id drop not null;

-- The FK this table was created with is unnamed, so Postgres gave it its
-- standard default name (`<table>_<column>_fkey`) — dropped by that name and
-- re-added with the new ON DELETE action. Applying this to a fresh cluster
-- (this migration has never touched a real Supabase project) makes the
-- `if exists` a formality, not a hedge against a guess.
alter table public.coach_decisions drop constraint if exists coach_decisions_actor_user_id_fkey;
alter table public.coach_decisions add constraint coach_decisions_actor_user_id_fkey
  foreign key (actor_user_id) references auth.users(id) on delete set null;

create or replace function public.deny_coach_decision_mutation()
returns trigger language plpgsql as $$
begin
  -- The one permitted UPDATE: actor erasure, and nothing else about the row
  -- moved. A schema-generic diff, not a hand-enumerated column list --
  -- an adversarial review of the first draft (which listed all 10 other
  -- columns by name) caught that a hardcoded allowlist is a latent trap:
  -- unlike deny_mutation() itself (which refuses every UPDATE
  -- unconditionally and so needs no such list), a per-column enumeration's
  -- safety depends on staying exhaustive, and nothing ties it to the live
  -- schema. The next `alter table coach_decisions add column ...` would
  -- have silently exempted the new column from immutability instead of
  -- failing closed. `to_jsonb(...) - 'actor_user_id'` compares every OTHER
  -- column at once, automatically, including `id` (so this also implicitly
  -- enforces "still the same row") and any column added after this
  -- migration ships.
  if tg_op = 'UPDATE'
    and new.actor_user_id is null
    and old.actor_user_id is not null
    and (to_jsonb(new) - 'actor_user_id') = (to_jsonb(old) - 'actor_user_id')
  then
    return new;
  end if;

  -- The same orphaned-row DELETE escape hatch `deny_mutation()` gives every
  -- other immutable table, narrowed to the two parent references this table
  -- actually has (no template_id/assignment_id/decision_id column here) --
  -- confirmed functionally identical to deny_mutation()'s own check for
  -- THIS table, since its other three not-exists branches key off columns
  -- coach_decisions doesn't have and are already no-ops here. Accepted as a
  -- duplication, not extracted into a shared helper: a future correction to
  -- deny_mutation()'s orphan logic would need a matching edit here too,
  -- nothing enforces that, and that risk is judged cheaper to accept than
  -- editing 20260808_arc_coach_workspace.sql's already-shipped function to
  -- route through a new shared helper it was never written to call.
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.organizations o where o.id = old.organization_id)
       or not exists (select 1 from auth.users u where u.id = old.athlete_user_id)
    then
      return old;
    end if;
  end if;

  raise exception 'immutable record: % rows cannot be updated or deleted', tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

revoke all on function public.deny_coach_decision_mutation() from public, anon, authenticated;

drop trigger if exists coach_decisions_immutable on public.coach_decisions;
create trigger coach_decisions_immutable
  before update or delete on public.coach_decisions
  for each row execute function public.deny_coach_decision_mutation();

-- Rollback, for the staging rehearsal this repository requires before any
-- release. Order matters: dependants first. This is not expressible as a
-- clean "undo" past a real coach erasure — a `deny_mutation()`-only rollback
-- would once again refuse to delete an already-erased coach's `auth.users`
-- row if one somehow still existed, so restoring `not null`/`on delete
-- restrict` is only safe on a cluster where no coach has actually been
-- erased since this migration applied.
--
--   drop trigger if exists coach_decisions_immutable on public.coach_decisions;
--   create trigger coach_decisions_immutable
--     before update or delete on public.coach_decisions
--     for each row execute function public.deny_mutation();
--   drop function if exists public.deny_coach_decision_mutation();
--   alter table public.coach_decisions drop constraint if exists coach_decisions_actor_user_id_fkey;
--   alter table public.coach_decisions add constraint coach_decisions_actor_user_id_fkey
--     foreign key (actor_user_id) references auth.users(id) on delete restrict;
--   alter table public.coach_decisions alter column actor_user_id set not null;
