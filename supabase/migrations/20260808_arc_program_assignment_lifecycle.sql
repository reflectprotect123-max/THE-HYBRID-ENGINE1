-- ---------------------------------------------------------------------------
-- ARC coach workspace — the athlete's own accept/decline commands.
--
-- Every prior migration built the COACH -> BACKEND half of this loop:
-- create_program_assignment and publish_workout_draft both insert
-- program_assignments in state 'draft', and nothing ever moved a row past
-- that. The state machine documented in the base migration
-- ('draft' -> 'ready-for-coordinator' -> 'accepted' | 'withdrawn') had no
-- command that could reach 'accepted' or 'withdrawn' at all -- an assignment
-- sat in 'draft' forever, and the athlete had no way to say yes or no to it.
--
-- These two commands are that missing half: BACKEND -> ATHLETE. Both are
-- athlete-only, SECURITY DEFINER, and follow the exact shape every other
-- command in this system uses -- actor from auth.uid(), authorization first,
-- one transaction, an idempotency key, decision + receipt.
--
-- What this does NOT do: turn an accepted assignment into scheduled
-- sessions. That mapping -- a coach-authored Workout body into the
-- SessionProposal shape @hybrid/coordinator-adapter's
-- buildWeeklyPlanFromProposals actually consumes (priority, effort,
-- interference tags, staleness) -- is real domain design, not a command
-- signature, and is not decided here. Accepting an assignment today records
-- that the athlete said yes; it does not yet place anything on their
-- calendar. That gap is recorded, not hidden.
-- ---------------------------------------------------------------------------

create or replace function public.accept_program_assignment(
  p_organization_id uuid,
  p_assignment_id uuid,
  p_idempotency_key text
)
returns public.program_assignments
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_assignment public.program_assignments;
  v_existing public.coach_decisions;
  v_decision_id uuid;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'idempotency key required' using errcode = 'invalid_parameter_value';
  end if;

  -- Only the athlete this assignment names may accept it -- not a coach, not
  -- an owner, not another athlete. Consent is the athlete's alone to give.
  select * into v_assignment from public.program_assignments
   where id = p_assignment_id
     and organization_id = p_organization_id
     and athlete_user_id = v_actor;
  if not found then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  select * into v_existing from public.coach_decisions
   where organization_id = p_organization_id
     and athlete_user_id = v_actor
     and kind = 'assignment_accepted'
     and idempotency_key = p_idempotency_key;
  if found then
    select * into v_assignment from public.program_assignments where id = p_assignment_id;
    return v_assignment;
  end if;

  if v_assignment.state not in ('draft', 'ready-for-coordinator') then
    -- Already accepted, or withdrawn -- there is nothing left to accept.
    -- Same message either way: this function does not exist to let a
    -- caller enumerate an assignment's history by probing state.
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  update public.program_assignments set state = 'accepted', updated_at = now()
   where id = p_assignment_id
   returning * into v_assignment;

  insert into public.coach_decisions (
    organization_id, athlete_user_id, actor_user_id, kind, idempotency_key, payload
  ) values (
    p_organization_id, v_actor, v_actor, 'assignment_accepted', p_idempotency_key,
    jsonb_build_object('assignment_id', v_assignment.id)
  ) returning id into v_decision_id;

  insert into public.decision_receipts (
    decision_id, organization_id, athlete_user_id, summary, detail
  ) values (
    v_decision_id, p_organization_id, v_actor,
    'You accepted a program assignment.',
    jsonb_build_object('assignment_id', v_assignment.id)
  );

  return v_assignment;
end;
$$;

revoke all on function public.accept_program_assignment(uuid, uuid, text) from public, anon;
grant execute on function public.accept_program_assignment(uuid, uuid, text) to authenticated;

create or replace function public.decline_program_assignment(
  p_organization_id uuid,
  p_assignment_id uuid,
  p_idempotency_key text
)
returns public.program_assignments
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_assignment public.program_assignments;
  v_existing public.coach_decisions;
  v_decision_id uuid;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'idempotency key required' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_assignment from public.program_assignments
   where id = p_assignment_id
     and organization_id = p_organization_id
     and athlete_user_id = v_actor;
  if not found then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  select * into v_existing from public.coach_decisions
   where organization_id = p_organization_id
     and athlete_user_id = v_actor
     and kind = 'assignment_withdrawn'
     and idempotency_key = p_idempotency_key;
  if found then
    select * into v_assignment from public.program_assignments where id = p_assignment_id;
    return v_assignment;
  end if;

  if v_assignment.state not in ('draft', 'ready-for-coordinator') then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  update public.program_assignments set state = 'withdrawn', updated_at = now()
   where id = p_assignment_id
   returning * into v_assignment;

  insert into public.coach_decisions (
    organization_id, athlete_user_id, actor_user_id, kind, idempotency_key, payload
  ) values (
    p_organization_id, v_actor, v_actor, 'assignment_withdrawn', p_idempotency_key,
    jsonb_build_object('assignment_id', v_assignment.id)
  ) returning id into v_decision_id;

  insert into public.decision_receipts (
    decision_id, organization_id, athlete_user_id, summary, detail
  ) values (
    v_decision_id, p_organization_id, v_actor,
    'You declined a program assignment.',
    jsonb_build_object('assignment_id', v_assignment.id)
  );

  return v_assignment;
end;
$$;

revoke all on function public.decline_program_assignment(uuid, uuid, text) from public, anon;
grant execute on function public.decline_program_assignment(uuid, uuid, text) to authenticated;

-- Rollback:
--   drop function if exists public.decline_program_assignment(uuid, uuid, text);
--   drop function if exists public.accept_program_assignment(uuid, uuid, text);
