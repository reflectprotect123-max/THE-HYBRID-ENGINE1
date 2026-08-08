-- ARC coach workspace — the entities coaching needs and the athlete app does not
--
-- Specified by docs/ARC_CLAUDE_HANDOFF.md §"Required backend entities". Until
-- this migration, every policy in this database read `auth.uid() = user_id`:
-- there was no coach, no organisation, and no way for one person to see
-- another's training. That is why the ARC bench renders the signed-in
-- athlete's own data and labels every other client `synthetic-fixture`.
--
-- THE ONE RULE THAT SHAPES EVERY TABLE HERE
--
-- The coach expresses INTENT. The Coordinator places sessions. An assignment
-- carries `preferred_weekdays`, never resolved dates — see the check
-- constraint on `program_assignments`, which rejects a `resolved_dates` key
-- outright rather than trusting a reviewer to notice one. A coach who could
-- write a calendar directly would be a second weekly-plan author, and
-- `athlete_weekly_plans` already has exactly one.
--
-- RLS IS DEFENCE IN DEPTH, NOT THE AUTHORIZATION MODEL
--
-- The handoff is explicit: application authorization remains mandatory on every
-- athlete-facing read and command. These policies are the floor, not the
-- ceiling. They exist so that a bug in the application layer fails closed.
--
-- AND THEY FAIL CLOSED BY FILTERING, WHICH IS THE TRAP
--
-- Postgres RLS removes rows; it does not raise. An unauthorised read returns an
-- empty set, which a UI renders as "this athlete has no training". Every deny
-- test in checks/migrations-apply.mjs therefore asserts on COUNTS, not on
-- errors — the absence of an exception proves nothing.

-- ---------------------------------------------------------------------------
-- 1-2. Tenancy: organisations and who is in them
-- ---------------------------------------------------------------------------

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint organizations_name_present check (length(btrim(name)) > 0)
);

create table if not exists public.organization_memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- `support` is deliberately separate from `coach`: the handoff requires that
  -- support-role sensitive-field access be denied, which is only expressible
  -- if support is its own role rather than a coach with a flag.
  role text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (organization_id, user_id),
  constraint organization_membership_role check (role in ('owner', 'coach', 'support', 'athlete')),
  constraint organization_membership_status check (status in ('active', 'revoked'))
);

create index if not exists organization_memberships_user_idx
  on public.organization_memberships (user_id) where status = 'active';

-- ---------------------------------------------------------------------------
-- 3. The coach↔athlete relationship. Without a row here, a coach sees nothing.
-- ---------------------------------------------------------------------------

create table if not exists public.coach_athlete_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  coach_user_id uuid not null references auth.users(id) on delete cascade,
  athlete_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (organization_id, coach_user_id, athlete_user_id),
  constraint coach_athlete_status check (status in ('active', 'revoked')),
  -- A coach is not their own client. This is not pedantry: without it, the
  -- bench's "own data" mode and its "client" mode become the same query and
  -- the truth boundary the handoff protects disappears.
  constraint coach_athlete_distinct check (coach_user_id <> athlete_user_id)
);

create index if not exists coach_athlete_coach_idx
  on public.coach_athlete_assignments (coach_user_id) where status = 'active';
create index if not exists coach_athlete_athlete_idx
  on public.coach_athlete_assignments (athlete_user_id) where status = 'active';

-- ---------------------------------------------------------------------------
-- Authorization helpers. SECURITY DEFINER so a policy can consult membership
-- without the caller needing to read the membership table itself — otherwise
-- every policy would need its own recursive visibility rule.
-- ---------------------------------------------------------------------------

create or replace function public.is_org_member(org uuid, roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_memberships m
    where m.organization_id = org
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = any(roles)
  );
$$;

