-- ---------------------------------------------------------------------------
-- ARC coach workspace — the rest of the coach-erasure gap.
--
-- docs/RISK_REGISTER.md's ARC section named this explicitly when
-- 20260808_arc_erasure_actor.sql shipped: fixing `coach_decisions.actor_user_id`
-- only closed ONE of six `on delete restrict` columns referencing a coach's
-- `auth.users` row. A coach who ever created an organisation, a shared
-- template, a template version, a training block, an assignment, or an
-- assignment's input snapshot was STILL unerasable — deleting their account
-- would be refused by whichever of these five columns it hit first.
--
-- SAME DECISION AS THE ACTOR FIX, applied uniformly: anonymise, never
-- transfer. Every one of these rows belongs to the ORGANISATION's or
-- ATHLETE's history, not the coach's — an organisation needs to keep
-- existing, a template needs to keep being assignable, an assignment needs
-- to keep describing what was actually intended, once the coach who
-- created them is gone. Reassigning creation to a different coach would
-- misattribute it; a null openly says "the creator's account no longer
-- exists."
--
-- TWO OF THESE SIX COLUMNS SIT BEHIND AN IMMUTABILITY TRIGGER
-- (program_template_versions.published_by, assignment_input_versions.created_by
-- — both `before update or delete ... execute function deny_mutation()`),
-- exactly the same shape `coach_decisions.actor_user_id` was in: widening
-- the column is not enough on its own, because `deny_mutation()` refuses
-- every UPDATE unconditionally, including the FK's own SET NULL cascade.
-- Both get the SAME narrow, schema-generic escape-hatch treatment as
-- `deny_coach_decision_mutation()` — permitting EXACTLY one UPDATE shape
-- (their own actor column moving to null, every other column unchanged),
-- via `to_jsonb(new) - '<col>' = to_jsonb(old) - '<col>'`. Two dedicated
-- functions, not a shared parameterised one: each table's DELETE-branch
-- orphan check keys off a DIFFERENT parent column
-- (program_template_versions has no organization_id/athlete_user_id of its
-- own, only template_id; assignment_input_versions only has assignment_id),
-- and a single function juggling both via `TG_ARGV` would be a novel
-- mechanism this codebase doesn't otherwise use, for a saving of about
-- twenty lines — not worth it for exactly two call sites. `deny_mutation()`
-- itself, and `decision_receipts`/`program_template_versions`'s and
-- `assignment_input_versions`'s use of it for the DELETE-only orphan case,
-- are otherwise completely untouched.
--
-- THE OTHER FOUR COLUMNS (organizations.created_by,
-- program_templates.created_by, training_block_templates.created_by,
-- program_assignments.created_by) sit under NO immutability trigger at
-- all — nothing today blocks a generic UPDATE on those four tables — so
-- for those, widening the column and changing the FK action is the whole
-- fix.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The four untriggered columns — column + FK only.
-- ---------------------------------------------------------------------------

alter table public.organizations alter column created_by drop not null;
alter table public.organizations drop constraint if exists organizations_created_by_fkey;
alter table public.organizations add constraint organizations_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

alter table public.program_templates alter column created_by drop not null;
alter table public.program_templates drop constraint if exists program_templates_created_by_fkey;
alter table public.program_templates add constraint program_templates_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

alter table public.training_block_templates alter column created_by drop not null;
alter table public.training_block_templates drop constraint if exists training_block_templates_created_by_fkey;
alter table public.training_block_templates add constraint training_block_templates_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

alter table public.program_assignments alter column created_by drop not null;
alter table public.program_assignments drop constraint if exists program_assignments_created_by_fkey;
alter table public.program_assignments add constraint program_assignments_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 2. program_template_versions.published_by — triggered, gets its own
-- narrow escape-hatch function. Orphan check keys off template_id, the
-- only parent reference this table has.
-- ---------------------------------------------------------------------------

alter table public.program_template_versions alter column published_by drop not null;
alter table public.program_template_versions drop constraint if exists program_template_versions_published_by_fkey;
alter table public.program_template_versions add constraint program_template_versions_published_by_fkey
  foreign key (published_by) references auth.users(id) on delete set null;

create or replace function public.deny_template_version_mutation()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE'
    and new.published_by is null
    and old.published_by is not null
    and (to_jsonb(new) - 'published_by') = (to_jsonb(old) - 'published_by')
  then
    return new;
  end if;

  if tg_op = 'DELETE' then
    if not exists (select 1 from public.program_templates t where t.id = old.template_id) then
      return old;
    end if;
  end if;

  raise exception 'immutable record: % rows cannot be updated or deleted', tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

