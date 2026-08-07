import type { FoodLogEntry, IsoDate, MacroProgram } from './types';
import type { NutritionDB } from './db';

/*
 * Reading one calendar day out of the slice.
 *
 * Reads only — nothing here writes, and nothing here re-derives a macro from a
 * food id. `FoodLogEntry`'s snapshot fields are what the athlete actually ate;
 * see that type's doc comment for why recomputing them from `foodId` breaks
 * the history it was reading.
 */

/** The four macros a day is judged on. Deliberately not a `NutrientMap`. */
export interface MacroTotals {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export const ZERO_TOTALS: MacroTotals = { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 };

/** A soft-deleted entry is a record with a stamp, not an absence — see `FoodLogEntry.deletedAt`. */
export const isLive = (e: FoodLogEntry): boolean => e.deletedAt == null;

/**
 * The live entries logged against `date`.
 *
 * A READ, so scoping is allowed and correct (the house rule that writes never
 * filter is about the other direction: a write that dropped the other days'
 * entries would delete them). Ordered by `createdAt` so a day reads in the
 * order it was eaten rather than in whatever order the merge emitted.
 */
export function entriesForDay(db: NutritionDB, date: IsoDate): FoodLogEntry[] {
  return db.logEntries
    .filter((e) => e.logDate === date && isLive(e))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1));
}

/**
 * Sum the four snapshot macros.
 *
 * `calories`/`proteinG`/`carbsG`/`fatG` are ALREADY scaled to each entry's
 * `quantity`, which is exactly what makes a plain sum right. `entry.nutrients`
 * is not summed here and must never be added to this function: those values
 * sit at each source's own nutrition basis, so adding them across entries
 * produces a number that looks plausible and is wrong (see
 * `FoodLogEntry.nutrients`).
 */
export function macroTotals(entries: readonly FoodLogEntry[]): MacroTotals {
  return entries.reduce<MacroTotals>(
    (acc, e) => ({
      calories: acc.calories + e.calories,
      proteinG: acc.proteinG + e.proteinG,
      carbsG: acc.carbsG + e.carbsG,
      fatG: acc.fatG + e.fatG,
    }),
    { ...ZERO_TOTALS },
  );
}

/**
 * The program's target for `date`, or `null` when there isn't one.
 *
 * Null rather than a fallback number: an invented target would be read as
 * coaching the athlete never received, and "no target yet" is a real state
 * this app has to be able to show (the program is `null` before onboarding,
 * and a program only carries the days it has actually generated).
 */
export function targetForDay(program: MacroProgram | null, date: IsoDate): MacroTotals | null {
  const day = program?.days.find((d) => d.targetDate === date);
  if (!day) return null;
  return { calories: day.calories, proteinG: day.proteinG, carbsG: day.carbsG, fatG: day.fatG };
}

/** Meal buckets for one day, in the order the meals were given. Empty meals are dropped. */
export function groupByMeal(
  entries: readonly FoodLogEntry[],
  order: readonly string[],
): { meal: string; entries: FoodLogEntry[] }[] {
  const seen = new Map<string, FoodLogEntry[]>();
  for (const e of entries) {
    const bucket = seen.get(e.meal);
    if (bucket) bucket.push(e);
    else seen.set(e.meal, [e]);
  }
  // `meal` is free text (an athlete's own "pre-training" is a legal value), so
  // the known meals lead in their canonical order and anything else follows in
  // the order it was logged. Bucketing an unknown label into "other" would
  // hide a label the athlete chose on purpose.
  const known = order.filter((m) => seen.has(m));
  const rest = Array.from(seen.keys()).filter((m) => !order.includes(m));
  return [...known, ...rest].map((meal) => ({ meal, entries: seen.get(meal)! }));
}
