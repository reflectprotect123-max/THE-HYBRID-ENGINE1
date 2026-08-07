import { describe, expect, it } from 'vitest';
import {
  emptyNutritionDB,
  type FoodLogEntry,
  type MacroProgram,
  type NutritionDB,
  type WeightEntry,
} from '@hybrid/nutrition-core';
import { deriveAthleteState } from '@hybrid/whole-athlete-state';
import { emptySharedCore } from '@hybrid/shared-core';
import { adherenceSummary, nutritionContext, nutritionSummary } from '../src';

/*
 * The projection that decides what whole-athlete-state is allowed to see.
 *
 * BOUNDARY 1 of CLAUDE.md's amended nutrition rule lives here, and this is the
 * only place it can be proven behaviourally: `NutritionDB` HAS a macro program
 * with day targets on it, and `NutritionContext` must come out the other side
 * carrying none of them.
 */

const DAY = '2026-08-07';

const entry = (over: Partial<FoodLogEntry> & { id: string; logDate: string }): FoodLogEntry => ({
  userId: '',
  meal: 'breakfast',
  entryKind: 'quick_add',
  foodId: null,
  customFoodId: null,
  recipeId: null,
  quantity: 1,
  unit: 'serving',
  calories: 500,
  proteinG: 30,
  carbsG: 50,
  fatG: 15,
  displayName: 'Something',
  nutrients: {},
  notes: null,
  sourceSnapshot: {},
  createdAt: over.logDate + 'T07:00:00.000Z',
  updatedAt: over.logDate + 'T07:00:00.000Z',
  deletedAt: null,
  ...over,
});

const weighIn = (id: string, date: string, kg: number): WeightEntry => ({
  id,
  userId: '',
  // Midday local, so the local-calendar day never straddles the UTC boundary
  // whatever timezone the suite runs in.
  measuredAt: date + 'T12:00:00.000Z',
  weightKg: kg,
  source: 'manual',
  note: null,
  createdAt: date + 'T12:00:00.000Z',
  updatedAt: date + 'T12:00:00.000Z',
});

const dayBefore = (date: string, back: number): string => {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y as number, (m as number) - 1, d as number));
  t.setUTCDate(t.getUTCDate() - back);
  return t.toISOString().slice(0, 10);
};

/** A program whose day targets say `calories`. The number under test. */
const programWithTarget = (calories: number): MacroProgram => ({
  id: 'prog-1',
  userId: '',
  name: 'Goal',
  mode: 'manual',
  goal: 'lose',
  targetRateKgPerWeek: -0.5,
  startDate: dayBefore(DAY, 30),
  endDate: null,
  weeklyCalorieBudget: null,
  proteinPreference: null,
  fatPreference: null,
  status: 'active',
  days: Array.from({ length: 8 }, (_, i) => ({
    programId: 'prog-1',
    targetDate: dayBefore(DAY, i),
    calories,
    proteinG: 180,
    carbsG: 200,
    fatG: 70,
    source: 'engine',
    createdAt: DAY + 'T00:00:00.000Z',
  })),
  createdAt: DAY + 'T00:00:00.000Z',
  updatedAt: DAY + 'T00:00:00.000Z',
});

/** Seven straight days of 2,000 kcal logged and a falling weight. */
const loggedWeek = (program: MacroProgram | null = null): NutritionDB => ({
  ...emptyNutritionDB(),
  program,
  logEntries: Array.from({ length: 30 }, (_, i) =>
    entry({ id: 'e' + i, logDate: dayBefore(DAY, i), calories: 2000 }),
  ),
  weightEntries: Array.from({ length: 30 }, (_, i) => weighIn('w' + i, dayBefore(DAY, i), 80 + i * 0.05)),
});

describe('nutritionContext', () => {
  it('reports the trailing week of logging as adherence and mean intake', () => {
    const facts = nutritionContext(loggedWeek(), DAY);
    expect(facts.windowDays).toBe(7);
    expect(facts.loggedDays).toBe(7);
    expect(facts.meanIntakeKcal).toBe(2000);
  });

  it('averages the days that were logged, never dividing by the days that were not', () => {
    /* An unlogged day is unknown, not a zero-calorie day. Dividing by the
       window would report ~571 kcal/day here and hand whole-athlete-state a
       phantom deficit of thousands of kcal. */
    const db: NutritionDB = { ...emptyNutritionDB(), logEntries: [entry({ id: 'e0', logDate: DAY, calories: 2000 })] };
    const facts = nutritionContext(db, DAY);
    expect(facts.loggedDays).toBe(1);
    expect(facts.meanIntakeKcal).toBe(2000);
  });

  it('reports no intake at all for an athlete who has logged nothing', () => {
    const facts = nutritionContext(emptyNutritionDB(), DAY);
    expect(facts).toEqual({
      windowDays: 7,
      loggedDays: 0,
      meanIntakeKcal: null,
      estimatedExpenditureKcal: null,
    });
  });

  /* ---- BOUNDARY 1: a nutrition target never leaves this function -------- */

  it('produces identical facts for two athletes whose macro TARGETS differ wildly', () => {
    const lean = nutritionContext(loggedWeek(programWithTarget(1200)), DAY);
    const bulk = nutritionContext(loggedWeek(programWithTarget(4500)), DAY);
    const none = nutritionContext(loggedWeek(null), DAY);
    expect(lean).toEqual(bulk);
    expect(lean).toEqual(none);
  });

  it('carries the target no further: the derived athlete state is identical too', () => {
    // The end-to-end statement of the same rule. Whatever a coach or the
    // engine set as a target, the training-side snapshot cannot tell.
    const core = emptySharedCore(1);
    const state = (calories: number | null) =>
      deriveAthleteState({
        core,
        today: DAY,
        nutrition: nutritionContext(loggedWeek(calories == null ? null : programWithTarget(calories)), DAY),
      });
    expect(state(1200)).toEqual(state(4500));
    expect(state(1200)).toEqual(state(null));
  });
});

describe('summary surfaces', () => {
  it('reads the same adherence numbers the constraint was gated on', () => {
    const db = loggedWeek();
    const facts = nutritionContext(db, DAY);
    const summary = adherenceSummary(db, DAY);
    expect(summary.loggedDays).toBe(facts.loggedDays);
    expect(summary.windowDays).toBe(facts.windowDays);
    expect(summary.pct).toBe(100);
  });

  it('leaves the day target absent rather than zeroed when there is no program', () => {
    const s = nutritionSummary(loggedWeek(null), DAY);
    expect(s.today.target).toBeNull();
    expect(s.today.caloriePct).toBeNull();
    expect(s.hasProgram).toBe(false);
  });

  it('reports a rising weight as rising and a flat one as steady', () => {
    const rising = nutritionSummary(loggedWeek(), DAY);
    // `loggedWeek` walks the weight DOWN as `i` grows, so the newest day is the
    // lightest: read forward in time, this athlete is losing.
    expect(rising.trend.direction).toBe('falling');
    const flat: NutritionDB = {
      ...loggedWeek(),
      weightEntries: Array.from({ length: 30 }, (_, i) => weighIn('w' + i, dayBefore(DAY, i), 80)),
    };
    expect(nutritionSummary(flat, DAY).trend.direction).toBe('steady');
  });
});
