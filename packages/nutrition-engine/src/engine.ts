/*
 * Deterministic adaptive nutrition engine — a function-for-function port of
 * `adaptive_engine.py` (MacroTrack @ 079b356). The Python file is the
 * executable specification and `docs/ADAPTIVE_ENGINE_CONTRACT.md` is the
 * contract; `test/parity.test.ts` proves the two agree on generated fixtures.
 *
 * What the port is obliged to preserve:
 *
 *  - No wearable calorie estimates. Expenditure comes from logged intake and
 *    the smoothed weight trend, nothing else.
 *  - A missing NUTRITION day is never interpolated and never becomes zero
 *    calories. A missing WEIGHT day is tolerated, because the scale is a noisy
 *    instrument and the EWMA is what absorbs that noise.
 *  - HOLDING is a normal outcome. Insufficient history or coverage carries the
 *    previous estimate forward with an explanation of what is missing — it
 *    does not guess, and it does not fail.
 *  - Updates are damped once a previous estimate exists.
 *  - Pure functions only: no I/O, no clock. Dates arrive as parameters.
 *
 * `main()`/argparse is deliberately NOT ported; this package is a library.
 */

import { addDays, diffDays, maxDay, type IsoDate } from './dates';
import { clamp, fmean, naiveSum, pyRound } from './numeric';
import {
  DEFAULT_ENGINE_CONFIG,
  type ActivityLevel,
  type CheckInModule,
  type DailyRecord,
  type EngineConfig,
  type ExpenditureConfidence,
  type ExpenditureEstimate,
  type MacroTargets,
  type Sex,
  type WeeklyCheckIn,
} from './types';

function sortedRecords(records: Iterable<DailyRecord>): DailyRecord[] {
  // Array.prototype.sort is stable (ES2019+), like Python's sorted, so records
  // sharing a day keep their input order and the engine stays deterministic.
  return [...records].sort((a, b) => diffDays(a.day, b.day));
}

/**
 * Is this day's intake usable as a data point?
 *
 * A declared fast counts ONLY when zero calories were explicitly stored. Any
 * other status than `complete` — including `partial` and `unlogged` — is
 * unknown intake, and unknown is never averaged in as zero.
 */
export function nutritionIsCountable(record: DailyRecord): boolean {
  const calories = record.calories ?? null;
  const status = record.nutritionStatus ?? 'complete';
  if (status === 'fasted') {
    return calories === 0;
  }
  return status === 'complete' && calories !== null && calories >= 0;
}

/**
 * Recency-weighted EWMA of the weight series, carrying the last trend value
 * across gaps so a skipped weigh-in produces a repeated point rather than a
 * hole. Leading nulls stay null: there is nothing to carry yet.
 */
export function weightTrend(
  values: readonly (number | null | undefined)[],
  alpha: number = DEFAULT_ENGINE_CONFIG.trendAlpha,
): (number | null)[] {
  if (!(alpha > 0 && alpha <= 1)) {
    throw new Error('alpha must be greater than 0 and no greater than 1');
  }
  const result: (number | null)[] = [];
  let previous: number | null = null;
  for (const value of values) {
    if (value !== null && value !== undefined) {
      previous = previous === null ? value : alpha * value + (1 - alpha) * previous;
    }
    result.push(previous);
  }
  return result;
}

/**
 * Least-squares slope per day over `[day, value]` points, x measured in days
 * from the first point. Returns null when the fit is undefined (fewer than two
 * points, or every point on the same day).
 */
export function linearSlope(points: readonly (readonly [IsoDate, number])[]): number | null {
  if (points.length < 2) {
    return null;
  }
  const origin = (points[0] as readonly [IsoDate, number])[0];
  const xs = points.map(([day]) => diffDays(day, origin));
  const ys = points.map(([, value]) => value);
  // fmean (compensated) for the means but a plain running sum for the two
  // sums, exactly as the reference does — mixing the two differently would
  // move the last ulp of the slope and, times 7700, the calorie target.
  const xMean = fmean(xs);
  const yMean = fmean(ys);
  const denominator = naiveSum(xs.map((x) => (x - xMean) ** 2));
  if (denominator === 0) {
    return null;
  }
  const numerator = naiveSum(xs.map((x, index) => (x - xMean) * ((ys[index] as number) - yMean)));
  return numerator / denominator;
}

