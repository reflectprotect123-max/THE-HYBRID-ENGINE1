import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useDb } from '../store/db';
import { Empty, Kicker, ScreenTitle } from '../ui';
import { WorkoutDetail } from './Library';

/*
 * A read-only look at one day: what is scheduled there, nothing else.
 *
 * `resolveDayTarget` only ever sends a tap here for a day that is neither a
 * completed session (that opens its own Recap) nor today (that opens
 * Training, where Start actually lives) — see apps/web/src/lib/session.ts.
 * That split is what keeps this screen honest: no Start button, no write of
 * any kind. Starting or logging a session for a non-today date is explicitly
 * out of scope (docs/superpowers/specs/2026-08-02-calendar-day-jump-design.md).
 *
 * The route carries only the date (`/day/:date`), not a workout id — the
 * match is re-derived here from `db.workouts`, the exact same `dates`/`days`
 * logic Calendar's `buildMonth` already uses to decide the dot for this same
 * cell. Re-deriving rather than trusting an id passed through navigation
 * state keeps this screen correct on a hard reload or a direct link, where
 * state would already be gone.
 */
export function Day() {
  const { date = '' } = useParams();
  const { db } = useDb();

  const at = useMemo(() => {
    const t = Date.parse(date + 'T12:00:00');
    return Number.isFinite(t) ? new Date(t) : null;
  }, [date]);

  const matched = useMemo(() => {
    if (!at) return undefined;
    const dow = at.getDay();
    return db.workouts.find((w) => (w.dates || []).includes(date) || (w.days || []).includes(dow));
  }, [db.workouts, date, at]);

  const heading = at ? at.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) : date;

  return (
    <>
      <Kicker>Day</Kicker>
      <ScreenTitle>{heading}</ScreenTitle>

      {matched ? (
        <div className="mt-1">
          {/* `WorkoutDetail` is only the expand-BODY — Library renders the
              workout's own name in the card header above it, so reusing the
              body alone here left the preview never saying WHICH session is
              scheduled. Same `text-5 font-[750]` as that card header, and the
              same element mobile's Day.tsx renders above its <Detail>. */}
          <h2 className="truncate text-5 font-[750]">{matched.name || 'Session'}</h2>
          <WorkoutDetail w={matched} />
        </div>
      ) : (
        <div className="mt-2">
          <Empty title="Nothing scheduled" body="Nothing scheduled for this day." />
        </div>
      )}
    </>
  );
}
