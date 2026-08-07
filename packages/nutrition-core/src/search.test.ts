import { describe, expect, it } from 'vitest';
import {
  emptyNutritionDB,
  favoriteKeys,
  favoriteResults,
  foodSearch,
  recentResults,
  searchLocal,
  type CachedFood,
  type CustomFood,
  type FoodLogEntry,
  type NutritionDB,
  type Recipe,
} from '.';

/*
 * Search across four sources, three of them local.
 *
 * The offline cases are the point of this file. The shared catalogue is a
 * Postgres table over the network; everything else is on the device, and the
 * athlete must still be able to find and log something when the catalogue
 * cannot be reached.
 */

const cached = (over: Partial<CachedFood> & { id: string; name: string }): CachedFood => ({
  brand: null,
  barcode: null,
  servingQty: 100,
  servingUnit: 'g',
  calories: 100,
  proteinG: 10,
  carbsG: 10,
  fatG: 1,
  source: 'ausnut',
  externalId: null,
  nutritionBasisQty: 100,
  nutritionBasisUnit: 'g',
  servingSizeText: null,
  nutrients: {},
  servings: [],
  cachedAt: '2026-08-07T00:00:00.000Z',
  ...over,
});

const custom = (over: Partial<CustomFood> & { id: string; name: string }): CustomFood => ({
  userId: '',
  brand: null,
  barcode: null,
  servingQty: 1,
  servingUnit: 'serving',
  calories: 200,
  proteinG: 20,
  carbsG: 5,
  fatG: 8,
  nutrients: {},
  source: 'user_custom',
  createdAt: '2026-08-07T00:00:00.000Z',
  updatedAt: '2026-08-07T00:00:00.000Z',
  deletedAt: null,
  ...over,
});

const recipeOf = (over: Partial<Recipe> & { id: string; name: string }): Recipe => ({
  userId: '',
  description: null,
  instructions: null,
  servings: 2,
  items: [],
  createdAt: '2026-08-07T00:00:00.000Z',
  updatedAt: '2026-08-07T00:00:00.000Z',
  deletedAt: null,
  ...over,
});

