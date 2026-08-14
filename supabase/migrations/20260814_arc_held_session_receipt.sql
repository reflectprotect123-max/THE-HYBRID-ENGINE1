-- ============================================================================
-- ARC — the coach is told when a session was HELD, and why
--
-- Step 5 of the coach-week build. The design doc is blunt about why it is not
-- optional: "A coach who cannot tell 'held for injury' from 'ignored me' will
-- distrust the whole system within a week."
--
-- THIS IS A ONE-VALUE CHANGE, and that is the finding rather than a shortcut.
--
-- Building the Android card, the athlete side already computes the verdict: it
-- calls auto-coach's `resolveSession` on today's coach sessions and renders
-- `safety_stop` with the resolver's own inferences. What was missing was only
-- the CARRY — a write the athlete's client is granted, and a coach-side read.
--
-- Both already exist. `push_autocoach_receipt` (20260808) is exactly this
-- path: athlete-authenticated, org-scoped, operations validated element by
-- element against closed vocabularies, reason codes checked against a closed
-- list, and read back by the coach through `get_athlete_autocoach_receipts`.
-- Its only obstacle was `action in ('applied', 'undone')` — a hold is neither.
--
-- And the two reason codes a hold needs, `pain_hold_active` and
-- `illness_flag_active`, are ALREADY in that closed vocabulary. They have been
-- since 8 August. Nothing about the safety half of this needed inventing.
--
-- So: one new action value. A new table would have duplicated a sanitiser
-- that has already been reasoned about hard, and every line of that reasoning
-- applies unchanged to a held session.
--
-- WHAT A HELD RECEIPT CARRIES, AND WHAT IT DELIBERATELY DOES NOT
--
-- `operations` is empty for a hold: nothing was modified, the session was
-- stopped. `reason_codes` carries which safety flag did it. `workout_id`
-- identifies the session and NO NAME TRAVELS — the coach authored the week, so
-- their own published version resolves the id to a name locally. That keeps
-- the boundary this receipt tier has held since it was written: block and set
-- level content never crosses, and a session name is not smuggled across in a
-- field that exists for an id.
--
-- The function below is 20260808's, reproduced VERBATIM with exactly one list
-- widened. It is repeated in full because Postgres has no way to patch a
-- function body — if you are diffing this against the original, the action
-- check is the only line that differs.
-- ============================================================================

-- The table's own backstop, widened first: the function raises before the
-- insert, but the constraint is what holds if a future path forgets to.
alter table public.autocoach_receipts
  drop constraint if exists autocoach_receipt_action;

alter table public.autocoach_receipts
  add constraint autocoach_receipt_action check (action in ('applied', 'undone', 'held'));

