import {
  ZERO_TOTALS,
  entriesForDay,
  macroTotals,
  targetForDay,
  type MacroTotals,
  type NutritionDB,
} from '@hybrid/nutrition-core';
import type { ExpenditureEstimate, IsoDate } from '@hybrid/nutrition-engine';
import { NUTRITION_CONTEXT_WINDOW_DAYS, nutritionContext } from './context';
import { currentEstimate } from './slice';

/*
 * The read-only view model behind every nutrition SUMMARY surface: the web
 * dashboard card, the coach bench panel, and anything later that has to say
 * "how is this athlete's nutrition going" in one glance.
 *
 * Here rather than in a screen because the athlete's dashboard and their
 * coach's bench must not be able to disagree about the same day. Two components
 * each dividing totals by targets is two rounding conventions, two answers to
 * "what is adherence when there is no target", and eventually a coach reading a
 * number the athlete has never seen.
 *
 * Everything below is a READ. Nothing in this file writes to the slice — the
 * coach panel's read-only guarantee is a property of there being no writer to
 * call, not of the panel remembering not to call one.
 */

export type TrendDirection = 'rising' | 'falling' | 'steady' | 'unknown';

export interface DaySummary {
  date: IsoDate;
  totals: MacroTotals;
  /** null when the program has no target for this day — never a zeroed one. */
  target: MacroTotals | null;
  entryCount: number;
  /**
   * Logged calories as a percentage of the day's target, or null with no
   * target. Can exceed 100: a day over target is a fact, not an error, and
   * clamping it would hide exactly the day worth looking at.
   */
  caloriePct: number | null;
}

export function daySummary(db: NutritionDB, date: IsoDate): DaySummary {
  const entries = entriesForDay(db, date);
  const totals = entries.length ? macroTotals(entries) : { ...ZERO_TOTALS };
  const target = targetForDay(db.program, date);
  return {
    date,
    totals,
    target,
    entryCount: entries.length,
    caloriePct: target && target.calories > 0 ? (totals.calories / target.calories) * 100 : null,
  };
}

export interface AdherenceSummary {
  windowDays: number;
  /** Days the nutrition engine counts as completely logged. */
  loggedDays: number;
  /** 0..100. The share of the window that carries a countable log. */
  pct: number;
}

/**
 * Logging adherence over the trailing window.
 *
 * Deliberately the SAME counts `nutritionContext` hands to whole-athlete-state,
 * read from the same projection: the adherence a coach sees on the bench is the
 * adherence that decided whether an energy-availability constraint fired. Two
 * different definitions of "logged" would make the constraint unexplainable
 * from the screen that is supposed to explain it.
 */
export function adherenceSummary(
  db: NutritionDB,
  today: IsoDate,
  windowDays = NUTRITION_CONTEXT_WINDOW_DAYS,
): AdherenceSummary {
  const facts = nutritionContext(db, today, windowDays);
  return {
    windowDays: facts.windowDays,
    loggedDays: facts.loggedDays,
    pct: facts.windowDays > 0 ? (facts.loggedDays / facts.windowDays) * 100 : 0,
  };
}

export interface WeightTrendSummary {
  direction: TrendDirection;
  /** The engine's own slope; null when it has not produced one. */
  slopeKgPerWeek: number | null;
}

/**
 * Which way the weight is going, from the engine's slope and nothing else.
 *
 * The dead band is 0.05 kg/week. Below it the arrow would flip between "rising"
 * and "falling" on the noise of a single weigh-in, and an athlete watching a
 * direction word change every morning learns to ignore it.
 */
export const TREND_DEAD_BAND_KG_PER_WEEK = 0.05;

export function weightTrendSummary(estimate: ExpenditureEstimate): WeightTrendSummary {
  const slope = estimate.trendSlopeKgPerWeek;
  if (slope == null) return { direction: 'unknown', slopeKgPerWeek: null };
  const direction: TrendDirection =
    slope > TREND_DEAD_BAND_KG_PER_WEEK ? 'rising' : slope < -TREND_DEAD_BAND_KG_PER_WEEK ? 'falling' : 'steady';
  return { direction, slopeKgPerWeek: slope };
}

export interface NutritionSummary {
  today: DaySummary;
  adherence: AdherenceSummary;
  trend: WeightTrendSummary;
  estimate: ExpenditureEstimate;
  /** The athlete's goal rate, or null before they have set a program. */
  goalRateKgPerWeek: number | null;
  /** Whether the program has generated any day targets at all yet. */
  hasProgram: boolean;
}

/** Everything a summary surface needs, computed once. */
export function nutritionSummary(db: NutritionDB, today: IsoDate): NutritionSummary {
  const estimate = currentEstimate(db, today);
  return {
    today: daySummary(db, today),
    adherence: adherenceSummary(db, today),
    trend: weightTrendSummary(estimate),
    estimate,
    goalRateKgPerWeek: db.program?.targetRateKgPerWeek ?? null,
    hasProgram: db.program != null,
  };
}
