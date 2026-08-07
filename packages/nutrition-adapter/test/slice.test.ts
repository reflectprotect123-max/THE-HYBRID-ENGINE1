import { describe, expect, it } from 'vitest';
import { emptyNutritionDB, type CheckIn, type FoodLogEntry, type NutritionDB, type WeightEntry } from '@hybrid/nutrition-core';
import {
  checkInFor,
  dailyRecords,
  dampingAnchor,
  goalOf,
  latestWeighIn,
  liveWeighIns,
  macro,
  macroOvershoot,
  macroLine,
  nextWeekStart,
  positiveQty,
  round,
  titleCase,
  trendSeries,
  weekEndOf,
  weekStartOf,
  weighInDay,
  weightByDay,
} from '../src';

/*
 * The projection every nutrition screen reads through, and the input parsing
 * every nutrition screen writes through — neither had a test.
 *
 * That mattered more than the line count suggests: `dailyRecords` is what the
 * expenditure estimate is computed FROM, so a defect here moves the athlete's
 * calorie target without any engine test noticing. The engine's own parity
 * suite proves the maths; nothing proved the inputs.
 */

const weighIn = (id: string, date: string, kg: number, over: Partial<WeightEntry> = {}): WeightEntry => ({
  id,
  userId: '',
  // Midday local, so the local-calendar day cannot straddle the UTC boundary
  // whichever timezone the suite runs in.
  measuredAt: `${date}T12:00:00.000Z`,
  weightKg: kg,
  source: 'manual',
  note: null,
  createdAt: `${date}T12:00:00.000Z`,
  updatedAt: `${date}T12:00:00.000Z`,
  ...over,
});

const entry = (id: string, logDate: string, calories: number, over: Partial<FoodLogEntry> = {}): FoodLogEntry => ({
  id,
  userId: '',
  logDate,
  meal: 'lunch',
  entryKind: 'quick_add',
  foodId: null,
  customFoodId: null,
  recipeId: null,
  quantity: 1,
  unit: 'serving',
  calories,
  proteinG: 0,
  carbsG: 0,
  fatG: 0,
  displayName: 'Something',
  nutrients: {},
  notes: null,
  sourceSnapshot: {},
  createdAt: `${logDate}T12:00:00.000Z`,
  updatedAt: `${logDate}T12:00:00.000Z`,
  deletedAt: null,
  ...over,
});

const db = (over: Partial<NutritionDB> = {}): NutritionDB => ({ ...emptyNutritionDB(), ...over });

describe('weigh-in reads', () => {
  it('orders oldest first and breaks a tie on id, so the series never depends on array order', () => {
    const out = liveWeighIns(db({
      weightEntries: [weighIn('b', '2026-08-05', 89), weighIn('a', '2026-08-05', 90), weighIn('c', '2026-08-01', 91)],
    }));
    expect(out.map((w) => w.id)).toEqual(['c', 'a', 'b']);
  });

  it('skips a deleted weigh-in without treating it as absent history', () => {
    const out = liveWeighIns(db({
      weightEntries: [
        weighIn('a', '2026-08-01', 90),
        weighIn('b', '2026-08-05', 89, { deletedAt: '2026-08-06T00:00:00.000Z' }),
      ],
    }));
    expect(out.map((w) => w.id)).toEqual(['a']);
    expect(latestWeighIn(db({ weightEntries: out }))?.id).toBe('a');
  });

  it('has no latest weigh-in when there is none, rather than a zero', () => {
    expect(latestWeighIn(emptyNutritionDB())).toBeNull();
  });

  it('averages two weigh-ins on one day instead of picking one', () => {
    // Two measurements of one fact. Picking either would make the trend depend
    // on which order the array happened to be in.
    const out = weightByDay(db({ weightEntries: [weighIn('a', '2026-08-05', 90), weighIn('b', '2026-08-05', 88)] }));
    expect(out.get('2026-08-05')).toBe(89);
  });

  it('files a weigh-in against its LOCAL day', () => {
    expect(weighInDay(weighIn('a', '2026-08-05', 90))).toBe('2026-08-05');
  });
});