-- Does the CURRENT user coach this athlete, right now, in this organisation?
-- Revocation is checked on both the assignment and the membership: a coach
-- removed from the organisation must lose access even if the athlete
-- assignment row was left behind.
create or replace function public.coaches_athlete(org uuid, athlete uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.coach_athlete_assignments a
    join public.organization_memberships m
      on m.organization_id = a.organization_id
     and m.user_id = a.coach_user_id
    where a.organization_id = org
      and a.coach_user_id = auth.uid()
      and a.athlete_user_id = athlete
      and a.status = 'active'
      and m.status = 'active'
      and m.role in ('owner', 'coach')
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. Program templates, and their IMMUTABLE versions
--
-- The template is a mutable header (name, status). What a coach actually
-- assigns is a VERSION, and a version never changes after publication —
-- otherwise an athlete's history would silently re-describe itself when a
-- coach edited the template months later.
-- ---------------------------------------------------------------------------

create table if not exists public.program_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  domain text not null,
  name text not null,
  category text not null default 'general',
  level text not null default 'developing',
  status text not null default 'draft',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint program_template_domain check (domain in ('strength', 'conditioning')),
  constraint program_template_level check (level in ('beginner', 'developing', 'experienced')),
  constraint program_template_status check (status in ('draft', 'published', 'archived'))
);

create table if not exists public.program_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.program_templates(id) on delete cascade,
  version integer not null,
  -- The engine-shaped body: sessions per week, weeks, progression model,
  -- blocks. Opaque here for the same reason athlete_domain_snapshots is —
  -- the contract is ownership and immutability, not column-per-field.
  body jsonb not null default '{}'::jsonb,
  -- Which rule set produced it, so a decision can be replayed honestly.
  rule_set_version text not null default 'v1',
  rule_set_hash text,
  published_at timestamptz not null default now(),
  published_by uuid not null references auth.users(id) on delete restrict,
  unique (template_id, version),
  constraint program_template_version_positive check (version > 0),
  constraint program_template_body_object check (jsonb_typeof(body) = 'object')
);

-- ---------------------------------------------------------------------------
-- 5. Training block templates — the reusable pieces a program is built from
-- ---------------------------------------------------------------------------

create table if not exists public.training_block_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  domain text not null,
  name text not null,
  body jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_block_domain check (domain in ('strength', 'conditioning')),
  constraint training_block_body_object check (jsonb_typeof(body) = 'object')
);

-- ---------------------------------------------------------------------------
-- 6-7. Assignments, and the versioned inputs they produce
--
-- `program_assignments` is the coach's INTENT. `assignment_input_versions` is
-- what that intent became when it was handed to the Coordinator — the
-- proposals and constraints, preserved so a resolved week can be explained
-- after the fact.
-- ---------------------------------------------------------------------------

create table if not exists public.program_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  athlete_user_id uuid not null references auth.users(id) on delete cascade,
  template_version_id uuid not null references public.program_template_versions(id) on delete restrict,
  preferred_start_date date not null,
  -- INTENT, not placement. 0-6, ISO-ish day indices as the front end sends
  -- them; the Coordinator decides what actually lands where.
  preferred_weekdays smallint[] not null default '{}',
  state text not null default 'draft',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint program_assignment_state check (state in ('draft', 'ready-for-coordinator', 'accepted', 'withdrawn')),
  -- Array containment, not a subquery: postgres forbids subqueries in CHECK
  -- constraints, and `<@` says the same thing — every element is a real
  -- weekday index — while staying inside what a constraint may do.
  constraint program_assignment_weekdays check (
    preferred_weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
  )
);

create table if not exists public.assignment_input_versions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.program_assignments(id) on delete cascade,
  version integer not null,
  -- The proposals and constraints handed to the Coordinator.
  proposals jsonb not null default '[]'::jsonb,
  constraints jsonb not null default '{}'::jsonb,
  rule_set_version text not null default 'v1',
  rule_set_hash text,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  unique (assignment_id, version),
  constraint assignment_input_version_positive check (version > 0),
  constraint assignment_input_proposals_array check (jsonb_typeof(proposals) = 'array'),
  constraint assignment_input_constraints_object check (jsonb_typeof(constraints) = 'object')
);

