-- ============================================================================
-- ARC — a coaching relationship can END
--
-- The last open finding from the 14 August adversarial review, and the one
-- that was never a bug so much as a hole: NOTHING in this system could set
-- `coach_athlete_assignments.status = 'revoked'`. Grepping every migration,
-- only INSERT/upsert and SELECT ever touched that table.
--
-- WHY THAT MATTERED MORE THAN IT LOOKED.
--
-- 1. It is half a consent model. An athlete consents to being coached by
--    redeeming an invite — deliberately, once — and `redeem_coach_invite`'s
--    own comments lean on that as the consent boundary the whole roster rests
--    on. Consent you cannot withdraw is not consent, it is enrolment.
--
-- 2. The scenario several parts of the system are BUILT around could not
--    happen. `chooseWeeklyPlan`'s one-week scoping exists so "an athlete
--    leaving a roster could reclaim their own weeks, because no newer coach
--    write would arrive to be beaten" (CLAUDE.md). `revoke_coach_invite`
--    explicitly disclaims the job: "Ending a relationship is
--    `coach_athlete_assignments.status = 'revoked'`, which is not this
--    function." Everyone assumed something else did it. Nothing did.
--
-- WHO MAY END IT: EITHER SIDE, AND THAT IS THE POINT.
--
-- The coach, because a roster has to be manageable. The ATHLETE themselves,
-- because the alternative is that leaving requires the permission of the
-- person you are leaving. No third party — not another coach in the
-- organisation, not an owner — because this is a two-party relationship and
-- widening it here would be a policy decision wearing a plumbing change's
-- clothes.
--
-- WHAT IT DELIBERATELY DOES NOT DO: TOUCH THE ATHLETE'S TRAINING.
--
-- A week the coach already published stays exactly where it is. Three reasons,
-- and the third is the one that decided it:
--
--   * CLAUDE.md's rule is "a coach owns the week they published, not every
--     week forever". Ending the relationship does not retroactively un-write
--     a week that was legitimately theirs to write.
--   * Deleting it would leave the athlete with NOTHING, because the
--     Coordinator is deleted and no fallback recomputes a week. An empty week
--     they did not ask for is a worse outcome than a stale one they can see.
--   * The athlete can already clear it themselves. `athlete_plans_delete`
--     (20260804) lets them delete their own `athlete_weekly_plans` row, and
--     that is the erasure path. Leaving is not the same act as erasing, and
--     collapsing the two would take a choice away from the person leaving.
--
-- So the bounded, stated consequence is: after leaving, the ex-coach's already
-- published week keeps rendering on the athlete's phone until the calendar
-- rolls past it — at most six days — and no NEW week can arrive, because
-- `publish_coach_week` checks `coaches_athlete` on every call. The athlete can
-- end it sooner by deleting the row. This is written down rather than
-- discovered later.
-- ============================================================================

create or replace function public.end_coach_relationship(
  p_organization_id uuid,
  p_athlete_user_id uuid
)
returns public.coach_athlete_assignments
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_row public.coach_athlete_assignments;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  -- FOR UPDATE, so two simultaneous calls — the coach removing the athlete
  -- while the athlete leaves — serialise instead of both writing.
  select * into v_row from public.coach_athlete_assignments
   where organization_id = p_organization_id
     and athlete_user_id = p_athlete_user_id
     and status = 'active'
   for update;

  -- ONE message for "no such relationship" and "not yours to end", exactly as
  -- every other command in this system does it. Distinguishing them would let
  -- a caller probe which athletes are on which coach's roster.
  if not found or (v_actor <> v_row.coach_user_id and v_actor <> v_row.athlete_user_id) then
    raise exception 'no active coaching relationship to end' using errcode = 'invalid_parameter_value';
  end if;

  -- Both columns together. `coach_athlete_revoked_at` asserts that the stamp
  -- and the status agree, so setting one without the other is a constraint
  -- violation rather than an untidy row — the same trap that broke
  -- `redeem_coach_invite` when its membership upsert was retyped from memory.
  update public.coach_athlete_assignments
     set status = 'revoked', revoked_at = now()
   where id = v_row.id
  returning * into v_row;

  /*
   * The athlete's ORGANISATION MEMBERSHIP is left alone, and that is not an
   * oversight. `coaches_athlete` requires an active assignment AND active
   * memberships on both sides, so revoking the assignment is already
   * sufficient to end every read. Revoking the membership as well would also
   * evict them from any OTHER coach in the same organisation — one
   * relationship ending would silently end the others.
   */

  return v_row;
end;
$$;

revoke all on function public.end_coach_relationship(uuid, uuid) from public, anon;
grant execute on function public.end_coach_relationship(uuid, uuid) to authenticated;

comment on function public.end_coach_relationship(uuid, uuid) is
  'End an active coaching relationship. Callable by EITHER party and nobody '
  'else. Leaves the athlete''s published week in place — a coach owns the week '
  'they published, and the athlete can delete their own row if they want it '
  'gone. No new week can arrive afterwards, because publish_coach_week checks '
  'coaches_athlete on every call.';

-- ---------------------------------------------------------------------------
-- ROLLBACK
--
--   drop function if exists public.end_coach_relationship(uuid, uuid);
--
-- Rows already revoked STAY revoked, which is correct: dropping the ability to
-- end a relationship must not silently reinstate the ones people ended. To
-- reinstate one deliberately, redeem a fresh invite — that is the only path
-- that creates or reactivates an assignment, and it goes through the athlete.
-- ---------------------------------------------------------------------------
