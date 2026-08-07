/*
 * `@hybrid/nutrition-engine` — the only place nutrition prescription lives.
 *
 * Pure functions over plain inputs: no I/O, no clock, no dependency on
 * `@hybrid/nutrition-core`, so the port can be tested standalone against the
 * Python reference. A thin adapter from `NutritionDB` comes later.
 */

export type {
  ActivityLevel,
  CheckInModule,
  CheckInModuleKey,
  CheckInStatus,
  DailyRecord,
  EngineConfig,
  ExpenditureConfidence,
  ExpenditureEstimate,
  ExpenditureState,
  IsoDate,
  MacroTargets,
  NutritionStatus,
  Sex,
  WeeklyCheckIn,
} from './types';

export { DEFAULT_ENGINE_CONFIG, NUTRITION_STATUSES, engineConfig } from './types';

export type { CoverageExplanation, InitialExpenditureInput, WeeklyCheckInInput } from './engine';

export {
  calorieTarget,
  coverageExplanation,
  estimateExpenditure,
  initialExpenditureKcal,
  linearSlope,
  macroTargets,
  nutritionIsCountable,
  periodCoverage,
  weeklyCheckIn,
  weightTrend,
} from './engine';

export { addDays, diffDays, fromEpochDay, maxDay, toEpochDay } from './dates';

export { clamp, fmean, fsum, naiveSum, pyRound } from './numeric';
export { ENGINE_DEFECTS, type EngineDefect } from './defects';
