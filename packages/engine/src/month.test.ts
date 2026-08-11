import { describe, expect, it } from 'vitest';
import { monthGrid, calendarMonthLabel, shiftMonth } from './month';

/*
 * UTC throughout, like `mondayOf` in @hybrid/coordinator-adapter. A local-time
 * month grid puts a coach in UTC-7 on the wrong day for the first seven hours
 * of every day — the kind of bug that only ever reproduces for the person who
 * cannot debug it.
 *
 * Monday-first because the mockup's header row reads Mon Tue Wed Thu Fri Sat
 * Sun, and because the rest of this system already starts its weeks on Monday.
 */
describe('monthGrid', () => {
  it('starts on Monday and covers whole weeks', () => {
    const cells = monthGrid(2026, 8);
    expect(cells.length % 7).toBe(0);
    expect(new Date(`${cells[0].date}T00:00:00Z`).getUTCDay()).toBe(1);
  });

  it('marks days outside the month', () => {
    // 1 August 2026 is a Saturday, so the grid opens with July days.
    const cells = monthGrid(2026, 8);
    expect(cells[0].inMonth).toBe(false);
    expect(cells[0].date).toBe('2026-07-27');
    expect(cells.find((c) => c.date === '2026-08-01')?.inMonth).toBe(true);
  });

  it('contains every day of the month exactly once', () => {
    const inMonth = monthGrid(2026, 8).filter((c) => c.inMonth);
    expect(inMonth.length).toBe(31);
    expect(new Set(inMonth.map((c) => c.date)).size).toBe(31);
  });

  it('handles a February in a leap year', () => {
    expect(monthGrid(2028, 2).filter((c) => c.inMonth).length).toBe(29);
  });

  it('handles a month that starts on a Monday without a leading week', () => {
    // 1 June 2026 is a Monday.
    const cells = monthGrid(2026, 6);
    expect(cells[0].date).toBe('2026-06-01');
    expect(cells[0].inMonth).toBe(true);
  });

  it('reports the day of the month for rendering', () => {
    const cells = monthGrid(2026, 8);
    expect(cells.find((c) => c.date === '2026-08-11')?.dayOfMonth).toBe(11);
  });

  it('closes the final week rather than stopping mid-row', () => {
    const cells = monthGrid(2026, 8);
    expect(new Date(`${cells[cells.length - 1].date}T00:00:00Z`).getUTCDay()).toBe(0);
  });
});

describe('shiftMonth', () => {
  it('rolls forward across a year boundary', () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
  });

  it('rolls backward across a year boundary', () => {
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
  });

  it('moves within a year', () => {
    expect(shiftMonth(2026, 8, 1)).toEqual({ year: 2026, month: 9 });
    expect(shiftMonth(2026, 8, -1)).toEqual({ year: 2026, month: 7 });
  });
});

describe('calendarMonthLabel', () => {
  it('names the month and year', () => {
    expect(calendarMonthLabel(2026, 8)).toBe('August 2026');
    expect(calendarMonthLabel(2026, 1)).toBe('January 2026');
    expect(calendarMonthLabel(2026, 12)).toBe('December 2026');
  });
});
