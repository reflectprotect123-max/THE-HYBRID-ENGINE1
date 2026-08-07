import { ymd } from '@hybrid/engine';
import { isLive, type CheckIn, type MacroProgram, type NutritionDB, type WeightEntry } from '@hybrid/nutrition-core';
import {
  DEFAULT_ENGINE_CONFIG,
  addDays,
  diffDays,
  estimateExpenditure,
  toEpochDay,
  weightTrend,
  type DailyRecord,
  type ExpenditureEstimate,
  type IsoDate,
} from '@hybrid/nutrition-engine';

/*
 * The one adapter between the athlete's slice and `@hybrid/nutrition-engine`.
 *
 * The engine is pure and knows nothing about `NutritionDB`; Phase 1 deliberately
 * left "a thin adapter from NutritionDB" to the slice that needed it. This is
 * it, and it is the ONLY place the projection happens — three screens each
 * assembling their own `DailyRecord[]` is three chances to disagree about what
 * the athlete logged, and the athlete would see two different expenditure
 * numbers on two tabs.
 *
 * NOTHING HERE RECOMPUTES ENGINE MATHS. Trend, slope, coverage, expenditure,
 * targets and the check-in all come from the engine's exported functions; this
 * file only shapes inputs and reads outputs. Parity with the Python reference is
 * a merged contract (see `packages/nutrition-engine/test/parity.test.ts`), so a
 * local "just this once" reimplementation here would silently fork it.
 */

/** Local calendar day of a weigh-in — `ymd`, not `slice(0, 10)` on the ISO
 *  string, which is UTC and files an 8am Sydney weigh-in against yesterday. */
export const weighInDay = (entry: WeightEntry): IsoDate => ymd(new Date(entry.measuredAt));

/** Live weigh-ins, oldest first. A deleted one is a stamped record, not gone. */
export function liveWeighIns(db: NutritionDB): WeightEntry[] {
  return db.weightEntries
    .filter(isLive)
    .sort((a, b) => (a.measuredAt < b.measuredAt ? -1 : a.measuredAt > b.measuredAt ? 1 : a.id < b.id ? -1 : 1));
}

/** The most recent live weigh-in, or null. This is the body weight every macro
 *  proposal is scaled by, so it is read once, here. */
export function latestWeighIn(db: NutritionDB): WeightEntry | null {
  const live = liveWeighIns(db);
  return live.length === 0 ? null : (live[live.length - 1] as WeightEntry);
}

/**
 * Mean weight per local calendar day.
 *
 * The mean, not the last of the day: two weigh-ins on one morning are two
 * measurements of one fact, and picking one would make the series depend on the
 * order the array happened to be in. Mirrors the reference's
 * `WeightTrendCalculator.averageByLocalDay`.
 */
export function weightByDay(db: NutritionDB): Map<IsoDate, number> {
  const sums = new Map<IsoDate, { total: number; count: number }>();
  for (const entry of liveWeighIns(db)) {
    const day = weighInDay(entry);
    const acc = sums.get(day) ?? { total: 0, count: 0 };
    acc.total += entry.weightKg;
    acc.count += 1;
    sums.set(day, acc);
  }
  const out = new Map<IsoDate, number>();
  for (const [day, acc] of sums) out.set(day, acc.total / acc.count);
  return out;
}

/** Calories logged against each day, from LIVE entries only. */
function caloriesByDay(db: NutritionDB): Map<IsoDate, number> {
  const out = new Map<IsoDate, number>();
  for (const entry of db.logEntries) {
    if (!isLive(entry)) continue;
    out.set(entry.logDate, (out.get(entry.logDate) ?? 0) + entry.calories);
  }
  return out;
}

/**
 * One row per calendar day from the athlete's earliest known day through
 * `today` — the DENSE series `estimateExpenditure` expects, ported from
 * `ExpenditureRecordAssembler`.
 *
 * Dense on purpose, and it matters: the engine's EWMA repeats the last weight
 * across days with no weigh-in and its least-squares fit reads those flat runs
 * as data. Emitting only the days that HAVE a weigh-in would quietly change the
 * slope the engine computes, which is a fork of the Python parity contract
 * disguised as a data-shaping choice. The consequence of the dense series is a
 * known, documented understatement of the drift — surfaced to the athlete in
 * the UI (see `weighInCoverage`), never corrected here.
 *
 * Two rules the record shape has to keep:
 *
 *  - A day with no entries gets `calories: null`, NEVER 0. Unknown intake
 *    averaged in as zero is a phantom deficit of hundreds of kcal/day.
 *  - A day the athlete DECLARED fasted gets an explicit 0, because a real fast
 *    leaves no log entries and `nutritionIsCountable` only counts a fast that
 *    stored zero. Without this an athlete who fasts one day a week could never
 *    clear the 6-of-7 gate. That is a declaration, not an inference.
 *
 * The status for a day with food logged and nothing declared is `'complete'` —
 * the engine's own `DailyRecord` default. This slice has no day-status control
 * (MacroTrack's lives on its Daily Log; ours does not have one yet), so
 * defaulting to `'unlogged'` instead would mean the coverage gate could never
 * be cleared by any athlete and the Coach tab would hold forever. It does not
 * weaken rule #2: a day with NO entries and no declaration still gets
 * `calories: null`, and is still uncountable.
 */