comment on constraint autocoach_receipt_action on public.autocoach_receipts is
  '''applied'' and ''undone'' are auto-coach modifying a session. ''held'' is the '
  'safety layer stopping one — added 14 August 2026 so a coach can tell a held '
  'session from an ignored one.';

create or replace function public.push_autocoach_receipt(
  p_organization_id uuid,
  p_client_entry_id text,
  p_occurred_at timestamptz,
  p_session_date date,
  p_workout_id text,
  p_action text,
  p_was_forked boolean,
  p_operations jsonb,
  p_reason_codes text[]
)
returns public.autocoach_receipts
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_row public.autocoach_receipts;
  v_op jsonb;
  v_code text;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if not public.is_org_member(p_organization_id, array['athlete']) then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;
  if p_action not in ('applied', 'undone', 'held') then
    raise exception 'invalid action' using errcode = 'invalid_parameter_value';
  end if;
  if p_client_entry_id is null or length(btrim(p_client_entry_id)) = 0 then
    raise exception 'client entry id required' using errcode = 'invalid_parameter_value';
  end if;
  -- A plausible session window, not a strict one -- this only stops a
  -- corrupt/adversarial value from permanently sorting first (or last)
  -- forever in get_athlete_autocoach_receipts' `order by occurred_at desc`.
  if p_occurred_at < '2020-01-01'::timestamptz or p_occurred_at > now() + interval '1 day' then
    raise exception 'invalid occurred_at' using errcode = 'invalid_parameter_value';
  end if;
  if p_session_date < date '2020-01-01' or p_session_date > current_date + 1 then
    raise exception 'invalid session_date' using errcode = 'invalid_parameter_value';
  end if;

  -- Defence in depth, not redundancy: this function is EXECUTE-granted to
  -- every authenticated athlete member, reachable by a raw RPC call, not
  -- only through the sanctioned client path. The client (arc-athlete-sync.ts
  -- `sanitizeReceiptOperations`) already strips a ResolutionOperation down to
  -- exactly this shape before a normal push ever reaches here -- dropping
  -- `before`/`after`, the only free-text-bearing fields, because
  -- resolve.ts's cap_intensity branch interpolates the raw EXERCISE NAME
  -- into them, which is block/set-level content this roster tier must never
  -- carry. A bare `jsonb_typeof(...) = 'array'` check would still let a raw
  -- caller push that content (or anything else) straight past the client
  -- entirely, so every element is validated against the same closed
  -- vocabularies ActionType/Materiality already are
  -- (packages/auto-coach/src/types.ts) -- exactly four string keys, nothing
  -- else, nothing free-text. A plpgsql loop, not a single boolean SQL
  -- expression: Postgres does not guarantee OR/AND short-circuit order, and
  -- `jsonb_object_keys` raises on a non-object element, so an unordered
  -- expression risks erroring on the WRONG check rather than reporting the
  -- real one -- sequential procedural code does not have that risk.
  if jsonb_typeof(p_operations) is distinct from 'array' then
    raise exception 'invalid operations' using errcode = 'invalid_parameter_value';
  end if;
  for v_op in select * from jsonb_array_elements(p_operations) loop
    if jsonb_typeof(v_op) is distinct from 'object' then
      raise exception 'invalid operations' using errcode = 'invalid_parameter_value';
    end if;
    if (select count(*) from jsonb_object_keys(v_op)) > 4
      or not (v_op ? 'type' and v_op ? 'targetPath' and v_op ? 'reasonCode' and v_op ? 'materiality')
    then
      raise exception 'invalid operations' using errcode = 'invalid_parameter_value';
    end if;
    if jsonb_typeof(v_op -> 'type') is distinct from 'string'
      or jsonb_typeof(v_op -> 'targetPath') is distinct from 'string'
      or jsonb_typeof(v_op -> 'reasonCode') is distinct from 'string'
      or jsonb_typeof(v_op -> 'materiality') is distinct from 'string'
    then
      raise exception 'invalid operations' using errcode = 'invalid_parameter_value';
    end if;
    if (v_op ->> 'type') not in ('keep_as_planned', 'cap_intensity', 'trim_conditioning_minutes', 'hold_progression', 'rest_or_pause', 'ask_for_clarification')
      or (v_op ->> 'materiality') not in ('trivial', 'low', 'material', 'high')
      or length(v_op ->> 'targetPath') > 200
      or length(v_op ->> 'reasonCode') > 64
    then
      raise exception 'invalid operations' using errcode = 'invalid_parameter_value';
    end if;
  end loop;
  -- `reason_codes` is a closed vocabulary too (see the table's own
  -- `autocoach_receipt_reason_codes_known` constraint for the full,
  -- source-verified list) -- checked here as well only so a bad call gets
  -- this function's clean 'invalid_parameter_value' error rather than a raw
  -- constraint-violation from the insert below.
  if coalesce(array_length(p_reason_codes, 1), 0) > 20 then
    raise exception 'invalid reason codes' using errcode = 'invalid_parameter_value';
  end if;
  foreach v_code in array coalesce(p_reason_codes, '{}') loop
    if length(v_code) > 64
      or v_code not in (
        'pain_hold_active', 'illness_flag_active', 'low_readiness', 'recovery_debt_high',
        'physical_load_high', 'time_limited', 'low_energy_availability',
        'policy_paused', 'no_material_conflict'
      )
    then
      raise exception 'invalid reason codes' using errcode = 'invalid_parameter_value';
    end if;
  end loop;

  -- Idempotent push: a retry after a dropped connection returns the ORIGINAL
  -- row rather than erroring or duplicating -- the no-op update trick every
  -- other push RPC in this system uses, so RETURNING has a row to give back
  -- on conflict without actually overwriting anything.
  insert into public.autocoach_receipts (
    organization_id, athlete_user_id, client_entry_id, occurred_at,
    session_date, workout_id, action, was_forked, operations, reason_codes
  ) values (
    p_organization_id, v_actor, p_client_entry_id, p_occurred_at,
    p_session_date, p_workout_id, p_action, p_was_forked, p_operations, coalesce(p_reason_codes, '{}')
  )
  on conflict (organization_id, athlete_user_id, client_entry_id)
  do update set client_entry_id = autocoach_receipts.client_entry_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.push_autocoach_receipt(uuid, text, timestamptz, date, text, text, boolean, jsonb, text[]) from public, anon;
grant execute on function public.push_autocoach_receipt(uuid, text, timestamptz, date, text, text, boolean, jsonb, text[]) to authenticated;


-- ---------------------------------------------------------------------------
-- ROLLBACK
--
-- Narrowing the constraint back will FAIL while any held receipt exists, which
-- is correct — it refuses rather than silently discarding a safety record.
--
--   -- only when no held receipts remain:
--   -- delete from public.autocoach_receipts where action = 'held';
--   alter table public.autocoach_receipts drop constraint if exists autocoach_receipt_action;
--   alter table public.autocoach_receipts
--     add constraint autocoach_receipt_action check (action in ('applied', 'undone'));
--   -- and re-apply 20260808's push_autocoach_receipt verbatim.
-- ---------------------------------------------------------------------------
