export interface MonthCell {
  /** `YYYY-MM-DD` */
  date: string;
  /** False for the leading and trailing days borrowed from neighbouring months. */
  inMonth: boolean;
  dayOfMonth: number;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The month as whole Monday-first weeks, including the neighbouring days that
 * fill the first and last rows — the mockup renders those dimmed rather than
 * leaving holes in the grid.
 *
 * UTC, like `mondayOf` in @hybrid/coordinator-adapter. A local-time grid shifts
 * a day for every coach west of Greenwich for part of each day, and that is a
 * bug only reproducible by the person least able to debug it.
 */
export function monthGrid(year: number, month1to12: number): MonthCell[] {
  const first = new Date(Date.UTC(year, month1to12 - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Monday = 0
  const cursor = new Date(first);
  cursor.setUTCDate(cursor.getUTCDate() - lead);

  const cells: MonthCell[] = [];
  // Whole weeks: keep emitting rows until one starts after the month ends.
  for (;;) {
    const rowStartsAfterMonth =
      cursor.getUTCFullYear() > year ||
      (cursor.getUTCFullYear() === year && cursor.getUTCMonth() > month1to12 - 1);
    if (rowStartsAfterMonth) break;

    for (let i = 0; i < 7; i += 1) {
      cells.push({
        date: iso(cursor),
        inMonth:
          cursor.getUTCMonth() === month1to12 - 1 && cursor.getUTCFullYear() === year,
        dayOfMonth: cursor.getUTCDate(),
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  return cells;
}

export function calendarMonthLabel(year: number, month1to12: number): string {
  return `${MONTHS[month1to12 - 1]} ${year}`;
}

/** Move `delta` months, rolling the year over correctly in both directions. */
export function shiftMonth(
  year: number,
  month1to12: number,
  delta: number,
): { year: number; month: number } {
  const d = new Date(Date.UTC(year, month1to12 - 1 + delta, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}