describe('dailyRecords — what the expenditure estimate is computed from', () => {
  it('leaves a day with no entries as null intake, never 0', () => {
    // A zero here is a phantom deficit of hundreds of kcal/day, which the
    // estimate then converts into a calorie target the athlete eats to.
    const out = dailyRecords(db({
      logEntries: [entry('e1', '2026-08-01', 2200), entry('e3', '2026-08-03', 2400)],
    }), '2026-08-03');
    expect(out.map((r) => r.day)).toEqual(['2026-08-01', '2026-08-02', '2026-08-03']);
    expect(out[1]?.calories).toBeNull();
    expect(out[1]?.nutritionStatus).toBe('unlogged');
  });

  it('gives a DECLARED fast an explicit 0, because a real fast leaves no entries', () => {
    const out = dailyRecords(db({
      logEntries: [entry('e1', '2026-08-01', 2200)],
      dayStatus: [{ userId: '', logDate: '2026-08-02', status: 'fasted', updatedAt: '2026-08-02T20:00:00.000Z' }],
    }), '2026-08-02');
    expect(out[1]).toMatchObject({ day: '2026-08-02', calories: 0, nutritionStatus: 'fasted' });
  });

  it('sums a day and ignores a deleted entry', () => {
    const out = dailyRecords(db({
      logEntries: [
        entry('e1', '2026-08-01', 500),
        entry('e2', '2026-08-01', 700),
        entry('e3', '2026-08-01', 900, { deletedAt: '2026-08-01T20:00:00.000Z' }),
      ],
    }), '2026-08-01');
    expect(out[0]?.calories).toBe(1200);
  });

  it('never reaches past today, so a mis-dated future entry cannot enter the window', () => {
    const out = dailyRecords(db({ logEntries: [entry('e1', '2026-08-01', 2200), entry('e2', '2026-09-01', 2200)] }), '2026-08-02');
    expect(out.map((r) => r.day)).toEqual(['2026-08-01', '2026-08-02']);
  });

  it('returns nothing at all for an athlete who has logged nothing', () => {
    expect(dailyRecords(emptyNutritionDB(), '2026-08-07')).toEqual([]);
  });
});

describe('weeks', () => {
  it('starts the week on the Monday on or before the day', () => {
    // 2026-08-07 is a Friday.
    expect(weekStartOf('2026-08-07')).toBe('2026-08-03');
    expect(weekStartOf('2026-08-03')).toBe('2026-08-03');
    expect(weekStartOf('2026-08-02')).toBe('2026-07-27');
  });

  it('has no timezone in it — every day of a week maps to the same Monday', () => {
    const days = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09'];
    expect(new Set(days.map(weekStartOf))).toEqual(new Set(['2026-08-03']));
  });

  it('runs Monday to Sunday', () => {
    expect(weekEndOf('2026-08-03')).toBe('2026-08-09');
    expect(nextWeekStart('2026-08-03')).toBe('2026-08-10');
  });
});

describe('check-in reads', () => {
  const checkIn = (weekStart: string, over: Partial<CheckIn> = {}): CheckIn => ({
    id: `check-${weekStart}`,
    userId: '',
    weekStart,
    weekEnd: weekEndOf(weekStart),
    status: 'accepted',
    modules: [],
    explanation: '',
    observedExpenditureKcal: null,
    proposedExpenditureKcal: null,
    previousExpenditureKcal: null,
    proposedCalories: null,
    proposedProteinG: null,
    proposedCarbsG: null,
    proposedFatG: null,
    createdAt: `${weekStart}T00:00:00.000Z`,
    updatedAt: `${weekStart}T00:00:00.000Z`,
    ...over,
  });

  it('finds the check-in for a week and nothing for a week without one', () => {
    const d = db({ checkIns: [checkIn('2026-08-03')] });
    expect(checkInFor(d, '2026-08-03')?.weekStart).toBe('2026-08-03');
    expect(checkInFor(d, '2026-07-27')).toBeNull();
  });

  it('anchors damping to a STRICTLY earlier week, never the one being recomputed', () => {
    // Anchoring to the row about to be replaced walks the estimate one damping
    // step closer to raw on every press — drift bought with taps.
    const d = db({
      checkIns: [
        checkIn('2026-07-27', { proposedExpenditureKcal: 2900 }),
        checkIn('2026-08-03', { proposedExpenditureKcal: 3100 }),
      ],
    });
    expect(dampingAnchor(d, '2026-08-03')).toBe(2900);
  });

  it('takes the LATEST earlier week, and falls back to its previous figure', () => {
    const d = db({
      checkIns: [
        checkIn('2026-07-20', { proposedExpenditureKcal: 2700 }),
        checkIn('2026-07-27', { previousExpenditureKcal: 2850 }),
      ],
    });
    expect(dampingAnchor(d, '2026-08-03')).toBe(2850);
  });

  it('has no anchor before the first check-in', () => {
    expect(dampingAnchor(emptyNutritionDB(), '2026-08-03')).toBeNull();
  });
});

