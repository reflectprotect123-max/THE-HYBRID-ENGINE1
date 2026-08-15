import { describe, expect, it } from 'vitest';
import type { AthleteAutocoachReceipt, CoachWeekBody } from './contracts';
import type { DayBuilderValue } from '../library/DayBuilder';
import {
  DAY_STATE_IS_GOOD,
  UNNAMED_HELD_SESSION,
  coachWeekBodyFrom,
  coachWeekDayState,
  daysFromWeekBody,
  emptyWeekBody,
  formatWeekRange,
  heldDaysFromReceipts,
  heldSessionName,
  isMonday,
  publishFailureMessage,
  publishIdempotencyKey,
  weekBodyFromDays,
  weekDates,
  weekStartOfLocalDate,
} from './coach-week';

const MONDAY = '2026-08-10';

function dayWith(category: string): DayBuilderValue {
  return {
    instructions: '',
    blocks: [{ id: 'b1', category, exercises: [{ id: 'e1', name: 'Back squat', columnA: 'reps', columnB: 'weight_kg', sets: [{ id: 's1', a: '5', b: '100' }] }] }],
  };
}

describe('isMonday', () => {
  it('accepts a Monday and refuses every other day', () => {
    expect(isMonday(MONDAY)).toBe(true);
    expect(isMonday('2026-08-11')).toBe(false);
    expect(isMonday('2026-08-09')).toBe(false);
  });

  it('refuses anything that is not an ISO date', () => {
    expect(isMonday('')).toBe(false);
    expect(isMonday('next week')).toBe(false);
    expect(isMonday('2026-08-1')).toBe(false);
  });
});

describe('weekDates', () => {
  it('is seven consecutive days, Monday first', () => {
    expect(weekDates(MONDAY)).toEqual([
      '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13',
      '2026-08-14', '2026-08-15', '2026-08-16',
    ]);
  });

  it('crosses a month boundary without arithmetic drift', () => {
    expect(weekDates('2026-08-31').at(-1)).toBe('2026-09-06');
  });
});

describe('formatWeekRange', () => {
  it('names both ends in full — a confirmation that says "this week" is not one', () => {
    expect(formatWeekRange(MONDAY)).toBe('Monday, 10 August 2026 to Sunday, 16 August 2026');
  });
});

describe('weekBodyFromDays', () => {
  it('always writes seven days, empty ones included', () => {
    const body = weekBodyFromDays(MONDAY, []);
    expect(body.days).toHaveLength(7);
    expect(body.days.every((day) => day.sessions.length === 0)).toBe(true);
    expect(body.schema).toBe('coach-week/1');
    expect(body.weekStart).toBe(MONDAY);
  });

  it('publishes an untouched day as NO sessions, never as one empty workout', () => {
    const days = [dayWith('Strength/Power'), { instructions: '', blocks: [] }];
    const body = weekBodyFromDays(MONDAY, days);
    expect(body.days[0].sessions).toHaveLength(1);
    expect(body.days[1].sessions).toHaveLength(0);
  });

  it('dates each session on its own day and gives it a stable id', () => {
    const body = weekBodyFromDays(MONDAY, [dayWith('Strength/Power')]);
    const session = body.days[0].sessions[0];
    expect(session.dates).toEqual(['2026-08-10']);
    expect(session.id).toBe(`coach-week-${MONDAY}-0`);
    /* Republishing an edited week must UPDATE the athlete's Monday rather than
       leave them two of them, which is what a minted id would do. */
    expect(weekBodyFromDays(MONDAY, [dayWith('Strength/Power')]).days[0].sessions[0].id).toBe(session.id);
  });

  it('splits a mixed day into its strength and conditioning records', () => {
    const mixed: DayBuilderValue = {
      instructions: '',
      blocks: [...dayWith('Strength/Power').blocks, { id: 'b2', category: 'Conditioning', exercises: [] }],
    };
    const sessions = weekBodyFromDays(MONDAY, [mixed]).days[0].sessions;
    expect(sessions.map((s) => s.kind)).toEqual(['strength', 'conditioning']);
  });
});