/** Countable-nutrition and weigh-in day counts inside an inclusive date span. */
export function periodCoverage(
  records: readonly DailyRecord[],
  start: IsoDate,
  end: IsoDate,
): { nutritionDays: number; weightDays: number } {
  const period = records.filter((record) => diffDays(record.day, start) >= 0 && diffDays(end, record.day) >= 0);
  return {
    nutritionDays: period.filter((record) => nutritionIsCountable(record)).length,
    weightDays: period.filter((record) => (record.weightKg ?? null) !== null).length,
  };
}

export interface CoverageExplanation {
  /** True only when both consecutive periods clear both gates. */
  enough: boolean;
  reasons: string[];
  nutritionDays: number;
  weightDays: number;
}

/**
 * The update gate: two consecutive seven-day periods, each with at least six
 * countable nutrition days and at least one weigh-in. Returns the reasons in
 * user-facing language so the UI can say what is missing instead of showing an
 * error.
 */
export function coverageExplanation(
  records: readonly DailyRecord[],
  config: EngineConfig = DEFAULT_ENGINE_CONFIG,
): CoverageExplanation {
  if (records.length === 0) {
    return { enough: false, reasons: ['No daily records are available.'], nutritionDays: 0, weightDays: 0 };
  }
  const first = (records[0] as DailyRecord).day;
  const last = (records[records.length - 1] as DailyRecord).day;
  if (diffDays(last, first) + 1 < config.minimumHistoryDays) {
    return {
      enough: false,
      reasons: ['More history is required before updating expenditure.'],
      nutritionDays: 0,
      weightDays: 0,
    };
  }
  const lastWeekStart = addDays(last, -(config.coverageWindowDays - 1));
  const previousWeekEnd = addDays(lastWeekStart, -1);
  const previousWeekStart = addDays(previousWeekEnd, -(config.coverageWindowDays - 1));
  const current = periodCoverage(records, lastWeekStart, last);
  const previous = periodCoverage(records, previousWeekStart, previousWeekEnd);
  const reasons: string[] = [];
  if (
    current.nutritionDays < config.minimumNutritionDaysPerWeek ||
    previous.nutritionDays < config.minimumNutritionDaysPerWeek
  ) {
    reasons.push('Nutrition logging is below the 6-of-7-day update gate.');
  }
  if (
    current.weightDays < config.minimumWeightDaysPerWeek ||
    previous.weightDays < config.minimumWeightDaysPerWeek
  ) {
    reasons.push('At least one weigh-in is required in each seven-day period.');
  }
  return {
    enough: reasons.length === 0,
    reasons,
    nutritionDays: current.nutritionDays + previous.nutritionDays,
    weightDays: current.weightDays + previous.weightDays,
  };
}

/**
 * Estimate expenditure as mean logged intake minus the energy represented by
 * the smoothed weight slope. Holds — carrying `previousEstimateKcal` forward —
 * whenever coverage, history or the trend fit is inadequate.
 */
