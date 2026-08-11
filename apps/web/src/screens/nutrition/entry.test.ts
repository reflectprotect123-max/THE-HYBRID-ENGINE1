import { describe, expect, it } from 'vitest';
import {
  logEntryFromCustomFood,
  logEntryFromFood,
  logEntryFromRecipe,
  upsertCachedFood,
  emptyNutritionDB,
  type CachedFood,
  type CustomFood,
  type Recipe,
} from '@hybrid/nutrition-core';
import { cacheFood, entryFromCustomFood, entryFromFood, entryFromRecipe } from './entry';

/*
 * `entryFromFood`/`entryFromCustomFood`/`entryFromRecipe`/`cacheFood` are pure
 * forwards to nutrition-core's own writers — see this file's header. What
 * matters is that they thread every argument through unchanged, so this pins
 * each one against calling the core function directly, the same convention
 * `apps/web/src/store/nutrition-log.test.ts` uses for `entryFromDraft` against
 * `quickAddEntry`.
 */

const CTX = { id: 'entry-1', logDate: '2026-08-07', meal: 'lunch', at: '2026-08-07T12:30:00.000Z' };

const food: CachedFood = {
  id: 'food-1',
  name: 'Rolled oats',
  servingQty: 100,
  servingUnit: 'g',
  calories: 379,
  proteinG: 13.2,
  carbsG: 67.7,
  fatG: 6.5,
  nutritionBasisQty: 100,
  nutritionBasisUnit: 'g',
  source: 'usda',
  nutrients: { fiber_g: 10 },
  servings: [],
  cachedAt: '2026-08-01T00:00:00.000Z',
};

const customFood: CustomFood = {
  id: 'custom-1',
  userId: '',
  name: 'Mom’s granola',
  servingQty: 50,
  servingUnit: 'g',
  calories: 210,
  proteinG: 5,
  carbsG: 28,
  fatG: 8,
  nutrients: {},
  source: 'user_custom',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const recipe: Recipe = {
  id: 'recipe-1',
  userId: '',
  name: 'Overnight oats',
  servings: 2,
  items: [],
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const perServingMacros = { calories: 300, proteinG: 15, carbsG: 40, fatG: 9 };

describe('entryFromFood', () => {
  it('produces exactly what logEntryFromFood produces for the same inputs', () => {
    const expected = logEntryFromFood(CTX, food, 150, 'g');
    expect(entryFromFood(CTX, food, 150, 'g')).toEqual(expected);
  });

  it('rethrows IncompatibleUnitError rather than swallowing it', () => {
    expect(() => entryFromFood(CTX, food, 1, 'cup')).toThrow(/Cannot scale/);
  });
});

describe('entryFromCustomFood', () => {
  it('produces exactly what logEntryFromCustomFood produces for the same inputs', () => {
    const expected = logEntryFromCustomFood(CTX, customFood, 50, 'g');
    expect(entryFromCustomFood(CTX, customFood, 50, 'g')).toEqual(expected);
  });
});

describe('entryFromRecipe', () => {
  it('produces exactly what logEntryFromRecipe produces for the same inputs', () => {
    const expected = logEntryFromRecipe(CTX, recipe, perServingMacros, 1.5);
    expect(entryFromRecipe(CTX, recipe, perServingMacros, 1.5)).toEqual(expected);
  });
});

describe('cacheFood', () => {
  it('upserts the same way upsertCachedFood does, in place on the draft', () => {
    const viaWrapper = emptyNutritionDB();
    cacheFood(viaWrapper, food);

    const viaCore = emptyNutritionDB();
    upsertCachedFood(viaCore, food);

    expect(viaWrapper).toEqual(viaCore);
    expect(viaWrapper.foodCache).toEqual([food]);
  });

  it('replaces an existing cache row wholesale rather than merging fields', () => {
    const db = emptyNutritionDB();
    cacheFood(db, food);
    const refetched: CachedFood = { ...food, calories: 400, cachedAt: '2026-08-05T00:00:00.000Z' };
    cacheFood(db, refetched);
    expect(db.foodCache).toEqual([refetched]);
  });
});