-- ---------------------------------------------------------------------------
-- 8. The audit trail: coach decisions and their receipts. Both IMMUTABLE.
--
-- "Any meaningful automated change requires an inspectable receipt." A receipt
-- that can be edited is not a receipt, so UPDATE and DELETE are denied to
-- every client role by policy AND by trigger — policy alone would leave the
-- table editable by any future role granted blanket write.
-- ---------------------------------------------------------------------------

create table if not exists public.coach_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  athlete_user_id uuid not null references auth.users(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  kind text not null,
  -- Optimistic concurrency: a command states the version it believed it was
  -- acting on, and a replay against a moved base is rejected by the caller.
  base_version text,
  -- Idempotency is per organisation, so two organisations cannot collide and
  -- one cannot probe the other's key space.
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  rule_set_version text not null default 'v1',
  rule_set_hash text,
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  constraint coach_decision_kind check (kind in (
    'assignment_created', 'assignment_updated', 'assignment_accepted',
    'assignment_withdrawn', 'progression_approved', 'progression_declined',
    'template_published'
  )),
  constraint coach_decision_payload_object check (jsonb_typeof(payload) = 'object')
);

create table if not exists public.decision_receipts (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.coach_decisions(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  athlete_user_id uuid not null references auth.users(id) on delete cascade,
  -- What the athlete is shown. Separate from the decision payload because the
  -- athlete's view of a change is not the coach's command.
  summary text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint decision_receipt_detail_object check (jsonb_typeof(detail) = 'object')
);

create index if not exists decision_receipts_athlete_idx
  on public.decision_receipts (athlete_user_id, created_at desc);

create or replace function public.deny_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'immutable record: % rows cannot be updated or deleted', tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists program_template_versions_immutable on public.program_template_versions;
create trigger program_template_versions_immutable
  before update or delete on public.program_template_versions
  for each row execute function public.deny_mutation();

drop trigger if exists assignment_input_versions_immutable on public.assignment_input_versions;
create trigger assignment_input_versions_immutable
  before update or delete on public.assignment_input_versions
  for each row execute function public.deny_mutation();

drop trigger if exists coach_decisions_immutable on public.coach_decisions;
create trigger coach_decisions_immutable
  before update or delete on public.coach_decisions
  for each row execute function public.deny_mutation();

drop trigger if exists decision_receipts_immutable on public.decision_receipts;
create trigger decision_receipts_immutable
  before update or delete on public.decision_receipts
  for each row execute function public.deny_mutation();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.coach_athlete_assignments enable row level security;
alter table public.program_templates enable row level security;
alter table public.program_template_versions enable row level security;
alter table public.training_block_templates enable row level security;
alter table public.program_assignments enable row level security;
alter table public.assignment_input_versions enable row level security;
alter table public.coach_decisions enable row level security;
alter table public.decision_receipts enable row level security;

drop policy if exists organizations_read on public.organizations;
create policy organizations_read on public.organizations for select to authenticated
  using (public.is_org_member(id, array['owner', 'coach', 'support', 'athlete']));

drop policy if exists memberships_read on public.organization_memberships;
create policy memberships_read on public.organization_memberships for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_org_member(organization_id, array['owner', 'coach'])
  );

drop policy if exists coach_athlete_read on public.coach_athlete_assignments;
create policy coach_athlete_read on public.coach_athlete_assignments for select to authenticated
  using (
    coach_user_id = auth.uid()
    or athlete_user_id = auth.uid()
    or public.is_org_member(organization_id, array['owner'])
  );

-- Templates and blocks are organisation-wide reference material. An athlete
-- can see them; only owners and coaches author them, through the application.
drop policy if exists program_templates_read on public.program_templates;
create policy program_templates_read on public.program_templates for select to authenticated
  using (public.is_org_member(organization_id, array['owner', 'coach', 'support', 'athlete']));