revoke all on function public.deny_template_version_mutation() from public, anon, authenticated;

drop trigger if exists program_template_versions_immutable on public.program_template_versions;
create trigger program_template_versions_immutable
  before update or delete on public.program_template_versions
  for each row execute function public.deny_template_version_mutation();

-- ---------------------------------------------------------------------------
-- 3. assignment_input_versions.created_by — triggered, same shape. Orphan
-- check keys off assignment_id, the only parent reference this table has.
-- ---------------------------------------------------------------------------

alter table public.assignment_input_versions alter column created_by drop not null;
alter table public.assignment_input_versions drop constraint if exists assignment_input_versions_created_by_fkey;
alter table public.assignment_input_versions add constraint assignment_input_versions_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

create or replace function public.deny_assignment_input_version_mutation()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE'
    and new.created_by is null
    and old.created_by is not null
    and (to_jsonb(new) - 'created_by') = (to_jsonb(old) - 'created_by')
  then
    return new;
  end if;

  if tg_op = 'DELETE' then
    if not exists (select 1 from public.program_assignments a where a.id = old.assignment_id) then
      return old;
    end if;
  end if;

  raise exception 'immutable record: % rows cannot be updated or deleted', tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

revoke all on function public.deny_assignment_input_version_mutation() from public, anon, authenticated;

drop trigger if exists assignment_input_versions_immutable on public.assignment_input_versions;
create trigger assignment_input_versions_immutable
  before update or delete on public.assignment_input_versions
  for each row execute function public.deny_assignment_input_version_mutation();

-- Rollback, for the staging rehearsal this repository requires before any
-- release. Order matters: dependants first. As with the actor fix, this is
-- not a clean "undo" past a real erasure that already happened — restoring
-- `not null`/`on delete restrict` is only safe on a cluster where no
-- coach has actually been erased since this migration applied.
--
--   drop trigger if exists assignment_input_versions_immutable on public.assignment_input_versions;
--   create trigger assignment_input_versions_immutable
--     before update or delete on public.assignment_input_versions
--     for each row execute function public.deny_mutation();
--   drop function if exists public.deny_assignment_input_version_mutation();
--   alter table public.assignment_input_versions drop constraint if exists assignment_input_versions_created_by_fkey;
--   alter table public.assignment_input_versions add constraint assignment_input_versions_created_by_fkey
--     foreign key (created_by) references auth.users(id) on delete restrict;
--   alter table public.assignment_input_versions alter column created_by set not null;
--
--   drop trigger if exists program_template_versions_immutable on public.program_template_versions;
--   create trigger program_template_versions_immutable
--     before update or delete on public.program_template_versions
--     for each row execute function public.deny_mutation();
--   drop function if exists public.deny_template_version_mutation();
--   alter table public.program_template_versions drop constraint if exists program_template_versions_published_by_fkey;
--   alter table public.program_template_versions add constraint program_template_versions_published_by_fkey
--     foreign key (published_by) references auth.users(id) on delete restrict;
--   alter table public.program_template_versions alter column published_by set not null;
--
--   alter table public.program_assignments drop constraint if exists program_assignments_created_by_fkey;
--   alter table public.program_assignments add constraint program_assignments_created_by_fkey
--     foreign key (created_by) references auth.users(id) on delete restrict;
--   alter table public.program_assignments alter column created_by set not null;
--
--   alter table public.training_block_templates drop constraint if exists training_block_templates_created_by_fkey;
--   alter table public.training_block_templates add constraint training_block_templates_created_by_fkey
--     foreign key (created_by) references auth.users(id) on delete restrict;
--   alter table public.training_block_templates alter column created_by set not null;
--
--   alter table public.program_templates drop constraint if exists program_templates_created_by_fkey;
--   alter table public.program_templates add constraint program_templates_created_by_fkey
--     foreign key (created_by) references auth.users(id) on delete restrict;
--   alter table public.program_templates alter column created_by set not null;
--
--   alter table public.organizations drop constraint if exists organizations_created_by_fkey;
--   alter table public.organizations add constraint organizations_created_by_fkey
--     foreign key (created_by) references auth.users(id) on delete restrict;
--   alter table public.organizations alter column created_by set not null;
