import type { Workout } from '@hybrid/engine';
import { plannedForToday } from './Home';

/*
 * WHAT THIS FILE USED TO COVER, and why almost all of it is gone.
 *
 * `plannedForToday` took the auto-coach ledger as a second argument. Approving
 * an Auto-Coached proposal for a RECURRING session wrote a one-off fork dated
 * today rather than mutating the template, so both matched this filter — the
 * fork by `dates`, the original still by `days` — and "Today's plan" showed
 * the session twice, with "Start today's session" attached to the first card,
 * the UN-adjusted original. That silently undid the approval the athlete had
 * just given. Five of the six cases here were about that one interaction:
 * dropping the superseded original, bringing it back on undo, ignoring a fork
 * entry from another date, keeping the original when the ledger named a fork
 * that no longer existed, and leaving an in-place apply alone.
 *
 * `@hybrid/auto-coach` was deleted on 14 August 2026, so nothing forks a
 * workout and there is no ledger. Those cases are not weakened, they are
 * unreachable — there is no second argument to pass. What is left is the
 * filter itself, which was always the load-bearing half and was only ever
 * asserted in passing.
 */

const TODAY = '2026-08-10';
const DOW = new Date(`${TODAY}T00:00:00`).getDay(); // local, as Home computes it

const workout = (over: Record<string, unknown>): Workout =>
  ({ name: 'Session', kind: 'strength', blocks: [], ...over } as unknown as Workout);

describe('plannedForToday', () => {
  it('takes a session dated today, and one recurring on today’s weekday', () => {
    const dated = workout({ id: 'w-dated', dates: [TODAY] });
    const recurring = workout({ id: 'w-recurring', days: [DOW] });
    expect(plannedForToday([dated, recurring], TODAY, DOW).map((w) => w.id)).toEqual([
      'w-dated',
      'w-recurring',
    ]);
  });

  it('leaves out another day’s session, by either route', () => {
    const otherDate = workout({ id: 'w-yesterday', dates: ['2026-08-09'] });
    const otherDay = workout({ id: 'w-tomorrow', days: [(DOW + 1) % 7] });
    expect(plannedForToday([otherDate, otherDay], TODAY, DOW)).toEqual([]);
  });

  it('lists a session once when it matches BOTH ways', () => {
    /* A workout carrying today's date AND today's weekday is one session, not
       two. `filter` cannot double it — this pins that, because the version
       with the ledger built a Set and a careless rewrite could. */
    const both = workout({ id: 'w-both', dates: [TODAY], days: [DOW] });
    expect(plannedForToday([both], TODAY, DOW).map((w) => w.id)).toEqual(['w-both']);
  });

  it('survives a workout with neither field', () => {
    /* `dates` and `days` are both optional on Workout, and a library session
       that is never scheduled has neither. */
    const unscheduled = workout({ id: 'w-none' });
    expect(plannedForToday([unscheduled], TODAY, DOW)).toEqual([]);
  });

  it('preserves the order it was given', () => {
    const a = workout({ id: 'a', dates: [TODAY] });
    const b = workout({ id: 'b', dates: [TODAY] });
    expect(plannedForToday([b, a], TODAY, DOW).map((w) => w.id)).toEqual(['b', 'a']);
  });
});
