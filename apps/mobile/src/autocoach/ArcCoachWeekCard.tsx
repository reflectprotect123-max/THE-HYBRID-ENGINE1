import { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import { resolveSession } from '@hybrid/auto-coach';
import { mondayOf, ymd } from '@hybrid/engine';
import {
  coachSessionAsWorkout,
  coachWeekFromNamespace,
  type CoachWeek,
} from '../cloud/arc-coach-week';
import { useSync } from '../cloud/sync';
import { useDb } from '../store/db';
import { Card, Kicker, T } from '../ui';
import { usePolicy } from './policy';

/*
 * THE COACH'S WEEK, AS THE ATHLETE'S WEEK.
 *
 * A coach publishes (`publish_coach_week`), the row lands in the athlete's own
 * `athlete_weekly_plans` with `writer = 'coach'`, the ordinary ecosystem pull
 * brings it down, and this is what it looks like on the phone. The authority
 * table in docs/superpowers/specs/2026-08-13-coach-publishes-the-week-design.md
 * is the whole specification of this card:
 *
 *   which sessions, which days      -> the coach
 *   whether today's session runs    -> UNCHANGED, the per-session safety layer
 *
 * FOUR THINGS THIS CARD IS REQUIRED TO DO, AND ONE IT IS REQUIRED NOT TO:
 *
 * 1. Render the coach's week as THE week. Not as a suggestion beside the
 *    Coordinator's, not as an inbox item. Home shows this INSTEAD of the
 *    Coordinated-week card for the weeks a coach has published, because two
 *    weeks on one screen is precisely the ambiguity "coach wins outright" was
 *    chosen to end.
 * 2. Attribute it. It has to be unmistakable that a person wrote this and not
 *    the app. See the attribution line below, and the note on `coachName` in
 *    ../cloud/arc-coach-week.ts about why the NAME is often missing today.
 * 3. NO ACCEPT/DECLINE. This is deliberately not ArcAssignmentCard's shape and
 *    must never grow into it. An assignment is a proposal and carries two
 *    buttons; a published week is not renegotiated session by session, because
 *    the athlete already consented — once, deliberately, by redeeming their
 *    coach's invite — and that roster link IS the consent boundary. There are
 *    no buttons on this card at all.
 * 4. NO SILENT DIVERGENCE. If the safety layer holds today's session, the
 *    athlete is told which session and why, in the layer's own words. See
 *    `heldToday` below.
 *
 * And the thing it must not do: imply the athlete is now locked in. The
 * closing line says so explicitly. A coach owning the WEEK is a scheduling
 * fact; the athlete's Library, their ability to start anything they like, and
 * their right to stop are all untouched by it.
 */

/**
 * The coach-published week for the current Monday, or null.
 *
 * Read straight off the store rather than passed down, because the store is
 * what survives being offline — the week is already in `EngineDB.ecosystem`
 * and does not need the network to render. Exported so Home can ask the same
 * question this card answers without rendering it twice.
 */
export function useCoachWeek(): CoachWeek | null {
  const { db } = useDb();
  const weekStart = mondayOf(ymd(new Date()));
  return useMemo(() => coachWeekFromNamespace(db.ecosystem, weekStart), [db.ecosystem, weekStart]);
}

const WEEKDAY = (date: string): string =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' });

export function ArcCoachWeekCard({ week }: { week: CoachWeek }) {
  const { athleteState } = useDb();
  const { coachWeekAttribution, reportHeldSessions } = useSync();
  const policy = usePolicy();
  const today = ymd(new Date());

  const todaysSessions = useMemo(
    () => week.sessions.filter((s) => s.date === today),
    [week.sessions, today],
  );

  /*
   * WHY a session is held, from the layer that decided it.
   *
   * `resolveSession` is @hybrid/auto-coach's pure, session-level resolver, and
   * it is the SAME call ../autocoach/SessionReceipt.tsx makes for a local
   * workout. Nothing is re-decided here: a hard constraint (pain, illness)
   * produces `state: 'safety_stop'` inside that package, before readiness is
   * consulted at all, and this reads the answer out. The safety layer is not
   * this commit's to change and has not been changed.
   *
   * ONLY TODAY. `athleteState` is today's snapshot — today's flags, today's
   * readiness — so asking it about Thursday's session would produce a
   * confident answer about a day whose facts do not exist yet, and an athlete
   * who saw "held" against Thursday on Monday would be being lied to. Future
   * days therefore carry no verdict at all, which is the honest rendering.
   */
  const heldToday = useMemo(
    () =>
      todaysSessions
        .map((session) => ({
          session,
          resolution: resolveSession({
            workout: coachSessionAsWorkout(session),
            policy,
            state: athleteState,
          }),
        }))
        .filter((x) => x.resolution.state === 'safety_stop'),
    [todaysSessions, policy, athleteState],
  );

  /*
   * THE COACH-FACING HALF, and the one place that knows the session, the day
   * and the reason code at the same time — which is exactly where the seam
   * comment below predicted it would go.
   *
   * Fires off the computed holds rather than recomputing anything: the verdict
   * above is auto-coach's, unchanged, and this only reports it. Reporting is
   * idempotent per session per day inside `pushHeldSessions`, so a re-render,
   * a remount or a second foreground on the same afternoon does not file a
   * second hold.
   *
   * Not awaited and never surfaced. Nobody pressed a button, so a failure has
   * no tap to report to — and an unsent hold stays unmarked, so the next
   * render tries again. A hold that never arrives reads to the coach as
   * "ignored me", which is the outcome this whole path exists to prevent.
   */
  useEffect(() => {
    if (heldToday.length === 0) return;
    void reportHeldSessions(
      heldToday.map(({ session, resolution }) => ({
        workoutId: session.id,
        sessionDate: today,
        reasonCodes: resolution.reasonCodes,
      })),
    );
  }, [heldToday, today, reportHeldSessions]);

  const by = coachWeekAttribution?.coachName;

  return (
    /* `mt-2` rather than a SectionHead above it: the Kicker inside already
       names the section, and a header saying the same words twice was pure
       vertical cost on a phone. Home's Coordinator branch keeps its
       SectionHead because its card carries no kicker of its own. */
    <Card className="mt-2">
      <Kicker>Your coach&rsquo;s week</Kicker>
      <T className="mt-0.5 text-3 text-dim">
        {by ? `Published by ${by}` : 'Published by your coach'} · week of {week.weekStart}
      </T>

      {week.sessions.length ? (
        <View className="mt-1">
          {week.sessions.map((session) => (
            <View key={session.id} className="mt-0.5 flex-row justify-between gap-1">
              <T className="flex-1 text-3 text-muted" numberOfLines={1}>
                {session.name}
              </T>
              <T num className="text-3 text-dim">
                {WEEKDAY(session.date)} {session.date}
              </T>
            </View>
          ))}
        </View>
      ) : (
        <T className="mt-1 text-3 text-muted">
          Your coach published this week with nothing scheduled in it.
        </T>
      )}

      {/*
        The held explanation. Its absence is the "silent divergence" the design
        doc names: a session that quietly does not happen, with the athlete left
        to guess whether the app forgot it or their coach changed their mind.
      */}
      {heldToday.map(({ session, resolution }) => (
        <View key={`held:${session.id}`} className="mt-1.5 rounded-md border border-bad/40 p-1.5">
          <T w="semi" className="text-3 text-bad">
            Held today — {session.name}
          </T>
          {resolution.inferences.map((line, i) => (
            <T key={i} className="mt-0.5 text-3 text-muted">
              {line}
            </T>
          ))}
          <T className="mt-1 text-3 text-dim">{resolution.athleteMessage}</T>
          {/*
            The coach-facing half is no longer a seam — see the effect above,
            which reports these holds through `push_autocoach_receipt`. The
            comment that stood here described the gap and predicted where the
            write would go; it went exactly there, one level up, where the
            session, the day and the reason code are all in scope at once.
          */}
        </View>
      ))}

      <T className="mt-1.5 text-3 text-dim">
        This is the week your coach wrote for you — it is not arranged by the app. You can still
        train anything else you like, and a pain or illness flag still stops a session, whoever
        planned it.
      </T>
    </Card>
  );
}
