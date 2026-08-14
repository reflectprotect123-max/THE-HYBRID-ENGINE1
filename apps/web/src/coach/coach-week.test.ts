import { describe, expect, it } from 'vitest';
import type { CoachWeekBody } from './contracts';
import type { DayBuilderValue } from './library/DayBuilder';
import {
  DAY_STATE_IS_GOOD,
  coachWeekBodyFrom,
  coachWeekDayState,
  daysFromWeekBody,
  emptyWeekBody,
  formatWeekRange,
  isMonday,
  publishFailureMessage,
  publishIdempotencyKey,
  weekBodyFromDays,
  weekDates,
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
    /* Step 5 supplies the fact; until it does, nothing may guess one. */
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
