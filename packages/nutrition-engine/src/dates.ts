/*
 * Calendar-day arithmetic on ISO `YYYY-MM-DD` strings, matching the rest of
 * this repository (the Python reference uses `datetime.date`).
 *
 * Everything goes through UTC epoch days: a local-time `new Date('2026-07-01')`
 * would put a DST boundary inside a "day" and make `diffDays` return 13.958,
 * which floors to the wrong coverage window an hour either side of the shift.
 * No `Date.now()` lives here — every date the engine reasons about arrives as
 * a parameter.
 */

/** ISO-8601 calendar date, `YYYY-MM-DD`. */
export type IsoDate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export function toEpochDay(day: IsoDate): number {
  const match = ISO_DATE.exec(day);
  if (!match) {
    throw new Error(`Expected an ISO YYYY-MM-DD date, received ${JSON.stringify(day)}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  const utc = Date.UTC(year, month - 1, date);
  const roundTrip = new Date(utc);
  // Date.UTC happily normalises 2026-02-31 into March; the reference's
  // date.fromisoformat rejects it, and a silently shifted day would corrupt a
  // coverage window rather than fail loudly.
  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() !== month - 1 ||
    roundTrip.getUTCDate() !== date
  ) {
    throw new Error(`Not a real calendar date: ${day}`);
  }
  return utc / MS_PER_DAY;
}

export function fromEpochDay(epochDay: number): IsoDate {
  return new Date(epochDay * MS_PER_DAY).toISOString().slice(0, 10);
}

/** `day + days`, as `date + timedelta(days=...)`. */
export function addDays(day: IsoDate, days: number): IsoDate {
  return fromEpochDay(toEpochDay(day) + days);
}

/** `(later - earlier).days`. */
export function diffDays(later: IsoDate, earlier: IsoDate): number {
  return toEpochDay(later) - toEpochDay(earlier);
}

/** `max(a, b)` on dates — ISO strings order lexicographically, but be explicit. */
export function maxDay(a: IsoDate, b: IsoDate): IsoDate {
  return toEpochDay(a) >= toEpochDay(b) ? a : b;
}