export function dailyRecords(db: NutritionDB, today: IsoDate): DailyRecord[] {
  const calories = caloriesByDay(db);
  const weights = weightByDay(db);
  const declared = new Map<IsoDate, NonNullable<DailyRecord['nutritionStatus']>>(
    db.dayStatus.map((d) => [d.logDate, d.status]),
  );

  const known = [...calories.keys(), ...weights.keys(), ...declared.keys()].filter((d) => diffDays(today, d) >= 0);
  if (known.length === 0) return [];
  const start = known.reduce((earliest, day) => (diffDays(day, earliest) < 0 ? day : earliest), known[0] as IsoDate);

  const out: DailyRecord[] = [];
  for (let day = start; diffDays(today, day) >= 0; day = addDays(day, 1)) {
    const status = declared.get(day) ?? (calories.has(day) ? 'complete' : 'unlogged');
    const kcal = calories.get(day);
    out.push({
      day,
      calories: kcal ?? (status === 'fasted' ? 0 : null),
      weightKg: weights.get(day) ?? null,
      nutritionStatus: status,
    });
  }
  return out;
}

export interface TrendSeries {
  days: IsoDate[];
  /** The athlete's own weigh-ins; null on a day they did not stand on the scale. */
  raw: (number | null)[];
  /** `weightTrend` over the whole history — the engine's EWMA, never a local one. */
  trend: (number | null)[];
}

/**
 * The series the Weight screen draws.
 *
 * The EWMA runs over the WHOLE history and is only then sliced to the visible
 * window, for the same reason `estimateExpenditure` does it that way: restarting
 * the filter at the left edge of the chart would invent a different curve for
 * the same weigh-ins depending on how far back the screen happened to look.
 */
export function trendSeries(db: NutritionDB, today: IsoDate, windowDays: number): TrendSeries {
  const weights = weightByDay(db);
  const days = [...weights.keys()].filter((d) => diffDays(today, d) >= 0);
  if (days.length === 0) return { days: [], raw: [], trend: [] };
  const start = days.reduce((earliest, day) => (diffDays(day, earliest) < 0 ? day : earliest), days[0] as IsoDate);

  const all: IsoDate[] = [];
  for (let day = start; diffDays(today, day) >= 0; day = addDays(day, 1)) all.push(day);
  const raw = all.map((day) => weights.get(day) ?? null);
  const trend = weightTrend(raw, DEFAULT_ENGINE_CONFIG.trendAlpha);

  const from = Math.max(0, all.length - windowDays);
  return { days: all.slice(from), raw: raw.slice(from), trend: trend.slice(from) };
}

/* ---------- weeks ---------- */

/**
 * The Monday on or before `day`, as MacroTrack's `currentWeekStart()` picks it.
 *
 * Computed from the epoch day rather than from a `Date`, so there is no
 * timezone in it at all: 1970-01-01 was a Thursday, which is index 3 in a
 * Monday-first week. `((n % 7) + 7) % 7` because a pre-1970 day is negative and
 * JavaScript's `%` keeps the sign.
 */
export function weekStartOf(day: IsoDate): IsoDate {
  const index = (((toEpochDay(day) + 3) % 7) + 7) % 7;
  return addDays(day, -index);
}

export const weekEndOf = (weekStart: IsoDate): IsoDate => addDays(weekStart, 6);

export const nextWeekStart = (weekStart: IsoDate): IsoDate => addDays(weekStart, 7);

/* ---------- check-ins ---------- */

/** The stored check-in for a week, whatever its status. Keyed the way the merge
 *  keys it (`checkInKey`), minus `userId`, which is blank on every local write. */
export function checkInFor(db: NutritionDB, weekStart: IsoDate): CheckIn | null {
  return db.checkIns.find((c) => c.weekStart === weekStart) ?? null;
}

/**
 * The damping anchor for a check-in on `weekStart`: the expenditure the last
 * EARLIER week settled on, or null if there has never been one.
 *
 * Strictly earlier is what stops the damping chaining. `estimateExpenditure`
 * moves an existing estimate by at most one 100 kcal step per call and nothing
 * in it is tied to elapsed time, so anchoring a recompute to the row that
 * recompute is about to replace would walk the estimate one step closer to raw
 * on every button press — drift bought with taps, which is precisely what the
 * damping cap exists to prevent. The reference solves the same problem by
 * comparing `windowEnd` to today; keying on the week is the same guarantee with
 * no clock in it.
 *
 * NOT scoped to the current program: expenditure is a fact about the athlete's
 * body, not about the goal they picked, so changing the goal must not throw the
 * estimate back to undamped.
 */
