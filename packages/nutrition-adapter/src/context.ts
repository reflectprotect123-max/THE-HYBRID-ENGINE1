import type { NutritionDB } from '@hybrid/nutrition-core';
import { diffDays, nutritionIsCountable, type IsoDate } from '@hybrid/nutrition-engine';
import type { NutritionContext } from '@hybrid/whole-athlete-state';
import { currentEstimate, dailyRecords } from './slice';

/*
 * The one projection from the athlete's nutrition slice to the FACTS
 * `@hybrid/whole-athlete-state` is allowed to read.
 *
 * This function is the wall CLAUDE.md's amended nutrition rule describes, made
 * out of code rather than out of discipline. `NutritionDB` carries the
 * athlete's macro program — a calorie target, a macro split, a goal rate — and
 * `NutritionContext` carries none of those. Everything a target could travel on
 * is dropped HERE, once, in a function with a test that reads a slice twice
 * with two different targets and asserts the output is identical.
 *
 * What survives the projection is what the athlete DID (days logged, mean kcal
 * logged) and what the nutrition engine OBSERVED about their body (expenditure).
 * What does not survive is anything anybody prescribed.
 */

/**
 * A week, because a week is the unit the nutrition side already thinks in — the
 * check-in, the coverage gate and the goal rate are all weekly. A longer window
 * would keep reporting an underfuelled week the athlete has already corrected.
 */
export const NUTRITION_CONTEXT_WINDOW_DAYS = 7;

/**
 * The facts for the window ending on `today`, inclusive.
 *
 * `nutritionIsCountable` is the engine's own predicate rather than a local
 * `calories != null`: a day the athlete declared FASTED counts (it stored a
 * real zero), and a `partial` day does not (its total is not what they ate).
 * Deciding that again here is how adherence starts meaning one thing on the
 * coach bench and another inside the engine.
 */
export function nutritionContext(
  db: NutritionDB,
  today: IsoDate,
  windowDays = NUTRITION_CONTEXT_WINDOW_DAYS,
): NutritionContext {
  const records = dailyRecords(db, today).filter((r) => {
    const back = diffDays(today, r.day);
    return back >= 0 && back < windowDays;
  });
  const counted = records.filter(nutritionIsCountable);
  const kcal = counted.map((r) => r.calories ?? 0);
  return {
    windowDays,
    loggedDays: counted.length,
    // Mean of the COUNTED days only. Dividing by `windowDays` instead would
    // read an unlogged day as a zero-calorie day, which is the phantom deficit
    // `dailyRecords` exists to avoid — and it would feed straight into the
    // underfuelling constraint below it.
    meanIntakeKcal: kcal.length === 0 ? null : kcal.reduce((a, b) => a + b, 0) / kcal.length,
    // `estimateKcal` is null exactly while the engine is holding, and null is
    // what the context wants in that case: "no estimate" must not be read as a
    // very low one.
    estimatedExpenditureKcal: currentEstimate(db, today).estimateKcal,
  };
}
