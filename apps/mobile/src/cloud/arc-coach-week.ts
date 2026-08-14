import type { SupabaseClient } from '@supabase/supabase-js';
import type { EcosystemSyncNamespace } from '@hybrid/shared-core';
import type { Workout } from '@hybrid/engine';
import { getDisplayName } from './arc-roster';

/*
 * A COACH-PUBLISHED WEEK, on the athlete's phone.
 *
 * `publish_coach_week` (supabase/migrations/20260813_arc_coach_week_publish.sql)
 * writes the coach's week straight into the ATHLETE's own
 * `athlete_weekly_plans` row with `writer = 'coach'` — the only cross-user
 * write in the ecosystem tables. `./ecosystem.ts` has always pulled that row
 * and mapped it into the `weeklyPlan` partition, `writer` and all, so the data
 * has been reaching the device since the migration landed. Nothing read the
 * `writer` field, so a coach's week arrived and was invisible. This module is
 * the reading half.
 *
 * WHAT IT IS NOT
 *
 *   - It is NOT an assignment. `./arc-assignments.ts` carries a PROPOSAL the
 *     athlete answers yes or no to, and `../autocoach/ArcAssignmentCard.tsx`
 *     is that answer. A published week is not renegotiated session by session:
 *     the consent boundary is the roster link the athlete redeemed
 *     (`redeem_coach_invite`, and only the athlete can call it), and the design
 *     doc says so in as many words. So nothing here accepts, declines,
 *     dismisses or defers, and nothing here should grow the ability to.
 *   - It is NOT a second Coordinator. The device still computes its own week
 *     from proposals (`@hybrid/coordinator-adapter`'s `buildWeeklyPlan`) and
 *     that is untouched; this only decides which of the two the athlete is
 *     LOOKING at. Precedence between a coach row and a coordinator row belongs
 *     to `mergeEcosystemNamespaces`'s `chooseWeeklyPlan` in
 *     `@hybrid/shared-core`, in one place, and must never be re-decided here.
 *   - It is NOT a materialiser. A coach session does not become a local
 *     `Workout` in `EngineDB`. The week is a published artefact that the
 *     server owns; copying it into the athlete's own workout list would make
 *     the coach's next publish fight a local edit, and would push a coach's
 *     week back up through `app_state` as if the device had authored it.
 *
 * DELIBERATELY DUPLICATED rather than shared: `apps/mobile` may not import
 * from `apps/web` (CLAUDE.md, "the athlete and the coach never face each
 * other"), and there is in any case nothing to import — the bench authors a
 * week, it does not render one as an athlete's own. Same precedent, and the
 * same reason, as the header of `./arc-assignments.ts`.
 */

/* -------------------------------------------------------------------------
 * The body shape.
 *
 * `coach_week_plan_versions.body` is `jsonb` with exactly one constraint —
 * `jsonb_typeof(body) = 'object'` — so it is unconstrained, coach-written
 * input arriving over the wire, the same "opaque to Postgres" contract as
 * `program_template_versions.body`. It gets the same treatment
 * `sanitizeAssignedWorkoutBody` gives that one: anything that does not look
 * like a week is dropped rather than partially trusted, because whatever
 * survives this function is rendered as the athlete's training.
 *
 * The shape is the design doc's ("the seven days, each a list of sessions",
 * 2026-08-13-coach-publishes-the-week-design.md), and the writer defines it as
 * `coach-week/1`:
 *
 *   { schema: 'coach-week/1', weekStart, days: [ { date, sessions: Workout[] } × 7 ] }
 *
 * A session on the wire is an engine `Workout` — the same record the day
 * builder already writes into `EngineDB.workouts` — so `name`, `kind` and
 * `blocks` are read straight off it with no translation. That is the point: a
 * second session shape invented for the wire is how two halves of one system
 * start disagreeing about what a session is.
 *
 * `schema` is deliberately NOT required here. A reader that refuses a body for
 * lacking a version tag it does not use turns a forward-compatible change into
 * an athlete with no week; the fields this actually reads are checked one by
 * one instead. The sanitiser is tolerant of what a writer may reasonably differ
 * on (a day may carry its own date or take it from its position; a session may
 * name its domain or not) and strict about what it may not (a session with no
 * blocks array is not a session). `checks/migrations-apply.mjs` still publishes
 * `{ label, days: [] }` as a placeholder body, and that reads as an empty
 * week rather than as a crash, which is the correct outcome for it.
 * ---------------------------------------------------------------------- */