export function estimateExpenditure(
  records: Iterable<DailyRecord>,
  previousEstimateKcal: number | null = null,
  config: EngineConfig = DEFAULT_ENGINE_CONFIG,
): ExpenditureEstimate {
  const ordered = sortedRecords(records);
  if (ordered.length === 0) {
    return {
      state: 'holding',
      confidence: 'holding',
      estimateKcal: previousEstimateKcal,
      rawEstimateKcal: null,
      previousEstimateKcal,
      trendSlopeKgPerWeek: null,
      nutritionDays: 0,
      weightDays: 0,
      windowStart: null,
      windowEnd: null,
      explanation: 'No records are available.',
    };
  }

  const { enough, reasons } = coverageExplanation(ordered, config);
  const end = (ordered[ordered.length - 1] as DailyRecord).day;
  const start = maxDay((ordered[0] as DailyRecord).day, addDays(end, -(config.coverageWindowDays * 2 - 1)));
  const inWindow = (day: IsoDate): boolean => diffDays(day, start) >= 0 && diffDays(end, day) >= 0;
  const window = ordered.filter((record) => inWindow(record.day));
  const countable = window.filter((record) => nutritionIsCountable(record));
  const nutritionDays = countable.length;
  const weightDays = window.filter((record) => (record.weightKg ?? null) !== null).length;

  // The EWMA runs over the WHOLE history, not just the window: the smoothed
  // value at the window's first day has to carry everything before it, or the
  // filter would restart mid-series and invent a slope.
  const trendValues = weightTrend(
    ordered.map((record) => record.weightKg ?? null),
    config.trendAlpha,
  );
  const trendPoints: (readonly [IsoDate, number])[] = [];
  ordered.forEach((record, index) => {
    const trend = trendValues[index] ?? null;
    if (inWindow(record.day) && trend !== null) {
      trendPoints.push([record.day, trend]);
    }
  });
  const slopePerDay = linearSlope(trendPoints);
  const slopePerWeek = slopePerDay === null ? null : slopePerDay * 7;

  let raw: number | null = null;
  if (enough && countable.length > 0 && slopePerDay !== null) {
    const calories = countable
      .map((record) => record.calories)
      .filter((value): value is number => value !== null && value !== undefined);
    raw = clamp(
      fmean(calories) - slopePerDay * config.kcalPerKg,
      config.minimumExpenditureKcal,
      config.maximumExpenditureKcal,
    );
  }

  if (raw === null) {
    return {
      state: 'holding',
      // "holding" only when there is nothing to carry forward; otherwise the
      // carried-forward number is real, just no longer freshly evidenced.
      confidence: previousEstimateKcal === null ? 'holding' : 'low',
      estimateKcal: previousEstimateKcal,
      rawEstimateKcal: null,
      previousEstimateKcal,
      trendSlopeKgPerWeek: slopePerWeek,
      nutritionDays,
      weightDays,
      windowStart: start,
      windowEnd: end,
      explanation:
        reasons.length > 0
          ? reasons.join(' ')
          : 'A trend slope and complete intake coverage are required.',
    };
  }

  // Damping: an existing estimate moves by at most one step per update, so a
  // single noisy week cannot yank the athlete's targets.
  const estimate =
    previousEstimateKcal === null
      ? raw
      : previousEstimateKcal +
        clamp(
          raw - previousEstimateKcal,
          -config.maximumExpenditureStepKcal,
          config.maximumExpenditureStepKcal,
        );

  const spanDays = diffDays(end, (ordered[0] as DailyRecord).day) + 1;
  let confidence: ExpenditureConfidence;
  if (spanDays >= 28 && nutritionDays >= 12 && weightDays >= 4) {
    confidence = 'high';
  } else if (spanDays >= 14) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  return {
    state: 'updating',
    confidence,
    estimateKcal: pyRound(estimate, 1),
    rawEstimateKcal: pyRound(raw, 1),
    previousEstimateKcal,
    trendSlopeKgPerWeek: slopePerWeek === null ? null : pyRound(slopePerWeek, 4),
    nutritionDays,
    weightDays,
    windowStart: start,
    windowEnd: end,
    explanation: 'Expenditure updated from logged intake and smoothed weight trend.',
  };
}

export interface InitialExpenditureInput {
  weightKg: number;
  heightCm: number;
  ageYears: number;
  sex?: Sex | (string & {});
  activityLevel?: ActivityLevel | (string & {});
  bodyFatPct?: number | null;
}

const ACTIVITY_FACTORS: Record<string, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  high: 1.725,
  very_high: 1.9,
};

/**
 * Transparent starting number for an athlete with no history. It is a seed,
 * not an estimate to defend: the observed-data loop replaces it as soon as
 * coverage allows.
 */
export function initialExpenditureKcal({
  weightKg,
  heightCm,
  ageYears,
  sex = 'unspecified',
  activityLevel = 'moderate',
  bodyFatPct = null,
}: InitialExpenditureInput): number {
  let bmr: number;
  if (bodyFatPct !== null && bodyFatPct !== undefined && bodyFatPct >= 2 && bodyFatPct <= 70) {
    // Katch-McArdle when lean mass is known.
    const leanMass = weightKg * (1 - bodyFatPct / 100);
    bmr = 370 + 21.6 * leanMass;
  } else if (sex === 'male') {
    bmr = 10 * weightKg + 6.25 * heightCm - 5 * ageYears + 5;
  } else if (sex === 'female') {
    bmr = 10 * weightKg + 6.25 * heightCm - 5 * ageYears - 161;
  } else {
    // Midpoint fallback rather than guessing a sex-specific equation.
    bmr = 10 * weightKg + 6.25 * heightCm - 5 * ageYears - 78;
  }
  const factor = ACTIVITY_FACTORS[activityLevel] ?? (ACTIVITY_FACTORS['moderate'] as number);
  return pyRound(Math.max(1000, bmr * factor), 1);
}

