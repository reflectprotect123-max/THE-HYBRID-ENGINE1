import { describe, expect, it } from 'vitest';
import type { Session, Workout } from '@hybrid/engine';
import type { AthleteWeekSummary } from './contracts';
import { localWeek, rosterWeek, weekDates, weekTally } from './command-week';

/*
 * The Command Center's week panel folds two differently-shaped sources into
 * one row of seven days. These tests pin the three places that fold can
 * silently go wrong: the weekday numbering, the logged-beats-scheduled merge,
 * and the timezone the dates are built in.
 */

const MONDAY = '2026-08-10';

function session(over: Partial<Session>): Session {
  return { id: 's1', date: MONDAY, status: 'done', blocks: [], ...over } as Session;
}

function workout(over: Partial<Workout>): Workout {
  return { id: 'w1', name: 'Lower A', days: [1], updatedAt: 1, blocks: [] } as unknown as Workout;
}

describe('weekDates', () => {
  it('returns the seven dates from the given Monday', () => {
    expect(weekDates(MONDAY)).toEqual([
      '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13',
      '2026-08-14', '2026-08-15', '2026-08-16',
    ]);
  });

  /*
   * Built in UTC on purpose. Constructing these in local time makes the week
   * slide by a day either side of a timezone boundary — a coach in UTC-7
   * would see Sunday's session on Saturday. `new Date(y, m, d)` is the bug;
   * `Date.UTC` is the fix, and this is the test that keeps it that way.
   */
  it('does not drift across a timezone boundary', () => {
    const days = weekDates('2026-01-01');
    expect(days[0]).toBe('2026-01-01');
    expect(days[6]).toBe('2026-01-07');
  });
});

describe('localWeek', () => {
  /*
   * `Workout.days` uses `getDay`'s numbering, where SUNDAY IS 0. The panel's
   * own index is Monday-first, 0-6. Assuming they agree puts every Sunday
   * workout on Monday — which is why this case is tested explicitly rather
   * than left to the happy path.
   */
  it('places a Sunday workout on Sunday, not Monday', () => {
    const days = localWeek(MONDAY, [], [{ ...workout({}), id: 'wSun', name: 'Zone 2 Run', days: [0] } as unknown as Workout]);
    expect(days[0].entries).toEqual([]);
    expect(days[6].entries.map((e) => e.name)).toEqual(['Zone 2 Run']);
  });

  it('places a Monday workout on Monday', () => {
    const days = localWeek(MONDAY, [], [workout({})]);
    expect(days[0].entries.map((e) => e.name)).toEqual(['Lower A']);
  });

  /*
   * A workout scheduled for Monday that the athlete actually DID on Monday is
   * one thing that happened, not two. The fact wins; the plan is dropped.
   */
  it('lets a logged session replace the workout it was scheduled from', () => {
    const days = localWeek(MONDAY, [session({ workoutId: 'w1', name: 'Lower A' })], [workout({})]);
    expect(days[0].entries).toEqual([{ id: 'w1', name: 'Lower A', status: 'logged' }]);
  });

  /*
   * ...but a DIFFERENT session logged that day is an extra thing that
   * happened, and hiding it would be the panel quietly editing the record.
   */
  it('keeps a session logged from some other workout beside the scheduled one', () => {
    const days = localWeek(MONDAY, [session({ id: 's9', workoutId: 'w9', name: 'Extra' })], [workout({})]);
    expect(days[0].entries.map((e) => e.name).sort()).toEqual(['Extra', 'Lower A']);
  });

  it('marks a session still in progress as active rather than logged', () => {
    const days = localWeek(MONDAY, [session({ status: 'active', name: 'Lower A' })], []);
    expect(days[0].entries[0].status).toBe('active');
  });

  it('leaves a day with nothing on it empty rather than inventing a rest day', () => {
    const days = localWeek(MONDAY, [], []);
    expect(days.every((day) => day.entries.length === 0)).toBe(true);
  });
});

describe('rosterWeek', () => {
  it('reads the summary the repository returned', () => {
    const summary = {
      entries: [],
      decisions: [],
      sessions: [
        { id: 'a', kind: 'strength', date: '2026-08-11', status: 'completed', name: 'Upper A' },
        { id: 'b', kind: 'strength', date: '2026-08-13', status: 'published', name: null },
      ],
    } as unknown as AthleteWeekSummary;

    const days = rosterWeek(MONDAY, summary);
    expect(days[1].entries).toEqual([{ id: 'a', name: 'Upper A', status: 'logged' }]);
    // Unnamed is still a real session — labelled, never dropped.
    expect(days[3].entries).toEqual([{ id: 'b', name: 'Session', status: 'scheduled' }]);
  });

  /*
   * Null is a FACT on this contract, not a failure: a roster-summary client
   * has an authorised summary and no readable detail. An empty week is the
   * honest render; the screen says which of the two it is.
   */
  it('gives an empty week for a client whose detail is not readable', () => {
    const days = rosterWeek(MONDAY, null);
    expect(days).toHaveLength(7);
    expect(days.every((day) => day.entries.length === 0)).toBe(true);
  });
});

describe('weekTally', () => {
  it('counts logged against everything on the week', () => {
    const days = localWeek(
      MONDAY,
      [session({ workoutId: 'w1', name: 'Lower A' })],
      [workout({}), { ...workout({}), id: 'w2', name: 'Upper A', days: [3] } as unknown as Workout],
    );
    expect(weekTally(days)).toEqual({ logged: 1, total: 2 });
  });
});
