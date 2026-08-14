import { describe, expect, it } from 'vitest';
import type { Workout } from '@hybrid/engine';
import { plannedForToday, showZonesCard } from './Home';

describe('showZonesCard', () => {
  it('hides the zones door for a strength-scoped build', () => {
    expect(showZonesCard('strength', true)).toBe(false);
  });

  it('keeps the zones door for a conditioning-scoped build', () => {
    expect(showZonesCard('conditioning', true)).toBe(true);
  });

  it('keeps the zones door for the unscoped dashboard build, even if the product defaulted to strength', () => {
    expect(showZonesCard('strength', false)).toBe(true);
  });
});

/*
 * WHAT THIS SECTION USED TO COVER, and why almost all of it is gone.
 *
 * `plannedForToday` took the auto-coach ledger as a second argument.
 * Approving an Auto-Coached proposal for a RECURRING session wrote a one-off
 * fork dated today rather than mutating the template, so both matched this
 * filter — the fork by `dates`, the original still by `days` — and "Today's
 * plan" showed the session twice, with "Start today's session" on the first
 * card, the un-adjusted original. Five of the six cases were about that one
 * interaction.
 *
 * `@hybrid/auto-coach` was deleted on 14 August 2026, so nothing forks a
 * workout and there is no ledger. Those cases are unreachable rather than
 * weakened — there is no second argument to pass. What remains is the filter
 * itself, which was always the load-bearing half.
 */
const TODAY = '2026-08-10';
const DOW = new Date(`${TODAY}T00:00:00Z`).getUTCDay(); // Monday = 1

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
    /* One session, not two. The ledger version built a Set and a careless
       rewrite could double it. */
    const both = workout({ id: 'w-both', dates: [TODAY], days: [DOW] });
    expect(plannedForToday([both], TODAY, DOW).map((w) => w.id)).toEqual(['w-both']);
  });

  it('survives a workout with neither field', () => {
    expect(plannedForToday([workout({ id: 'w-none' })], TODAY, DOW)).toEqual([]);
  });
});
