import type { Session, Workout } from '@hybrid/engine';
import type { AthleteWeekSummary } from './contracts';

/**
 * The seven days of the selected athlete's current week, for the Command
 * Center's week panel.
 *
 * Why this exists as its own pure module: the Command Center reads its week
 * from TWO different places depending on who is selected, and neither of them
 * is shaped like a week.
 *
 *  - The signed-in coach's own training comes from the local stores — logged
 *    `Session`s carry a date, and `Workout`s carry `days` (weekday numbers)
 *    with no date at all, so a scheduled day has to be projected onto the
 *    week before it can be shown beside a logged one.
 *  - A roster athlete's week comes from `getAthleteWeekSummary`, which is
 *    already dated but says nothing about what was merely scheduled.
 *
 * Folding both into one shape here keeps the screen free of that difference,
 * and — the reason it is pure — lets the folding be tested without a browser.
 *
 * Nothing here invents a day. A day with nothing on it is `entries: []`, and
 * the screen says so; it never shows a rest day the coach did not program as
 * though it were planned.
 */

export type DayStatus = 'logged' | 'active' | 'scheduled';

export interface WeekDayEntry {
  id: string;
  name: string;
  status: DayStatus;
}

export interface WeekDay {
  /** YYYY-MM-DD */
  date: string;
  /** Monday-first index, 0-6 — the position in the rendered row, not `getDay`. */
  index: number;
  entries: WeekDayEntry[];
}

/** The seven dates of the week beginning `weekStart` (a Monday, YYYY-MM-DD). */
export function weekDates(weekStart: string): string[] {
  const [y, m, d] = weekStart.split('-').map(Number);
  return Array.from({ length: 7 }, (_, i) => {
    // UTC throughout: these are calendar dates, not instants, and building
    // them in local time makes the week shift by a day either side of a
    // timezone boundary — the same bug the Library's month grid avoids the
    // same way.
    const day = new Date(Date.UTC(y, m - 1, d + i));
    return day.toISOString().slice(0, 10);
  });
}

/**
 * A logged session outranks a scheduled one on the same day.
 *
 * A workout scheduled for Monday that the athlete actually did on Monday
 * would otherwise appear twice — once as a plan and once as a fact — and the
 * fact is the one a coach is reading for. Matched on `workoutId`, so a
 * DIFFERENT session logged that day still shows beside the plan rather than
 * silently replacing it.
 */
function mergeDay(logged: WeekDayEntry[], scheduled: WeekDayEntry[], loggedWorkoutIds: Set<string>): WeekDayEntry[] {
  return [...logged, ...scheduled.filter((entry) => !loggedWorkoutIds.has(entry.id))];
}

/** The signed-in coach's own week, from the local stores. */
export function localWeek(weekStart: string, sessions: readonly Session[], workouts: readonly Workout[]): WeekDay[] {
  const dates = weekDates(weekStart);
  return dates.map((date, index) => {
    const onDay = sessions.filter((session) => session.date === date);
    const logged: WeekDayEntry[] = onDay.map((session) => ({
      id: session.workoutId ?? session.id,
      name: session.name || 'Session',
      status: session.status === 'active' ? 'active' : 'logged',
    }));
    const loggedWorkoutIds = new Set(onDay.map((session) => session.workoutId).filter((id): id is string => !!id));

    /* `Workout.days` is `getDay`'s numbering — Sunday 0 — while `index` here
       is Monday-first. Converting one to the other rather than assuming they
       agree: they do not, and the off-by-one puts every Sunday session on the
       wrong end of the week. */
    const weekday = (index + 1) % 7;
    const scheduled: WeekDayEntry[] = workouts
      .filter((workout) => (workout.days ?? []).includes(weekday))
      .map((workout) => ({ id: workout.id, name: workout.name || 'Session', status: 'scheduled' as const }));

    return { date, index, entries: mergeDay(logged, scheduled, loggedWorkoutIds) };
  });
}

/** A roster athlete's week, from the summary the repository returns. */
export function rosterWeek(weekStart: string, summary: AthleteWeekSummary | null): WeekDay[] {
  const dates = weekDates(weekStart);
  return dates.map((date, index) => ({
    date,
    index,
    entries: (summary?.sessions ?? [])
      .filter((session) => session.date === date)
      .map((session) => ({
        id: session.id,
        name: session.name || 'Session',
        // The summary's status vocabulary is the database's, not this
        // screen's. Anything that is not explicitly published-and-done is
        // shown as scheduled rather than guessed at.
        status: session.status === 'completed' ? 'logged' : 'scheduled',
      })),
  }));
}

/** "2 of 5 logged" — counted, never written. */
export function weekTally(days: readonly WeekDay[]): { logged: number; total: number } {
  const entries = days.flatMap((day) => day.entries);
  return {
    logged: entries.filter((entry) => entry.status === 'logged').length,
    total: entries.length,
  };
}
