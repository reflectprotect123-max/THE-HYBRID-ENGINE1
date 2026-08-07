/*
 * Contract types for the adaptive nutrition engine, ported from
 * `adaptive_engine.py` (MacroTrack, `reflectprotect123-max/thehybridsystem`)
 * with `docs/ADAPTIVE_ENGINE_CONTRACT.md` as the binding statement of intent.
 *
 * Field names are camelCase; every string VALUE (state, confidence, module
 * key, explanation) is copied verbatim from the reference, because those are
 * the wire contract the Kotlin app and the fixture parity tests key on.
 *
 * Nothing here is a diagnosis or a training prescription. Coordinator
 * arbitrates training; this package arbitrates macros and nothing else.
 */

import type { IsoDate } from './dates';

export type { IsoDate };

/**
 * Every product parameter the engine reads. There are no other constants in
 * the engine: the reference's own CLAUDE.md requires the EWMA alpha, the
 * kcal/kg conversion, the damping cap and the macro defaults to be versioned,
 * configurable and test-covered rather than folded into the arithmetic.
 */
export interface EngineConfig {
  /** Energy represented by a kilogram of body-mass change. Product parameter. */
  kcalPerKg: number;
  /** EWMA smoothing factor for the weight series. */
  trendAlpha: number;
  /** Calendar span required between first and last record before updating. */
  minimumHistoryDays: number;
  /** Length of one coverage period; the gate needs two consecutive ones. */
  coverageWindowDays: number;
  minimumNutritionDaysPerWeek: number;
  minimumWeightDaysPerWeek: number;
  /** Damping cap: how far one weekly update may move an existing estimate. */
  maximumExpenditureStepKcal: number;
  minimumExpenditureKcal: number;
  maximumExpenditureKcal: number;
  defaultProteinGPerKg: number;
  defaultFatGPerKg: number;
}

/** Verbatim `EngineConfig` dataclass defaults. */
export const DEFAULT_ENGINE_CONFIG: EngineConfig = Object.freeze({
  kcalPerKg: 7700,
  trendAlpha: 0.2,
  minimumHistoryDays: 14,
  coverageWindowDays: 7,
  minimumNutritionDaysPerWeek: 6,
  minimumWeightDaysPerWeek: 1,
  maximumExpenditureStepKcal: 100,
  minimumExpenditureKcal: 1000,
  maximumExpenditureKcal: 6000,
  defaultProteinGPerKg: 1.8,
  defaultFatGPerKg: 0.8,
});

export function engineConfig(overrides: Partial<EngineConfig> = {}): EngineConfig {
  return { ...DEFAULT_ENGINE_CONFIG, ...overrides };
}

/**
 * Declared state of a day's nutrition log. `partial` and `unlogged` are NOT
 * zero-calorie days and must never be coerced into one; `fasted` counts only
 * when the app explicitly stored zero calories.
 */
export type NutritionStatus = 'complete' | 'partial' | 'fasted' | 'unlogged';

export const NUTRITION_STATUSES: readonly NutritionStatus[] = [
  'complete',
  'partial',
  'fasted',
  'unlogged',
];

/**
 * One calendar day of athlete input. `calories` and `weightKg` are nullable
 * because "not logged" is a first-class value here — the engine's whole
 * safety property is that it can tell "unknown" from "zero".
 */
export interface DailyRecord {
  day: IsoDate;
  calories?: number | null;
  weightKg?: number | null;
  /** Defaults to `'complete'`, matching the dataclass default. */
  nutritionStatus?: NutritionStatus;
}

/** `holding` is a normal state, not an error. */
export type ExpenditureState = 'holding' | 'updating';

export type ExpenditureConfidence = 'holding' | 'low' | 'medium' | 'high';

export interface ExpenditureEstimate {
  state: ExpenditureState;
  confidence: ExpenditureConfidence;
  /** Carried forward from the previous estimate whenever `state` is holding. */
  estimateKcal: number | null;
  rawEstimateKcal: number | null;
  previousEstimateKcal: number | null;
  trendSlopeKgPerWeek: number | null;
  nutritionDays: number;
  weightDays: number;
  windowStart: IsoDate | null;
  windowEnd: IsoDate | null;
  /** Human-readable: what was used, or exactly what data is missing. */
  explanation: string;
}

export interface MacroTargets {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  macroCalories: number;
}

/** Deterministic module set from the contract's "check-in modules" section. */
export type CheckInModuleKey = 'partial_logging' | 'weigh_in' | 'logging_break' | 'program_update';

export interface CheckInModule {
  key: CheckInModuleKey;
  action: string;
}

export type CheckInStatus = 'held' | 'ready';

export interface WeeklyCheckIn {
  status: CheckInStatus;
  estimate: ExpenditureEstimate;
  modules: CheckInModule[];
  /** Null whenever the check-in is held — a held week proposes no targets. */
  targets: MacroTargets | null;
  explanation: string;
}

export type Sex = 'male' | 'female' | 'unspecified';

export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'high' | 'very_high';