/** Signed rate: negative loses weight, positive gains weight, zero maintains. */
export function calorieTarget(
  expenditureKcal: number,
  targetRateKgPerWeek: number,
  config: EngineConfig = DEFAULT_ENGINE_CONFIG,
): number {
  return pyRound(expenditureKcal + (targetRateKgPerWeek * config.kcalPerKg) / 7, 1);
}

/**
 * Protein and fat from explicit per-kilogram preferences, carbohydrate from
 * whatever calories remain. Product defaults, not medical advice.
 *
 * The per-kg defaults come from `DEFAULT_ENGINE_CONFIG` rather than from a
 * passed `config`, mirroring the reference, where they are Python default
 * arguments bound to the dataclass's class attributes.
 */
export function macroTargets(
  calories: number,
  bodyWeightKg: number,
  proteinGPerKg: number = DEFAULT_ENGINE_CONFIG.defaultProteinGPerKg,
  fatGPerKg: number = DEFAULT_ENGINE_CONFIG.defaultFatGPerKg,
): MacroTargets {
  const protein = Math.max(0, bodyWeightKg * proteinGPerKg);
  const fat = Math.max(0, bodyWeightKg * fatGPerKg);
  const remaining = calories - protein * 4 - fat * 9;
  const carbs = Math.max(0, remaining / 4);
  return {
    calories: pyRound(calories, 1),
    proteinG: pyRound(protein, 1),
    carbsG: pyRound(carbs, 1),
    fatG: pyRound(fat, 1),
    macroCalories: pyRound(protein * 4 + carbs * 4 + fat * 9, 1),
  };
}

export interface WeeklyCheckInInput {
  previousExpenditureKcal: number | null;
  bodyWeightKg: number;
  targetRateKgPerWeek: number;
  proteinGPerKg?: number;
  fatGPerKg?: number;
  config?: EngineConfig;
}

/**
 * The weekly check-in: either a held week that explains the missing data, or a
 * ready week carrying proposed targets for the athlete to accept or decline.
 * Recommendations are informational — never punishment, calorie debt, or a
 * retroactive make-up target.
 */
export function weeklyCheckIn(
  records: Iterable<DailyRecord>,
  {
    previousExpenditureKcal,
    bodyWeightKg,
    targetRateKgPerWeek,
    proteinGPerKg = DEFAULT_ENGINE_CONFIG.defaultProteinGPerKg,
    fatGPerKg = DEFAULT_ENGINE_CONFIG.defaultFatGPerKg,
    config = DEFAULT_ENGINE_CONFIG,
  }: WeeklyCheckInInput,
): WeeklyCheckIn {
  const estimate = estimateExpenditure(records, previousExpenditureKcal, config);
  const modules: CheckInModule[] = [];

  if (estimate.state === 'holding') {
    if (estimate.nutritionDays < config.minimumNutritionDaysPerWeek * 2) {
      modules.push({ key: 'partial_logging', action: 'review incomplete nutrition days' });
    }
    if (estimate.weightDays < config.minimumWeightDaysPerWeek * 2) {
      modules.push({ key: 'weigh_in', action: 'add a weigh-in for each seven-day period' });
    }
    modules.push({ key: 'logging_break', action: 'carry forward the last high-confidence estimate' });
    return {
      status: 'held',
      estimate,
      modules,
      targets: null,
      explanation: estimate.explanation,
    };
  }

  if (estimate.estimateKcal === null) {
    // Unreachable: an updating estimate always carries a number. Kept as a
    // loud failure rather than a silent zero, matching the reference's assert.
    throw new Error('An updating expenditure estimate must carry a value');
  }
  const calories = calorieTarget(estimate.estimateKcal, targetRateKgPerWeek, config);
  const targets = macroTargets(calories, bodyWeightKg, proteinGPerKg, fatGPerKg);
  modules.push({
    key: 'program_update',
    action: 'review and accept the proposed calorie and macro targets',
  });
  return {
    status: 'ready',
    estimate,
    modules,
    targets,
    explanation:
      'The next target uses observed expenditure and the signed goal rate; ' +
      'it does not punish or average in unlogged days.',
  };
}
