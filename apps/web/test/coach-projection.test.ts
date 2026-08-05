import { describe, expect, it } from 'vitest';
import type { Session, Workout } from '@hybrid/engine';
import { gridDates, projectGrid, sameWeekday } from '../src/coach/projection';

const TODAY = '2026-08-06'; // a Thursday

function workout(over: Partial<Workout>): Workout {
  return { id: 'w1', blocks: [], ...over } as Workout;
}

function session(over: Partial<Session>): Session {
  return {
    id: 's1',
    date: TODAY,
    status: 'completed',
    blocks: [],
    ...over,
  } as Session;
}

describe('gridDates', () => {
  it('produces Monday-anchored ISO weeks around today', () => {
    const rows = gridDates(TODAY, 1, 2);
    expect(rows).toHaveLength(3);
    expect(rows[1]![0]).toBe('2026-08-03'); // current week's Monday
    expect(rows[1]![6]).toBe('2026-08-09');
    expect(rows[0]![0]).toBe('2026-07-27'); // one week back
    expect(rows[2]![0]).toBe('2026-08-10'); // one week forward
    expect(rows.flat()).toHaveLength(21);
  });
});

describe('projectGrid', () => {
  const rows = gridDates(TODAY, 1, 2);

  it('places logged sessions on their exact date', () => {
    const grid = projectGrid(rows, [], [session({ date: '2026-08-05', name: 'Squat day' })], TODAY);
    const cell = grid.flat().find((c) => c.date === '2026-08-05')!;
    expect(cell.items).toHaveLength(1);
    expect(cell.items[0]!.source).toBe('logged');
    expect(cell.items[0]!.name).toBe('Squat day');
  });

  it('projects recurring weekday slots onto future dates only', () => {
    // days: [1] = every Monday (0=Sunday semantics)
    const grid = projectGrid(rows, [workout({ days: [1], name: 'Bench' })], [], TODAY);
    const pastMonday = grid.flat().find((c) => c.date === '2026-08-03')!;
    const futureMonday = grid.flat().find((c) => c.date === '2026-08-10')!;
    expect(pastMonday.items).toHaveLength(0); // a miss is not a plan
    expect(futureMonday.items).toHaveLength(1);
    expect(futureMonday.items[0]!.source).toBe('planned');
  });

  it('always honors explicit one-off dates, past included', () => {
    const grid = projectGrid(rows, [workout({ dates: ['2026-07-29'], name: 'Test day' })], [], TODAY);
    const cell = grid.flat().find((c) => c.date === '2026-07-29')!;
    expect(cell.items.map((i) => i.name)).toEqual(['Test day']);
  });

  it('does not double-count a planned workout already logged that day', () => {
    const grid = projectGrid(
      rows,
      [workout({ days: [4], name: 'Intervals', kind: 'conditioning' })], // Thursdays
      [session({ date: TODAY, name: 'Intervals', kind: 'conditioning' })],
      TODAY,
    );
    const cell = grid.flat().find((c) => c.date === TODAY)!;
    expect(cell.items).toHaveLength(1);
    expect(cell.items[0]!.source).toBe('logged');
  });
});

describe('sameWeekday', () => {
  it('is a pure transposition of the grid', () => {
    const rows = gridDates(TODAY, 2, 2);
    const grid = projectGrid(rows, [], [], TODAY);
    const mondays = sameWeekday(grid, 0);
    expect(mondays).toHaveLength(4);
    expect(mondays.map((c) => c.date)).toEqual(['2026-07-20', '2026-07-27', '2026-08-03', '2026-08-10']);
  });
});