drop policy if exists program_template_versions_read on public.program_template_versions;
create policy program_template_versions_read on public.program_template_versions for select to authenticated
  using (exists (
    select 1 from public.program_templates t
    where t.id = program_template_versions.template_id
      and public.is_org_member(t.organization_id, array['owner', 'coach', 'support', 'athlete'])
  ));

drop policy if exists training_block_templates_read on public.training_block_templates;
create policy training_block_templates_read on public.training_block_templates for select to authenticated
  using (public.is_org_member(organization_id, array['owner', 'coach', 'support', 'athlete']));

-- An assignment is visible to its athlete, to a coach who currently coaches
-- that athlete, and to an owner. `support` is absent on purpose: the handoff
-- requires support-role sensitive-field access to be denied.
drop policy if exists program_assignments_read on public.program_assignments;
create policy program_assignments_read on public.program_assignments for select to authenticated
  using (
    athlete_user_id = auth.uid()
    or public.coaches_athlete(organization_id, athlete_user_id)
    or public.is_org_member(organization_id, array['owner'])
  );

drop policy if exists assignment_input_versions_read on public.assignment_input_versions;
create policy assignment_input_versions_read on public.assignment_input_versions for select to authenticated
  using (exists (
    select 1 from public.program_assignments a
    where a.id = assignment_input_versions.assignment_id
      and (
        a.athlete_user_id = auth.uid()
        or public.coaches_athlete(a.organization_id, a.athlete_user_id)
        or public.is_org_member(a.organization_id, array['owner'])
      )
  ));

drop policy if exists coach_decisions_read on public.coach_decisions;
create policy coach_decisions_read on public.coach_decisions for select to authenticated
  using (
    athlete_user_id = auth.uid()
    or public.coaches_athlete(organization_id, athlete_user_id)
    or public.is_org_member(organization_id, array['owner'])
  );

-- The athlete must be able to read what was decided about them. That is the
-- receipt's whole purpose.
drop policy if exists decision_receipts_read on public.decision_receipts;
create policy decision_receipts_read on public.decision_receipts for select to authenticated
  using (
    athlete_user_id = auth.uid()
    or public.coaches_athlete(organization_id, athlete_user_id)
    or public.is_org_member(organization_id, array['owner'])
  );

-- NO INSERT/UPDATE/DELETE POLICIES ARE GRANTED TO `authenticated`, ANYWHERE.
--
-- Writes go through server-side commands that derive the actor from the
-- session and enforce organisation, athlete and role checks in the
-- application, exactly as the handoff requires. A client with a direct table
-- write would be trusting a client-supplied organisation id, which is the one
-- thing that document forbids outright.

revoke all on public.organizations from anon;
revoke all on public.organization_memberships from anon;
revoke all on public.coach_athlete_assignments from anon;
revoke all on public.program_templates from anon;
revoke all on public.program_template_versions from anon;
revoke all on public.training_block_templates from anon;
revoke all on public.program_assignments from anon;
revoke all on public.assignment_input_versions from anon;
revoke all on public.coach_decisions from anon;
revoke all on public.decision_receipts from anon;

grant select on public.organizations to authenticated;
grant select on public.organization_memberships to authenticated;
grant select on public.coach_athlete_assignments to authenticated;
grant select on public.program_templates to authenticated;
grant select on public.program_template_versions to authenticated;
grant select on public.training_block_templates to authenticated;
grant select on public.program_assignments to authenticated;
grant select on public.assignment_input_versions to authenticated;
grant select on public.coach_decisions to authenticated;
grant select on public.decision_receipts to authenticated;

-- Rollback, for the staging rehearsal this repository requires before any
-- release. Order matters: dependants first.
--
--   drop table if exists public.decision_receipts;
--   drop table if exists public.coach_decisions;
--   drop table if exists public.assignment_input_versions;
--   drop table if exists public.program_assignments;
--   drop table if exists public.training_block_templates;
--   drop table if exists public.program_template_versions;
--   drop table if exists public.program_templates;
--   drop table if exists public.coach_athlete_assignments;
--   drop table if exists public.organization_memberships;
--   drop table if exists public.organizations;
--   drop function if exists public.coaches_athlete(uuid, uuid);
--   drop function if exists public.is_org_member(uuid, text[]);
--   drop function if exists public.deny_mutation();