describe('the defects this layer must surface rather than hide', () => {
  it('reports macros that overshoot their own calorie target', () => {
    // 200 g protein + 100 g fat = 1700 kcal against a 1500 kcal target: the two
    // numbers cannot both be met, and the engine returns no flag saying so.
    const out = macroOvershoot({ calories: 1500, proteinG: 200, carbsG: 0, fatG: 100 });
    expect(out.macroCalories).toBe(1700);
    expect(out.overKcal).toBe(200);
  });

  it('treats a 1 kcal disagreement as rounding, not a contradiction', () => {
    expect(macroOvershoot({ calories: 2000, proteinG: 150, carbsG: 200, fatG: 55.7 }).overKcal).toBe(0);
  });
});

describe('typed input', () => {
  it('reads a comma decimal, which a comma-locale keyboard is what produces', () => {
    // `Number("3,2")` is NaN, and NaN became 0 — a correctly typed 3.2 g of
    // protein stored and displayed as 0, reading as success.
    expect(macro('3,2')).toBe(3.2);
    expect(positiveQty('1,5')).toBe(1.5);
  });

  it('still reads a dot decimal and a thousands group', () => {
    expect(macro('3.2')).toBe(3.2);
    expect(macro('1,234')).toBe(1234);
    expect(macro(' 250 ')).toBe(250);
  });

  it('refuses a non-quantity rather than dividing by it', () => {
    expect(positiveQty('0')).toBeNull();
    expect(positiveQty('-2')).toBeNull();
    expect(positiveQty('abc')).toBeNull();
  });

  it('floors a negative or unreadable macro at 0', () => {
    expect(macro('-30')).toBe(0);
    expect(macro('abc')).toBe(0);
    expect(macro('')).toBe(0);
  });

  it('formats the way every screen prints it', () => {
    expect(round(124.6)).toBe('125');
    expect(macroLine({ calories: 500.4, proteinG: 30.6, carbsG: 50, fatG: 15 })).toBe('500 kcal · 31P 50C 15F');
    expect(titleCase('breakfast')).toBe('Breakfast');
    expect(titleCase('')).toBe('');
  });
});

describe('goal', () => {
  it('reads the sign of the rate, with zero meaning maintain', () => {
    expect(goalOf(-0.5)).toBe('lose');
    expect(goalOf(0)).toBe('maintain');
    expect(goalOf(0.25)).toBe('gain');
  });
});

describe('trendSeries', () => {
  it('runs the EWMA over the WHOLE history and only then slices to the window', () => {
    // Restarting the filter at the left edge of the chart would invent a
    // different curve for the same weigh-ins depending on how far back the
    // screen happened to look.
    const entries = Array.from({ length: 10 }, (_, i) =>
      weighIn(`w${i}`, `2026-08-${String(i + 1).padStart(2, '0')}`, 90 - i * 0.2));
    const wide = trendSeries(db({ weightEntries: entries }), '2026-08-10', 10);
    const narrow = trendSeries(db({ weightEntries: entries }), '2026-08-10', 3);
    expect(narrow.days).toEqual(wide.days.slice(-3));
    expect(narrow.trend).toEqual(wide.trend.slice(-3));
  });

  it('is empty for an athlete who has never weighed in', () => {
    expect(trendSeries(emptyNutritionDB(), '2026-08-07', 30)).toEqual({ days: [], raw: [], trend: [] });
  });
});