describe('coachWeekBodyFrom', () => {
  it('normalises unconstrained server JSON into the seven days of the week', () => {
    const body = coachWeekBodyFrom({ days: 'not an array' }, MONDAY);
    expect(body.days.map((d) => d.date)).toEqual(weekDates(MONDAY));
    expect(body.days.every((d) => d.sessions.length === 0)).toBe(true);
  });

  it('survives null, and days that are not objects', () => {
    expect(coachWeekBodyFrom(null, MONDAY).days).toHaveLength(7);
    expect(coachWeekBodyFrom({ days: [1, null, { date: 5 }] }, MONDAY).days).toHaveLength(7);
  });

  it('drops a stored day that is not in this week, and keeps the ones that are', () => {
    const body = coachWeekBodyFrom(
      { days: [{ date: '2026-08-11', sessions: [{ id: 'x' }] }, { date: '2025-01-01', sessions: [{ id: 'old' }] }] },
      MONDAY,
    );
    expect(body.days.map((d) => d.sessions.length)).toEqual([0, 1, 0, 0, 0, 0, 0]);
  });
});

describe('daysFromWeekBody', () => {
  it('round-trips an authored week back into the editors', () => {
    const body = weekBodyFromDays(MONDAY, [dayWith('Strength/Power')]);
    const days = daysFromWeekBody(body, MONDAY);
    expect(days).toHaveLength(7);
    expect(days[0].blocks[0].exercises[0].name).toBe('Back squat');
    expect(days[1].blocks).toHaveLength(0);
  });

  it('treats a missing body as seven empty days', () => {
    expect(daysFromWeekBody(null, MONDAY).every((d) => d.blocks.length === 0)).toBe(true);
  });
});

describe('publishIdempotencyKey', () => {
  it('is the same for the same week published twice', () => {
    const body = weekBodyFromDays(MONDAY, [dayWith('Strength/Power')]);
    expect(publishIdempotencyKey(body, 0)).toBe(publishIdempotencyKey(body, 0));
  });

  it('changes when the week changes — a corrected week must not replay the old one', () => {
    const first = weekBodyFromDays(MONDAY, [dayWith('Strength/Power')]);
    const second = weekBodyFromDays(MONDAY, [dayWith('Conditioning')]);
    expect(publishIdempotencyKey(first, 0)).not.toBe(publishIdempotencyKey(second, 0));
  });

  it('changes when the base version changes', () => {
    const body: CoachWeekBody = emptyWeekBody(MONDAY);
    expect(publishIdempotencyKey(body, 0)).not.toBe(publishIdempotencyKey(body, 1));
  });
});

describe('coachWeekDayState', () => {
  const base = { hasSessions: true, published: true, sessionStatuses: [] as string[], date: '2026-08-11', today: '2026-08-13' };

  it('is rest when nothing is authored', () => {
    expect(coachWeekDayState({ ...base, hasSessions: false })).toBe('rest');
  });

  it('is unpublished when authored but not sent', () => {
    expect(coachWeekDayState({ ...base, published: false })).toBe('unpublished');
  });

  it('is completed when the athlete logged it', () => {
    expect(coachWeekDayState({ ...base, sessionStatuses: ['active', 'completed'] })).toBe('completed');
  });

  it('is not-done only once the day is over', () => {
    expect(coachWeekDayState({ ...base, date: '2026-08-11', today: '2026-08-13' })).toBe('not-done');
    expect(coachWeekDayState({ ...base, date: '2026-08-14', today: '2026-08-13' })).toBe('published');
    /* Today itself is not a missed day. */
    expect(coachWeekDayState({ ...base, date: '2026-08-13', today: '2026-08-13' })).toBe('published');
  });

  it('lets a hold outrank everything, so "held" never reads as "ignored me"', () => {
    expect(coachWeekDayState({ ...base, held: 'pain' })).toBe('held-pain');
    expect(coachWeekDayState({ ...base, held: 'illness', sessionStatuses: ['completed'] })).toBe('held-illness');
    /* `heldDaysFromReceipts` supplies the fact. Without one, nothing guesses. */
    expect(coachWeekDayState({ ...base, held: null })).not.toMatch(/^held/);
  });

  it('never colours a held day as a good one', () => {
    expect(DAY_STATE_IS_GOOD['held-pain']).toBe(false);
    expect(DAY_STATE_IS_GOOD['held-illness']).toBe(false);
    expect(DAY_STATE_IS_GOOD.completed).toBe(true);
  });
});