export function dampingAnchor(db: NutritionDB, weekStart: IsoDate): number | null {
  const earlier = db.checkIns
    .filter((c) => c.weekStart < weekStart)
    .sort((a, b) => (a.weekStart < b.weekStart ? -1 : a.weekStart > b.weekStart ? 1 : 0));
  for (let i = earlier.length - 1; i >= 0; i -= 1) {
    const candidate = earlier[i] as CheckIn;
    const value = candidate.proposedExpenditureKcal ?? candidate.previousExpenditureKcal;
    if (value != null) return value;
  }
  return null;
}

/**
 * The expenditure estimate as of today, anchored to the last settled week.
 *
 * A `holding` result is a NORMAL return here and carries `explanation` saying
 * what is missing. Callers render it; nobody treats it as a failure.
 */
export function currentEstimate(db: NutritionDB, today: IsoDate): ExpenditureEstimate {
  return estimateExpenditure(dailyRecords(db, today), dampingAnchor(db, weekStartOf(today)));
}

/* ---------- the two engine defects this UI must not hide ---------- */

export interface WeighInCoverage {
  /** Weigh-in days the engine actually saw inside its own window. */
  weightDays: number;
  /** Calendar days in that window. */
  windowDays: number;
  /**
   * True when the window has weigh-ins on fewer than half its days.
   *
   * DEFECT, CARRIED FORWARD UNFIXED (see the Phase 1 port report): the engine's
   * EWMA repeats the last weight across days with no weigh-in, and the
   * least-squares fit reads those flat runs as real data — in the reference's
   * own `sparse_weight_updates` fixture a true -0.28 kg/wk drift is reported as
   * -0.072, roughly four times too flat. Expenditure is mean intake MINUS
   * slope × 7700, so understating the loss rate understates expenditure and
   * hands the athlete a LOWER calorie target than intended, and the error is
   * worst exactly when weigh-ins are sparsest.
   *
   * The maths is a merged parity contract and is not touched. What the UI owes
   * the athlete is the truth about its input: this flag is what the screens use
   * to say the estimate is reading a thin weight signal, and in which direction
   * that biases their target.
   */
  sparse: boolean;
}

export function weighInCoverage(estimate: ExpenditureEstimate): WeighInCoverage {
  const { windowStart, windowEnd, weightDays } = estimate;
  const windowDays = windowStart && windowEnd ? diffDays(windowEnd, windowStart) + 1 : 0;
  return { weightDays, windowDays, sparse: windowDays > 0 && weightDays * 2 < windowDays };
}

export interface MacroOvershoot {
  /** What the four macros actually add up to. */
  macroCalories: number;
  /** How far that exceeds the calorie target they sit under. 0 when they agree. */
  overKcal: number;
}

/**
 * DEFECT, CARRIED FORWARD UNFIXED (see the Phase 1 port report): `macroTargets`
 * allocates protein and fat from per-kg preferences and gives carbohydrate
 * whatever calories remain, flooring carbs at zero — so when protein and fat
 * alone already exceed the target, the returned macros total MORE than the
 * calorie figure printed beside them, and the result carries no flag saying so.
 * The engine's own test pins that behaviour deliberately, and parity with the
 * Python is a merged contract, so it is detected here and never repaired.
 *
 * The 4/4/9 recomposition is `macroTargets`' own `macroCalories` line: a
 * persisted `CheckIn` keeps the four macro numbers but not their sum, so a
 * proposal read back from the slice has to be re-totalled to be checked at all.
 * It lives HERE, once, rather than in the screen that noticed it needed it.
 *
 * The 1 kcal tolerance is rounding noise between two independently rounded
 * sums, not a contradiction worth showing anybody.
 */
export function macroOvershoot(totals: { calories: number; proteinG: number; carbsG: number; fatG: number }): MacroOvershoot {
  const macroCalories = totals.proteinG * 4 + totals.carbsG * 4 + totals.fatG * 9;
  const over = macroCalories - totals.calories;
  return { macroCalories, overKcal: over > 1 ? over : 0 };
}

/* ---------- program ---------- */

export const goalOf = (rate: number): MacroProgram['goal'] => (rate < 0 ? 'lose' : rate > 0 ? 'gain' : 'maintain');

export const goalLabel = (rate: number): string => (rate < 0 ? 'Losing' : rate > 0 ? 'Gaining' : 'Maintaining');