const entry = (over: Partial<FoodLogEntry> & { id: string }): FoodLogEntry => ({
  userId: '',
  logDate: '2026-08-07',
  meal: 'breakfast',
  entryKind: 'food',
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

const db = (over: Partial<NutritionDB> = {}): NutritionDB => ({ ...emptyNutritionDB(), ...over });

describe('search with the catalogue reachable', () => {
  const base = db({
    foodCache: [cached({ id: 'food-1', name: 'Rolled oats', brand: 'Brand' })],
    customFoods: [custom({ id: 'c1', name: 'My oat bowl' })],
    recipes: [recipeOf({ id: 'r1', name: 'Oat pancakes' })],
  });

  it('puts catalogue, custom foods and recipes in one list, each saying what it is', () => {
    const remote = [cached({ id: 'food-2', name: 'Oat milk' })];
    const results = foodSearch(base, 'oat', remote);
    expect(results.map((r) => [r.kind, r.title])).toEqual([
      ['food', 'Oat milk'],
      ['food', 'Rolled oats'],
      ['custom_food', 'My oat bowl'],
      ['recipe', 'Oat pancakes'],
    ]);
  });

  it('shows a remote row only once when it is also cached', () => {
    const results = foodSearch(base, 'oats', [cached({ id: 'food-1', name: 'Rolled oats' })]);
    expect(results.filter((r) => r.id === 'food-1')).toHaveLength(1);
    // ...and marks it loggable offline, because a copy of it is on the device.
    expect(results[0].offline).toBe(true);
  });

  it('marks a remote row the device has never cached as not-yet-offline', () => {
    const results = foodSearch(base, 'milk', [cached({ id: 'food-9', name: 'Oat milk' })]);
    expect(results[0]).toMatchObject({ id: 'food-9', offline: false });
  });
});

describe('search with the catalogue unreachable', () => {
  /* The screen calls `foodSearch(db, query, [])` and shows its own banner: the
     empty remote list is all this layer ever sees, so "the catalogue returned
     nothing" and "the catalogue could not be asked" produce the same results
     here on purpose — dressing one up as the other is how an honest "no match"
     turns into a false network error. */
  const offlineDb = db({
    foodCache: [cached({ id: 'food-1', name: 'Rolled oats' })],
    customFoods: [custom({ id: 'c1', name: 'My oat bowl' })],
    recipes: [recipeOf({ id: 'r1', name: 'Oat pancakes' })],
  });

  it('still finds every source that lives on the device', () => {
    const results = foodSearch(offlineDb, 'oat', []);
    expect(results.map((r) => r.id)).toEqual(['food-1', 'c1', 'r1']);
    expect(results.every((r) => r.offline)).toBe(true);
  });

  it('finds nothing for a food that was never cached, rather than inventing one', () => {
    expect(foodSearch(offlineDb, 'quinoa', [])).toEqual([]);
    expect(searchLocal(offlineDb, 'quinoa')).toEqual([]);
  });

  it('matches on brand as well as name, since a brand often leads the label', () => {
    const branded = db({ foodCache: [cached({ id: 'f', name: 'Rolled oats', brand: 'Woolworths' })] });
    expect(searchLocal(branded, 'woolworths')).toHaveLength(1);
  });

  it('returns nothing for a blank query rather than the whole device', () => {
    expect(searchLocal(offlineDb, '   ')).toEqual([]);
  });
});

describe('favourites and recents', () => {
  const base = db({
    foodCache: [cached({ id: 'food-1', name: 'Rolled oats' })],
    customFoods: [custom({ id: 'c1', name: 'My oat bowl' })],
    recipes: [recipeOf({ id: 'r1', name: 'Oat pancakes' })],
    favorites: [
      { userId: '', foodId: 'food-1', customFoodId: null, recipeId: null, sortOrder: 1, createdAt: 'a', updatedAt: 'a', deletedAt: null },
      { userId: '', foodId: null, customFoodId: 'c1', recipeId: null, sortOrder: 0, createdAt: 'a', updatedAt: 'a', deletedAt: null },
    ],
  });

  it('lists favourites in their own order and keys them by kind and id', () => {
    expect(favoriteResults(base).map((r) => r.id)).toEqual(['c1', 'food-1']);
    expect(favoriteKeys(base)).toEqual(new Set(['food:food-1', 'custom_food:c1']));
  });

  it('drops a favourite whose source is gone instead of breaking the screen', () => {
    const dangling = db({
      favorites: [
        { userId: '', foodId: 'food-gone', customFoodId: null, recipeId: null, sortOrder: 0, createdAt: 'a', updatedAt: 'a', deletedAt: null },
      ],
    });
    expect(favoriteResults(dangling)).toEqual([]);
  });

  it('treats an un-starred favourite as gone without splicing the record', () => {
    const unstarred = db({
      ...base,
      favorites: base.favorites.map((f) => ({ ...f, deletedAt: '2026-08-08T00:00:00.000Z' })),
    });
    expect(favoriteResults(unstarred)).toEqual([]);
    expect(favoriteKeys(unstarred).size).toBe(0);
    // The row survives, or the star comes back from the other device on sync.
    expect(unstarred.favorites).toHaveLength(2);
  });

  it('lists the most recent distinct sources, newest first, quick adds excluded', () => {
    const logged = db({
      ...base,
      logEntries: [
        entry({ id: 'e1', foodId: 'food-1', createdAt: '2026-08-07T07:00:00.000Z' }),
        entry({ id: 'e2', entryKind: 'custom_food', customFoodId: 'c1', createdAt: '2026-08-07T09:00:00.000Z' }),
        // The same food again — one row in recents, not two.
        entry({ id: 'e3', foodId: 'food-1', createdAt: '2026-08-07T12:00:00.000Z' }),
        // A quick add has no source to log again.
        entry({ id: 'e4', entryKind: 'quick_add', createdAt: '2026-08-07T13:00:00.000Z' }),
        // A deleted entry is not a thing the athlete recently ate.
        entry({ id: 'e5', entryKind: 'recipe', recipeId: 'r1', createdAt: '2026-08-07T14:00:00.000Z', deletedAt: '2026-08-07T15:00:00.000Z' }),
      ],
    });
    expect(recentResults(logged).map((r) => r.id)).toEqual(['food-1', 'c1']);
  });

  it('caps recents at the limit it was given', () => {
    const many = db({
      foodCache: [cached({ id: 'a', name: 'A' }), cached({ id: 'b', name: 'B' })],
      logEntries: [
        entry({ id: 'e1', foodId: 'a', createdAt: '2026-08-07T07:00:00.000Z' }),
        entry({ id: 'e2', foodId: 'b', createdAt: '2026-08-07T08:00:00.000Z' }),
      ],
    });
    expect(recentResults(many, 1).map((r) => r.id)).toEqual(['b']);
  });
});