describe('publishFailureMessage', () => {
  it('says nothing was published when another coach got there first', () => {
    const text = publishFailureMessage(new Error('week was modified by someone else'));
    expect(text).toMatch(/nothing was published/i);
  });

  it('does not pretend to know which half of an authorisation failure it was', () => {
    const text = publishFailureMessage(new Error('not permitted'));
    expect(text).toMatch(/Nothing has changed/);
    expect(text).not.toMatch(/organisation|relationship/i);
  });

  it('falls back to a plain refusal for anything unrecognised', () => {
    expect(publishFailureMessage({})).toMatch(/was not published/i);
    expect(publishFailureMessage(new Error('network'))).toMatch(/Nothing has changed/);
  });
});

describe('heldDaysFromReceipts', () => {
  /* A week with Monday and Tuesday authored, so there are real published
     sessions with real ids for a receipt to point at. */
  const week = weekBodyFromDays(MONDAY, [dayWith('Strength/Power'), dayWith('Strength/Power')]);
  const mondayId = week.days[0].sessions[0].id;
  const tuesdayId = week.days[1].sessions[0].id;

  function receipt(over: Partial<AthleteAutocoachReceipt> = {}): AthleteAutocoachReceipt {
    return {
      clientEntryId: 'entry-1',
      occurredAt: `${MONDAY}T07:00:00.000Z`,
      sessionDate: MONDAY,
      workoutId: mondayId,
      action: 'held',
      wasForked: false,
      operations: [],
      reasonCodes: ['pain_hold_active'],
      ...over,
    };
  }

  it('puts a held session on its own day, with the reason and the coach’s own name for it', () => {
    const held = heldDaysFromReceipts([receipt()], week, MONDAY);
    expect(held[MONDAY]).toEqual({ reason: 'pain', sessionName: 'Mon · 2026-08-10' });
    expect(held['2026-08-11']).toBeUndefined();
  });

  it('tells pain and illness apart, because a coach acts differently on each', () => {
    const illness = heldDaysFromReceipts(
      [receipt({ sessionDate: '2026-08-11', workoutId: tuesdayId, reasonCodes: ['illness_flag_active'] })],
      week,
      MONDAY,
    );
    expect(illness['2026-08-11'].reason).toBe('illness');
  });

  it('lets pain outrank illness, on one receipt and across two', () => {
    const both = heldDaysFromReceipts(
      [receipt({ reasonCodes: ['illness_flag_active', 'pain_hold_active'] })],
      week,
      MONDAY,
    );
    expect(both[MONDAY].reason).toBe('pain');

    /* Illness first, so this only passes if the later pain receipt REPLACES
       it rather than being dropped as a duplicate day. */
    const twoReceipts = heldDaysFromReceipts(
      [
        receipt({ clientEntryId: 'a', reasonCodes: ['illness_flag_active'] }),
        receipt({ clientEntryId: 'b', reasonCodes: ['pain_hold_active'] }),
      ],
      week,
      MONDAY,
    );
    expect(twoReceipts[MONDAY].reason).toBe('pain');
  });

  it('says "a session" rather than inventing a name or showing a raw id', () => {
    const held = heldDaysFromReceipts([receipt({ workoutId: 'gone-from-the-week' })], week, MONDAY);
    expect(held[MONDAY].sessionName).toBe(UNNAMED_HELD_SESSION);
    expect(held[MONDAY].sessionName).not.toContain('gone-from-the-week');
    /* And the same when there is no published week at all to resolve against. */
    expect(heldDaysFromReceipts([receipt()], null, MONDAY)[MONDAY].sessionName).toBe(UNNAMED_HELD_SESSION);
  });

  it('is empty when the receipts are absent — an absent fact is not a fact', () => {
    expect(heldDaysFromReceipts(null, week, MONDAY)).toEqual({});
    expect(heldDaysFromReceipts(undefined, week, MONDAY)).toEqual({});
    expect(heldDaysFromReceipts([], week, MONDAY)).toEqual({});
  });

  it('reads only held receipts — an applied one is a session the athlete trained', () => {
    expect(heldDaysFromReceipts([receipt({ action: 'applied' })], week, MONDAY)).toEqual({});
    expect(heldDaysFromReceipts([receipt({ action: 'undone' })], week, MONDAY)).toEqual({});
  });

  it('ignores a hold from another week, so last week’s pain never marks this one', () => {
    expect(heldDaysFromReceipts([receipt({ sessionDate: '2026-08-03' })], week, MONDAY)).toEqual({});
    expect(heldDaysFromReceipts([receipt({ sessionDate: '2026-08-17' })], week, MONDAY)).toEqual({});
  });

  it('will not attribute a hold that names neither safety flag', () => {
    /* `action: 'held'` with, say, `low_readiness` is reachable by a raw RPC
       call. There is no held state that does not name a flag, and guessing one
       would invent a medical fact about a person. */
    expect(heldDaysFromReceipts([receipt({ reasonCodes: ['low_readiness'] })], week, MONDAY)).toEqual({});
    expect(heldDaysFromReceipts([receipt({ reasonCodes: [] })], week, MONDAY)).toEqual({});
  });
});

