/*
 * `@hybrid/nutrition-adapter` — the projection layer between the athlete's
 * `NutritionDB` slice and everything that reads it.
 *
 * Three consumers, one projection: the phone app's nutrition world, the web
 * dashboard and food log, and the coach bench. `@hybrid/nutrition-engine` stays
 * pure and knows nothing about `NutritionDB`; `@hybrid/nutrition-core` stays
 * data-only and knows nothing about the engine. This package is the only place
 * allowed to know both, which is why the `DailyRecord[]` an expenditure figure
 * is computed from is assembled exactly once for the whole system.
 *
 * It DECIDES nothing. Every export is a read: no writer, no clock of its own
 * (`today` is always passed in), no storage.
 */

export type { TrendSeries, WeighInCoverage, MacroOvershoot } from './slice';

export {
  checkInFor,
  currentEstimate,
  dailyRecords,
  dampingAnchor,
  goalLabel,
  goalOf,
  latestWeighIn,
  liveWeighIns,
  macroOvershoot,
  nextWeekStart,
  trendSeries,
  weekEndOf,
  weekStartOf,
  weighInCoverage,
  weighInDay,
  weightByDay,
} from './slice';

export { NUTRITION_CONTEXT_WINDOW_DAYS, nutritionContext } from './context';

export { macro, macroLine, positiveQty, round, titleCase } from './format';

export type {
  AdherenceSummary,
  DaySummary,
  NutritionSummary,
  TrendDirection,
  WeightTrendSummary,
} from './summary';

export {
  TREND_DEAD_BAND_KG_PER_WEEK,
  adherenceSummary,
  daySummary,
  nutritionSummary,
  weightTrendSummary,
} from './summary';