/** One session the coach placed on one day. */
export interface CoachWeekSession {
  /** Stable within a week — a React key, and the id handed to the resolver. */
  id: string;
  /** ISO date, always inside the week it was published for. */
  date: string;
  name: string;
  kind?: 'strength' | 'conditioning';
  blocks: Workout['blocks'];
}

export interface CoachWeek {
  /** The Monday the server keyed this week on. */
  weekStart: string;
  sessions: CoachWeekSession[];
}

/** Who published it. Separate from the week itself because it comes from
 *  different tables, over a different (best-effort) read — see below. */
export interface CoachWeekAttribution {
  coachUserId: string;
  /** The coach's display name, or null when there is no name to show.
   *  ABSENCE STAYS ABSENCE — nothing here invents one from a uuid. */
  coachName: string | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** weekStart + n days, as an ISO date. String arithmetic through UTC on
 *  purpose: these are calendar dates, not instants, and a local-time Date
 *  would shift them by a day either side of a DST boundary. */
export function dayOfWeek(weekStart: string, index: number): string {
  const d = new Date(`${weekStart}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + index);
  return d.toISOString().slice(0, 10);
}

/**
 * Harden a published week body into something the render tree may trust.
 * Returns null when there is no week in there at all — a week with zero
 * sessions is a real answer (a coach published a deload with nothing in it)
 * and is NOT null; unreadable input is.
 */
export function sanitizeCoachWeekBody(weekStart: unknown, body: unknown): CoachWeek | null {
  if (typeof weekStart !== 'string' || !DATE.test(weekStart)) return null;
  if (!isRecord(body)) return null;
  const days = Array.isArray(body.days) ? body.days : null;
  if (!days) return null;

  const sessions: CoachWeekSession[] = [];
  days.forEach((rawDay, dayIndex) => {
    if (!isRecord(rawDay)) return;
    // A day may carry its own date; otherwise it is the nth day of the week it
    // was published for. Either way the date is clamped INTO the week: a body
    // that names a date outside its own week is the one case where trusting
    // the writer would put a coach's session on a day the athlete cannot
    // reconcile with the week they were told they are looking at.
    const own = typeof rawDay.date === 'string' && DATE.test(rawDay.date) ? rawDay.date : null;
    const positional = dayOfWeek(weekStart, dayIndex);
    const inWeek = own && own >= weekStart && own <= dayOfWeek(weekStart, 6);
    const date = inWeek ? (own as string) : positional;

    const raw = Array.isArray(rawDay.sessions) ? rawDay.sessions : [];
    raw.forEach((rawSession, i) => {
      if (!isRecord(rawSession)) return;
      // Same guard as sanitizeAssignedWorkoutBody: no blocks array, no
      // session. Everything else has an honest fallback; this does not.
      if (!Array.isArray(rawSession.blocks)) return;
      const kind =
        rawSession.kind === 'strength' || rawSession.kind === 'conditioning'
          ? rawSession.kind
          : undefined;
      const name =
        typeof rawSession.name === 'string' && rawSession.name.trim()
          ? rawSession.name
          : 'Coach session';
      sessions.push({
        id: typeof rawSession.id === 'string' && rawSession.id ? rawSession.id : `${date}:${i}`,
        date,
        name,
        kind,
        blocks: rawSession.blocks as Workout['blocks'],
      });
    });
  });

  sessions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { weekStart, sessions };
}

/**
 * The coach's week for `weekStart`, or null.
 *
 * `writer` is the whole question. A `weeklyPlan` partition written
 * `'coordinator'` is this device's own Coordinator output round-tripping
 * through the server and must NOT be rendered as somebody's coach's week; only
 * `'coach'` comes from `publish_coach_week`, which is the only writer the
 * database's `athlete_plan_writer` constraint permits besides the athlete's own
 * device.
 *
 * The week is also matched against `weekStart` rather than taken on trust. The
 * pull takes `order by week_start desc limit 1`, so the partition holds ONE
 * week and it may be last week's — showing that under a "this week" heading is
 * the exact silent divergence this feature exists to avoid.
 */
export function coachWeekFromNamespace(
  namespace: EcosystemSyncNamespace | undefined,
  weekStart: string,
): CoachWeek | null {
  const partition = namespace?.partitions.weeklyPlan;
  if (!partition || partition.writer !== 'coach') return null;
  const data = partition.data;
  if (!isRecord(data)) return null;
  if (data.weekStart !== weekStart) return null;
  return sanitizeCoachWeekBody(data.weekStart, data.plan);
}

/**
 * A coach session, shaped as the `Workout` the per-session safety layer takes.
 *
 * `resolveSession` (@hybrid/auto-coach) is PURE and takes a workout, a policy
 * and the athlete-state snapshot. Handing it a coach session in workout shape
 * is how this app SURFACES what that layer already decides about it — it is
 * not a second safety decision, and nothing in this file may ever become one.
 * The resolver never mutates what it is given (its own contract), so this copy
 * exists only to satisfy the type.
 */
export function coachSessionAsWorkout(session: CoachWeekSession): Workout {
  return {
    id: `coach-week:${session.id}`,
    name: session.name,
    kind: session.kind,
    blocks: session.blocks,
    dates: [session.date],
    updatedAt: 0,
  };
}

/**
 * Who published this week — best-effort, exactly like every other coach-side
 * read on this device (`getMyArcOrgId`, `getMyDisplayName`). An athlete with no
 * network, or no coach, gets null, and null must never become an error banner
 * on a training sync.
 *
 * `coach_week_plans` is readable by the athlete it is about
 * (`coach_week_plans_read`: `athlete_user_id = auth.uid()`), which is what
 * makes `coach_user_id` reachable from the phone at all.
 *
 * HONEST GAP, AND IT IS IN THE SCHEMA RATHER THAN HERE. The name comes from
 * `athlete_profiles` through `getDisplayName`, which is the one display-name
 * path this app has and the one this reuses. But `athlete_profiles_read`
 * (20260813_arc_roster_invites_and_names.sql) is
 *
 *     user_id = auth.uid() or public.coaches_athlete_anywhere(user_id)
 *
 * — self, or an athlete of MINE. An athlete reading their COACH's row matches
 * neither branch, so this read is refused today and `coachName` is null in
 * production. That is deliberate on the schema's part: `athlete_profiles` was
 * built as the athlete publishing a name TO their coach, and the reverse
 * direction is a consent question nobody has answered. It is not something a
 * client can work around, and it must not be worked around here — inventing a
 * name from an id, or from an email, is exactly what that migration's "ABSENCE
 * STAYS ABSENCE" rule forbids. The call is written the correct way round so
 * that adding the policy branch (or a coach-profile table) is the only change
 * needed; until then the UI attributes the week to "your coach" by role, which
 * is true, rather than to a name it does not have.
 */
export async function readCoachWeekAttribution(
  client: SupabaseClient,
  userId: string,
  weekStart: string,
): Promise<CoachWeekAttribution | null> {
  const { data, error } = await client
    .from('coach_week_plans')
    .select('coach_user_id')
    .eq('athlete_user_id', userId)
    .eq('week_start', weekStart)
    .eq('status', 'published')
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const coachUserId = (data as { coach_user_id?: unknown }).coach_user_id;
  if (typeof coachUserId !== 'string' || !coachUserId) return null;
  return { coachUserId, coachName: await getDisplayName(client, coachUserId) };
}