describe('heldSessionName', () => {
  const week = weekBodyFromDays(MONDAY, [dayWith('Strength/Power')]);

  it('resolves the id against the week the coach published', () => {
    expect(heldSessionName(week, week.days[0].sessions[0].id)).toBe('Mon · 2026-08-10');
  });

  it('finds a session on any day, because the DAY comes from the receipt', () => {
    const twoDays = weekBodyFromDays(MONDAY, [dayWith('Strength/Power'), dayWith('Strength/Power')]);
    expect(heldSessionName(twoDays, twoDays.days[1].sessions[0].id)).toBe('Tue · 2026-08-11');
  });

  it('falls back rather than printing an id nobody named', () => {
    expect(heldSessionName(week, 'nope')).toBe(UNNAMED_HELD_SESSION);
    expect(heldSessionName(null, 'nope')).toBe(UNNAMED_HELD_SESSION);
  });
});

describe('weekStartOfLocalDate', () => {
  /* The bug this exists for is invisible at UTC and behind it, so a test that
     only runs in the container's timezone proves nothing. `TZ` is read once
     per process by Node, so the honest way to cover it here is to drive the
     function with the local-date components a given zone would produce — the
     function only ever reads getFullYear/getMonth/getDate, so a Date built
     from those components IS the input it would receive in that zone.

     The old implementation formatted with `toISOString()`, which converts to
     UTC first. In London/Berlin/Sydney that printed the SUNDAY before, which
     `isMonday` then correctly refused — closing the only door to the week
     builder for every coach east of Greenwich. */
  it('returns a Monday for every day of a week', () => {
    // Mon 17th … Sun 23rd August 2026 all belong to the week of the 17th.
    for (let day = 17; day <= 23; day += 1) {
      expect(weekStartOfLocalDate(new Date(2026, 7, day, 0, 30))).toBe('2026-08-17');
    }
    expect(weekStartOfLocalDate(new Date(2026, 7, 24))).toBe('2026-08-24');
  });

  it('never round-trips through UTC — local midnight stays on its own date', () => {
    // The regression, stated directly: this is the exact call the Command
    // Center makes, and the old code returned '2026-08-16' — a Sunday — for it
    // anywhere at UTC+.
    const wednesday = new Date(2026, 7, 19, 0, 0, 0);
    const monday = weekStartOfLocalDate(wednesday);
    expect(monday).toBe('2026-08-17');
    expect(isMonday(monday)).toBe(true);
  });

  it('agrees with weekDates, which the builder uses for the same week', () => {
    const monday = weekStartOfLocalDate(new Date(2026, 7, 19));
    expect(weekDates(monday)[0]).toBe(monday);
    expect(weekDates(monday)).toHaveLength(7);
  });

  it('crosses a month and a year boundary without drifting', () => {
    expect(weekStartOfLocalDate(new Date(2026, 8, 2))).toBe('2026-08-31');  // Wed 2 Sep -> Mon 31 Aug
    expect(weekStartOfLocalDate(new Date(2027, 0, 1))).toBe('2026-12-28');  // Fri 1 Jan -> Mon 28 Dec
  });

  it('is a Monday for a whole year of dates, whatever the day', () => {
    for (let offset = 0; offset < 365; offset += 1) {
      const d = new Date(2026, 0, 1 + offset);
      expect(isMonday(weekStartOfLocalDate(d))).toBe(true);
    }
  });
});
