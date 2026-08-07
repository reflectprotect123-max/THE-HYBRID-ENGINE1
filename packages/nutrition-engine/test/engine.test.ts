/*
 * Behavioural tests. The first block is the reference's own
 * `tests/test_adaptive_engine.py`, assertion for assertion; the rest are the
 * invariants `docs/ADAPTIVE_ENGINE_CONTRACT.md` and MacroTrack's CLAUDE.md
 * state in prose and the fixtures alone would not catch if someone later
 * "simplified" the engine.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ENGINE_CONFIG,
  addDays,
  calorieTarget,
  diffDays,
  engineConfig,
  estimateExpenditure,
  initialExpenditureKcal,
  macroTargets,
  nutritionIsCountable,
  weeklyCheckIn,
  weightTrend,
  type DailyRecord,
} from '../src/index';

const START = '2026-07-01';

function makeRecords(count = 14): DailyRecord[] {
  return Array.from({ length: count }, (_unused, index) => ({
    day: addDays(START, index),
    calories: 2800,
    weightKg: 90 - index * 0.04,
  }));
}

describe('ported reference tests', () => {
  it('weight trend smooths a spike', () => {
    const trend = weightTrend([90.0, 90.2, 90.1, 95.0, 90.2], 0.2);
    expect(trend.length).toBe(5);
    expect(trend[3] as number).toBeLessThan(91.5);
    expect(trend[4]).not.toBeNull();
  });

  it('expenditure updates only with coverage', () => {
    const estimate = estimateExpenditure(makeRecords(), 2800);
    expect(estimate.state).toBe('updating');
    expect(estimate.estimateKcal).not.toBeNull();
    expect(estimate.trendSlopeKgPerWeek).not.toBeNull();

    const incomplete = makeRecords();
    incomplete[2] = { day: (incomplete[2] as DailyRecord).day, calories: null, weightKg: 89.92, nutritionStatus: 'partial' };
    incomplete[3] = { day: (incomplete[3] as DailyRecord).day, calories: null, weightKg: 89.88, nutritionStatus: 'partial' };
    const held = estimateExpenditure(incomplete, 2800);
    expect(held.state).toBe('holding');
    expect(held.estimateKcal).toBe(2800);
  });

  it('targets are signed and preference driven', () => {
    expect(calorieTarget(2800, -0.5)).toBeLessThan(2800);
    expect(calorieTarget(2800, 0.5)).toBeGreaterThan(2800);

    const targets = macroTargets(2500, 90, 2.0, 0.8);
    expect(targets.proteinG).toBe(180.0);
    expect(targets.fatG).toBe(72.0);
    expect(targets.carbsG).toBeGreaterThanOrEqual(0);

    const result = weeklyCheckIn(makeRecords(), {
      previousExpenditureKcal: 2800,
      bodyWeightKg: 90,
      targetRateKgPerWeek: -0.3,
    });
    expect(result.modules).toEqual([
      { key: 'program_update', action: 'review and accept the proposed calorie and macro targets' },
    ]);
  });

  it('check-in returns hold modules', () => {
    const result = weeklyCheckIn(makeRecords(7), {
      previousExpenditureKcal: 2800,
      bodyWeightKg: 90,
      targetRateKgPerWeek: -0.3,
    });
    expect(result.status).toBe('held');
    expect(result.modules.length).toBeGreaterThan(0);
  });

  it('initial estimate is explicitly only a start', () => {
    const estimate = initialExpenditureKcal({
      weightKg: 90,
      heightCm: 177,
      ageYears: 32,
      sex: 'male',
      activityLevel: 'moderate',
    });
    expect(estimate).toBeGreaterThan(2000);
    expect(estimate).toBeLessThan(4000);
  });
});

describe('unknown intake is never zero intake', () => {
  it('excludes a partial day instead of averaging a zero into the mean', () => {
    const withPartial = makeRecords();
    withPartial[5] = { day: (withPartial[5] as DailyRecord).day, calories: null, weightKg: 89.8, nutritionStatus: 'partial' };
    const asZero = makeRecords();
    asZero[5] = { day: (asZero[5] as DailyRecord).day, calories: 0, weightKg: 89.8, nutritionStatus: 'complete' };

    const excluded = estimateExpenditure(withPartial, null);
    const coerced = estimateExpenditure(asZero, null);

    expect(excluded.nutritionDays).toBe(13);
    expect(coerced.nutritionDays).toBe(14);
    // 2800 kcal averaged away over 14 days is a ~200 kcal/day phantom deficit;
    // that gap is precisely the failure mode this rule exists to prevent.
    expect((excluded.rawEstimateKcal as number) - (coerced.rawEstimateKcal as number)).toBeGreaterThan(150);
  });

  it('ignores calories stored against an unlogged day', () => {
    expect(nutritionIsCountable({ day: START, calories: 2750, nutritionStatus: 'unlogged' })).toBe(false);
    expect(nutritionIsCountable({ day: START, calories: 2750, nutritionStatus: 'partial' })).toBe(false);
  });

  it('counts a declared fast only when zero calories were explicitly stored', () => {
    expect(nutritionIsCountable({ day: START, calories: 0, nutritionStatus: 'fasted' })).toBe(true);
    expect(nutritionIsCountable({ day: START, calories: null, nutritionStatus: 'fasted' })).toBe(false);
    expect(nutritionIsCountable({ day: START, nutritionStatus: 'fasted' })).toBe(false);
    // A fast with a non-zero figure is a contradiction, not a small meal.
    expect(nutritionIsCountable({ day: START, calories: 120, nutritionStatus: 'fasted' })).toBe(false);
  });

  it('treats a missing calorie value as unknown even on a complete day', () => {
    expect(nutritionIsCountable({ day: START, calories: null })).toBe(false);
    expect(nutritionIsCountable({ day: START, calories: 0 })).toBe(true);
  });
});

describe('holding is a normal state', () => {
  it('carries the previous estimate forward and says what is missing', () => {
    const held = estimateExpenditure(makeRecords(7), 2750);
    expect(held.state).toBe('holding');
    expect(held.estimateKcal).toBe(2750);
    expect(held.rawEstimateKcal).toBeNull();
    expect(held.explanation).toBe('More history is required before updating expenditure.');
  });

  it('names the weigh-in gap when a whole period has no weight', () => {
    const records = makeRecords().map((record, index) => ({
      ...record,
      weightKg: index < 7 ? record.weightKg : null,
    }));
    const held = estimateExpenditure(records, 2750);
    expect(held.state).toBe('holding');
    expect(held.explanation).toBe('At least one weigh-in is required in each seven-day period.');
  });

  it('holds without a number when there is nothing to carry forward', () => {
    const held = estimateExpenditure([], null);
    expect(held.confidence).toBe('holding');
    expect(held.estimateKcal).toBeNull();
    expect(held.explanation).toBe('No records are available.');
  });

  it('proposes no targets on a held check-in', () => {
    const result = weeklyCheckIn(makeRecords(7), {
      previousExpenditureKcal: 2800,
      bodyWeightKg: 90,
      targetRateKgPerWeek: -0.3,
    });
    expect(result.targets).toBeNull();
    expect(result.modules.map((module) => module.key)).toContain('logging_break');
  });
});

describe('the weight signal is allowed to be noisy', () => {
  it('updates through missing weigh-ins as long as each period has one', () => {
    const sparse = makeRecords().map((record, index) => ({
      ...record,
      weightKg: index % 5 === 0 ? record.weightKg : null,
    }));
    const estimate = estimateExpenditure(sparse, 2800);
    expect(estimate.state).toBe('updating');
    expect(estimate.weightDays).toBe(3);
  });

  it('rejects an EWMA alpha outside (0, 1]', () => {
    expect(() => weightTrend([90], 0)).toThrow(/alpha/);
    expect(() => weightTrend([90], 1.5)).toThrow(/alpha/);
    expect(() => weightTrend([90], 1)).not.toThrow();
  });

  it('leaves the series null until the first weigh-in', () => {
    expect(weightTrend([null, null, 88.4], 0.2)).toEqual([null, null, 88.4]);
  });
});

describe('updates are damped', () => {
  it('moves an existing estimate by at most one configured step', () => {
    const far = estimateExpenditure(makeRecords(), 1500);
    expect(far.estimateKcal).toBe(1600);
    expect(far.rawEstimateKcal as number).toBeGreaterThan(2500);

    const above = estimateExpenditure(makeRecords(), 4200);
    expect(above.estimateKcal).toBe(4100);
  });

  it('does not damp the first estimate, because there is nothing to damp from', () => {
    const first = estimateExpenditure(makeRecords(), null);
    expect(first.estimateKcal).toBe(first.rawEstimateKcal);
  });

  it('honours a configured step', () => {
    const wider = estimateExpenditure(makeRecords(), 1500, engineConfig({ maximumExpenditureStepKcal: 300 }));
    expect(wider.estimateKcal).toBe(1800);
  });
});

describe('macro allocation', () => {
  it('floors carbohydrate at zero when protein and fat already exceed the target', () => {
    const targets = macroTargets(1200, 110, 2.2, 1.1);
    expect(targets.carbsG).toBe(0);
    // Known reference behaviour, ported deliberately: the returned macros then
    // total MORE than the calorie target and nothing flags it. See the port
    // report — do not "fix" this without changing the Python reference too.
    expect(targets.macroCalories).toBeGreaterThan(targets.calories);
  });

  it('uses the config defaults when no preference is supplied', () => {
    const targets = macroTargets(2500, 90);
    expect(targets.proteinG).toBe(90 * DEFAULT_ENGINE_CONFIG.defaultProteinGPerKg);
    expect(targets.fatG).toBe(90 * DEFAULT_ENGINE_CONFIG.defaultFatGPerKg);
  });
});

describe('determinism', () => {
  it('is pure: same input, same output, and the caller\'s array is untouched', () => {
    const records = makeRecords();
    const snapshot = JSON.stringify(records);
    const first = estimateExpenditure(records, 2800);
    const second = estimateExpenditure(records, 2800);
    expect(first).toEqual(second);
    expect(JSON.stringify(records)).toBe(snapshot);
  });

  it('sorts unordered input rather than trusting the caller', () => {
    const ordered = estimateExpenditure(makeRecords(), 2800);
    const reversed = estimateExpenditure([...makeRecords()].reverse(), 2800);
    expect(reversed).toEqual(ordered);
  });

  it('exposes a frozen default config so one caller cannot re-tune another', () => {
    expect(Object.isFrozen(DEFAULT_ENGINE_CONFIG)).toBe(true);
    const custom = engineConfig({ trendAlpha: 0.5 });
    expect(custom.trendAlpha).toBe(0.5);
    expect(DEFAULT_ENGINE_CONFIG.trendAlpha).toBe(0.2);
  });
});

describe('date handling', () => {
  it('counts calendar days across month, year and leap boundaries', () => {
    expect(addDays('2026-07-31', 1)).toBe('2026-08-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(diffDays('2024-03-01', '2024-02-28')).toBe(2);
    expect(diffDays('2026-07-14', '2026-07-01')).toBe(13);
  });

  it('rejects a date that is not a real calendar day', () => {
    expect(() => addDays('2026-02-30', 0)).toThrow(/Not a real calendar date/);
    expect(() => addDays('07/01/2026', 0)).toThrow(/ISO YYYY-MM-DD/);
  });
});
