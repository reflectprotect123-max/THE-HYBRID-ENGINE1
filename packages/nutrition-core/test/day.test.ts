import { describe, expect, it } from 'vitest';
import {
  MEALS,
  ZERO_TOTALS,
  emptyNutritionDB,
  entriesForDay,
  groupByMeal,
  macroTotals,
  targetForDay,
  type FoodLogEntry,
  type MacroProgram,
  type NutritionDB,
} from '../src';

/*
 * Reading one day out of the slice. These are the numbers the Daily Log screen
 * puts in front of the athlete, so a wrong answer here is a wrong answer on a
 * phone — and none of them is derivable from a source food, by design.
 */

const entry = (over: Partial<FoodLogEntry> & { id: string }): FoodLogEntry => ({
  userId: '',
  logDate: '2026-08-07',
  meal: 'breakfast',
  entryKind: 'quick_add',
  foodId: null,
  customFoodId: null,
  recipeId: null,
  quantity: 1,
  unit: 'serving',
  calories: 0,
  proteinG: 0,
  carbsG: 0,
  fatG: 0,
  displayName: 'Something',
  nutrients: {},
  notes: null,
  sourceSnapshot: {},
  createdAt: '2026-08-07T07:00:00.000Z',
  updatedAt: '2026-08-07T07:00:00.000Z',
  deletedAt: null,
  ...over,
});

const db = (logEntries: FoodLogEntry[], program: MacroProgram | null = null): NutritionDB => ({
  ...emptyNutritionDB(),
  logEntries,
  program,
});

describe('entriesForDay', () => {
  it('takes only that day, and only the live entries', () => {
    const today = entry({ id: 'a' });
    const other = entry({ id: 'b', logDate: '2026-08-06' });
    const gone = entry({ id: 'c', deletedAt: '2026-08-07T09:00:00.000Z' });
    expect(entriesForDay(db([today, other, gone]), '2026-08-07').map((e) => e.id)).toEqual(['a']);
  });

  it('orders a day by when it was logged, not by whatever order the merge emitted', () => {
    // mergeNutrition emits by id, so a lunch logged after breakfast can arrive
    // FIRST. The screen has to read as the day was actually eaten.
    const lunch = entry({ id: 'a-lunch', createdAt: '2026-08-07T12:00:00.000Z' });
    const breakfast = entry({ id: 'z-breakfast', createdAt: '2026-08-07T07:00:00.000Z' });
    expect(entriesForDay(db([lunch, breakfast]), '2026-08-07').map((e) => e.id)).toEqual([
      'z-breakfast',
      'a-lunch',
    ]);
  });
});

describe('macroTotals', () => {
  it('sums the snapshot macros', () => {
    const totals = macroTotals([
      entry({ id: 'a', calories: 400, proteinG: 30, carbsG: 40, fatG: 10 }),
      entry({ id: 'b', calories: 655, proteinG: 12.5, carbsG: 80, fatG: 27 }),
    ]);
    expect(totals).toEqual({ calories: 1055, proteinG: 42.5, carbsG: 120, fatG: 37 });
  });

  it('is zero for a day with nothing on it, never null', () => {
    expect(macroTotals([])).toEqual(ZERO_TOTALS);
  });

  it('ignores `nutrients` entirely', () => {
    // Those sit at each SOURCE's own basis, not scaled to quantity — adding
    // them across entries produces a plausible-looking wrong number, so the
    // four macros must be the only thing this function reads.
    const totals = macroTotals([entry({ id: 'a', calories: 100, nutrients: { calories: 9999, sodiumMg: 400 } })]);
    expect(totals.calories).toBe(100);
  });

  it('does not mutate a shared zero', () => {
    macroTotals([entry({ id: 'a', calories: 500 })]);
    expect(ZERO_TOTALS).toEqual({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0 });
  });
});

describe('targetForDay', () => {
  const program: MacroProgram = {
    id: 'p1',
    userId: '',
    name: 'Cut',
    mode: 'coached',
    goal: 'lose',
    targetRateKgPerWeek: -0.4,
    startDate: '2026-08-01',
    endDate: null,
    weeklyCalorieBudget: null,
    proteinPreference: null,
    fatPreference: null,
    status: 'active',
    days: [
      {
        programId: 'p1',
        targetDate: '2026-08-07',
        calories: 2400,
        proteinG: 180,
        carbsG: 250,
        fatG: 70,
        source: 'engine',
        createdAt: '2026-08-01T00:00:00.000Z',
      },
    ],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };

  it('returns the day the program actually generated', () => {
    expect(targetForDay(program, '2026-08-07')).toEqual({
      calories: 2400,
      proteinG: 180,
      carbsG: 250,
      fatG: 70,
    });
  });

  it('returns null — never a zero target — for a day the program has no answer for', () => {
    // A zeroed target would be shown as coaching the athlete never received.
    expect(targetForDay(program, '2026-08-08')).toBeNull();
    expect(targetForDay(null, '2026-08-07')).toBeNull();
  });
});

describe('groupByMeal', () => {
  it('buckets in meal order regardless of the order entries were logged in', () => {
    const groups = groupByMeal(
      [
        entry({ id: 'a', meal: 'dinner' }),
        entry({ id: 'b', meal: 'breakfast' }),
        entry({ id: 'c', meal: 'dinner' }),
      ],
      MEALS,
    );
    expect(groups.map((g) => g.meal)).toEqual(['breakfast', 'dinner']);
    expect(groups[1].entries.map((e) => e.id)).toEqual(['a', 'c']);
  });

  it("keeps an athlete's own meal label instead of folding it into 'other'", () => {
    // `meal` is free text in the schema on purpose; a label the athlete chose
    // is data, not a value to be repaired.
    const groups = groupByMeal([entry({ id: 'a', meal: 'pre-training' })], MEALS);
    expect(groups.map((g) => g.meal)).toEqual(['pre-training']);
  });
});
