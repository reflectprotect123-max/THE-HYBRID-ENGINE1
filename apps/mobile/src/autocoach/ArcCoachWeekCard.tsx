import { useMemo } from 'react';
import { View } from 'react-native';
import { mondayOf, ymd } from '@hybrid/engine';
import { coachWeekFromNamespace, type CoachWeek } from '../cloud/arc-coach-week';
import { useSync } from '../cloud/sync';
import { useDb } from '../store/db';
import { Card, Kicker, T } from '../ui';

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
 *   whether today's session runs    -> NOBODY, since 14 August 2026
 *
 * That second row read "UNCHANGED, the per-session safety layer" until
 * `@hybrid/auto-coach` was deleted. It is not a gap in this card: there is no
 * layer left to ask. See "The auto-coach is deleted" in CLAUDE.md.
 *
 * THREE THINGS THIS CARD IS REQUIRED TO DO, AND ONE IT IS REQUIRED NOT TO:
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
 * The fourth requirement was NO SILENT DIVERGENCE: if the safety layer held
 * today's session, the athlete had to be told which one and why, in that
 * layer's own words. It is gone because the thing it described is gone —
 * nothing holds a session now, so there is no divergence to disclose. It is
 * recorded here rather than deleted silently, because a card that once
 * explained why a session did not happen and now does not is a real change in
 * what the athlete is told.
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
  const { coachWeekAttribution } = useSync();

  /*
   * `heldToday` and the effect that reported it to the coach stood here until
   * 14 August 2026. Both are gone with `@hybrid/auto-coach`:
   *
   *   - `heldToday` called `resolveSession` over today's coach sessions and
   *     kept the ones that came back `safety_stop`.
   *   - The effect pushed those to `push_autocoach_receipt`, so the coach saw
   *     "held (pain)" against the day instead of an unexplained blank.
   *
   * The owner deleted the whole layer, safety stop included, having been told
   * that is what it meant. So there is no verdict to read out and nothing to
   * report. `athleteState` is still derived and still on screen elsewhere —
   * it is context now, not a gate.
   */

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

      {/* The held-session panel rendered here. It is gone with the layer that
          decided a hold — see the note above `by`. Nothing replaced it,
          deliberately: an empty red box explaining that holds no longer exist
          would be worse than the silence. */}

      <T className="mt-1.5 text-3 text-dim">
        This is the week your coach wrote for you — it is not arranged by the app. You can still
        train anything else you like, and you decide whether a session runs today.
      </T>
    </Card>
  );
}