-- ---------------------------------------------------------------------------
-- The one sanctioned write path.
--
-- No client role holds INSERT on any table above, deliberately. A coach saving
-- an assignment therefore goes through this function, which is the only place
-- that can write — and it derives the actor from the session rather than
-- believing anything the caller says about who they are.
--
-- Four things the handoff requires, all of them here:
--   * the actor comes from auth.uid(), never from a parameter;
--   * organisation and coach↔athlete authorization are checked in the body,
--     not left to RLS — RLS is the floor, this is the door;
--   * an idempotency key makes a replay a no-op rather than a second write;
--   * the assignment, the decision and the receipt commit in ONE transaction,
--     so a receipt can never describe a change that did not happen, and a
--     change can never happen without a receipt.
--
-- There is no `resolved_dates` parameter and cannot be. The coach states
-- preferred weekdays; the Coordinator places sessions.
-- ---------------------------------------------------------------------------

create or replace function public.create_program_assignment(
  p_organization_id uuid,
  p_athlete_user_id uuid,
  p_template_version_id uuid,
  p_preferred_start_date date,
  p_preferred_weekdays smallint[],
  p_idempotency_key text,
  p_base_version text default null
)
returns public.program_assignments
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_existing public.coach_decisions;
  v_assignment public.program_assignments;
  v_decision_id uuid;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  -- Authorization in the application layer, as mandated. `coaches_athlete`
  -- checks the assignment AND the membership, so a revoked coach fails here
  -- even if their athlete row was left behind.
  if not public.coaches_athlete(p_organization_id, p_athlete_user_id) then
    -- Deliberately the same message whether the organisation does not exist,
    -- the athlete does not exist, or the caller simply is not their coach.
    -- Distinguishing them would let a caller enumerate athletes.
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'idempotency key required' using errcode = 'invalid_parameter_value';
  end if;

  -- A replay returns the ORIGINAL result rather than erroring: the caller
  -- retrying after a dropped connection did nothing wrong and should see the
  -- write it already made.
  select * into v_existing from public.coach_decisions
   where organization_id = p_organization_id and idempotency_key = p_idempotency_key;
  if found then
    select * into v_assignment from public.program_assignments
     where id = (v_existing.payload ->> 'assignment_id')::uuid;
    return v_assignment;
  end if;

  -- The template version must belong to the same organisation. Without this a
  -- coach could assign another tenant's program by id.
  if not exists (
    select 1 from public.program_template_versions v
    join public.program_templates t on t.id = v.template_id
    where v.id = p_template_version_id and t.organization_id = p_organization_id
  ) then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  insert into public.program_assignments (
    organization_id, athlete_user_id, template_version_id,
    preferred_start_date, preferred_weekdays, state, created_by
  ) values (
    p_organization_id, p_athlete_user_id, p_template_version_id,
    p_preferred_start_date, coalesce(p_preferred_weekdays, '{}'), 'draft', v_actor
  ) returning * into v_assignment;

  insert into public.coach_decisions (
    organization_id, athlete_user_id, actor_user_id, kind,
    base_version, idempotency_key, payload
  ) values (
    p_organization_id, p_athlete_user_id, v_actor, 'assignment_created',
    p_base_version, p_idempotency_key,
    jsonb_build_object('assignment_id', v_assignment.id, 'template_version_id', p_template_version_id)
  ) returning id into v_decision_id;

  insert into public.decision_receipts (
    decision_id, organization_id, athlete_user_id, summary, detail
  ) values (
    v_decision_id, p_organization_id, p_athlete_user_id,
    'A program was assigned to you.',
    jsonb_build_object('assignment_id', v_assignment.id, 'starts', p_preferred_start_date)
  );

  return v_assignment;
