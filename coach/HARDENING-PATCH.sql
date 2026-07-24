-- Coach RLS hardening patch — run once in Supabase → SQL Editor → New query → Run.
-- Recommended (not urgent for self-coached use). Closes gaps found in review:
--  • a coach row could be written already-"active" with a victim athlete (link forgery)
--  • programs/assignments writes didn't require a consenting athlete
--  • is_active_athlete_of was callable as a relationship-enumeration oracle
--  • athletes had no way to revoke a coach link
-- Idempotent and safe to re-run. Does not touch your data.

-- coach_athletes: coaches create PENDING invites only; no direct activation.
drop policy if exists ca_coach_all on public.coach_athletes;
drop policy if exists ca_coach_insert on public.coach_athletes;
create policy ca_coach_insert on public.coach_athletes for insert
  with check (auth.uid() = coach_id and athlete_id is null and status = 'pending');
drop policy if exists ca_coach_select on public.coach_athletes;
create policy ca_coach_select on public.coach_athletes for select using (auth.uid() = coach_id);
drop policy if exists ca_coach_delete on public.coach_athletes;
create policy ca_coach_delete on public.coach_athletes for delete using (auth.uid() = coach_id);
drop policy if exists ca_athlete_unlink on public.coach_athletes;
create policy ca_athlete_unlink on public.coach_athletes for delete using (auth.uid() = athlete_id);

-- programs: writing for an athlete requires self or a consenting active link.
drop policy if exists pr_coach on public.programs;
create policy pr_coach on public.programs for all
  using (auth.uid() = coach_id)
  with check (auth.uid() = coach_id and (coach_id = athlete_id or exists (
    select 1 from public.coach_athletes ca
    where ca.coach_id = programs.coach_id and ca.athlete_id = programs.athlete_id and ca.status = 'active')));

-- assignments: inline the consent check (removes the oracle grant below).
drop policy if exists as_insert on public.assignments;
create policy as_insert on public.assignments for insert
  with check (auth.uid() = coach_id and (coach_id = athlete_id or exists (
    select 1 from public.coach_athletes ca
    where ca.coach_id = assignments.coach_id and ca.athlete_id = assignments.athlete_id and ca.status = 'active')));
drop policy if exists as_update on public.assignments;
create policy as_update on public.assignments for update using (auth.uid() = coach_id)
  with check (auth.uid() = coach_id and (coach_id = athlete_id or exists (
    select 1 from public.coach_athletes ca
    where ca.coach_id = assignments.coach_id and ca.athlete_id = assignments.athlete_id and ca.status = 'active')));

-- no caller needs this anymore → revoke to close the enumeration oracle.
revoke all on function public.is_active_athlete_of(uuid, uuid) from public, authenticated;