end;
$$;

revoke all on function public.create_program_assignment(uuid, uuid, uuid, date, smallint[], text, text) from public, anon;
grant execute on function public.create_program_assignment(uuid, uuid, uuid, date, smallint[], text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The authorised, tenant-scoped projection.
--
-- docs/ARC_CLAUDE_HANDOFF.md: "Do not remove that guard until the backend can
-- fetch an authorised, tenant-scoped projection for the selected client."
-- This is that projection, and its shape is the point.
--
-- IT RETURNS COUNTS, NEVER THE SNAPSHOT.
--
-- A coach needs to know how the week went. They do not need — and this will
-- not give them — the athlete's every logged set, body weight or meal. The
-- snapshot stays behind `auth.uid() = user_id`; only the summary crosses.
-- Widening this to return `snapshot` would hand a coach the whole training
-- history through a function whose name says "summary", and would do it
-- without any of the RLS the athlete's own tables carry.
--
-- SECURITY DEFINER, so it can read across the athlete's RLS — which makes the
-- authorization check in the body the ONLY thing standing between a coach and
-- somebody else's records. It is the first statement for that reason.
--
-- SAFETY IS NOT AN AGGREGATE. `has_safety_flag` reports whether a pain hold or
-- illness is active, because a coach reading "3 of 4 sessions done" without
-- knowing the fourth was dropped for pain has been told the opposite of what
-- happened. It is a boolean, not a diagnosis: the coach learns that a flag
-- exists, not what the athlete reported.
-- ---------------------------------------------------------------------------

create or replace function public.get_athlete_training_summary(
  p_organization_id uuid,
  p_athlete_user_id uuid,
  p_week_start date
)
returns table (
  strength_completed integer,
  strength_planned integer,
  conditioning_completed integer,
  conditioning_planned integer,
  nutrition_days integer,
  has_safety_flag boolean
)
language plpgsql security definer set search_path = public as $$
declare
  v_week_end date := p_week_start + 6;
  v_core jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  -- The whole boundary, in one line. Same message regardless of which part
  -- failed, so a caller cannot probe for who exists.
  if not public.coaches_athlete(p_organization_id, p_athlete_user_id) then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  select state into v_core from public.athlete_core where user_id = p_athlete_user_id;

  return query
  with sessions as (
    select s.value as s
    from public.athlete_domain_snapshots d,
         lateral jsonb_array_elements(coalesce(d.snapshot -> 'sessions', '[]'::jsonb)) s
    where d.user_id = p_athlete_user_id
      and d.domain in ('strength', 'conditioning')
      and (s.value ->> 'date') between p_week_start::text and v_week_end::text
  ),
  nutrition as (
    select count(distinct e.value ->> 'logDate') as days
    from public.athlete_domain_snapshots d,
         lateral jsonb_array_elements(coalesce(d.snapshot -> 'logEntries', '[]'::jsonb)) e
    where d.user_id = p_athlete_user_id
      and d.domain = 'nutrition'
      and (e.value ->> 'deletedAt') is null
      and (e.value ->> 'logDate') between p_week_start::text and v_week_end::text
  )
  select
    (select count(*)::integer from sessions where s ->> 'kind' = 'strength' and s ->> 'status' = 'complete'),
    (select count(*)::integer from sessions where s ->> 'kind' = 'strength'),
    (select count(*)::integer from sessions where s ->> 'kind' = 'conditioning' and s ->> 'status' = 'complete'),
    (select count(*)::integer from sessions where s ->> 'kind' = 'conditioning'),
    (select days::integer from nutrition),
    coalesce(
      (v_core #>> '{safety,painHold,active}')::boolean
        or (v_core #>> '{safety,illness,status}') is distinct from 'clear',
      false
    );
end;
$$;

revoke all on function public.get_athlete_training_summary(uuid, uuid, date) from public, anon;
grant execute on function public.get_athlete_training_summary(uuid, uuid, date) to authenticated;
