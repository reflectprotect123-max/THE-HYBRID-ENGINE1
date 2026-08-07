import { describe, expect, it } from 'vitest';
import {
  IncompatibleUnitError,
  resolveFoodMacros,
  resolveRecipePerServing,
  scaleTo,
  type CachedFood,
  type CustomFood,
  type FoodServing,
  type Recipe,
  type RecipeItem,
  type RecipeLookup,
} from '../src';

/*
 * The recipe macro maths, ported fixture for fixture from MacroTrack's
 * `app/src/test/java/com/macrotrack/app/data/RecipeMacroResolverTest.kt`
 * (`reflectprotect123-max/thehybridsystem` @ 079b356), plus the unit-safety
 * cases that repository's `ServingScaler` KDoc describes but never asserted.
 *
 * Every expected number below is the Kotlin test's, unchanged. If one of these
 * moves, the port has stopped agreeing with the app it was ported from — which
 * is the only thing that makes "faithful" a checkable claim.
 */

// 100 g basis: 165 kcal / 31 g protein / 0 g carbs / 3.6 g fat.
const chickenBreast: CachedFood = {
  id: 'food-1',
  name: 'Chicken Breast',
  brand: null,
  barcode: null,
  servingQty: 100,
  servingUnit: 'g',
  calories: 165,
  proteinG: 31,
  carbsG: 0,
  fatG: 3.6,
  source: 'ausnut',
  externalId: '1-1',
  nutritionBasisQty: 100,
  nutritionBasisUnit: 'g',
  servingSizeText: '100 g',
  nutrients: {},
  servings: [],
  cachedAt: '2026-08-07T00:00:00.000Z',
};

// 250 ml basis: 180 kcal / 30 g protein / 9 g carbs / 2 g fat.
const proteinShake: CustomFood = {
  id: 'custom-1',
  userId: 'user-1',
  name: 'Protein Shake',
  brand: null,
  barcode: null,
  servingQty: 250,
  servingUnit: 'ml',
  calories: 180,
  proteinG: 30,
  carbsG: 9,
  fatG: 2,
  nutrients: {},
  source: 'user_custom',
  createdAt: '2026-08-07T00:00:00.000Z',
  updatedAt: '2026-08-07T00:00:00.000Z',
  deletedAt: null,
};

const item = (over: Partial<RecipeItem> & { id: string }): RecipeItem => ({
  recipeId: 'recipe-1',
  foodId: null,
  customFoodId: null,
  quantity: 100,
  unit: 'g',
  sortOrder: 0,
  ...over,
});

const recipe = (over: Partial<Recipe> & { id: string; items: RecipeItem[] }): Recipe => ({
  userId: 'user-1',
  name: 'A recipe',
  description: null,
  instructions: null,
  servings: 1,
  createdAt: '2026-08-07T00:00:00.000Z',
  updatedAt: '2026-08-07T00:00:00.000Z',
  deletedAt: null,
  ...over,
});

const lookup = (foods: CachedFood[] = [], customFoods: CustomFood[] = []): RecipeLookup => ({
  food: (id) => foods.find((f) => f.id === id) ?? null,
  customFood: (id) => customFoods.find((f) => f.id === id) ?? null,
});

describe('resolveRecipePerServing, against the reference fixtures', () => {
  it('resolves a food-only recipe using a direct unit match', () => {
    // 200 g of chicken = 2x the 100 g basis -> 330 / 62 / 0 / 7.2 total.
    // Recipe makes 2 servings -> per serving is exactly the 100 g basis.
    const r = recipe({
      id: 'recipe-1',
      name: 'Chicken Only',
      servings: 2,
      items: [item({ id: 'item-1', foodId: 'food-1', quantity: 200, unit: 'g' })],
    });

    const result = resolveRecipePerServing(r, lookup([chickenBreast]));

    expect(result.calories).toBeCloseTo(165, 3);
    expect(result.proteinG).toBeCloseTo(31, 3);
    expect(result.carbsG).toBeCloseTo(0, 3);
    expect(result.fatG).toBeCloseTo(3.6, 3);
  });

  it('resolves a custom-food-only recipe by scaling it directly', () => {
    // 500 ml of shake = 2x the 250 ml basis -> 360 / 60 / 18 / 4 total.
    // Recipe makes 4 servings -> per serving is half the 250 ml basis.
    const r = recipe({
      id: 'recipe-2',
      name: 'Shake Only',
      servings: 4,
      items: [item({ id: 'item-2', recipeId: 'recipe-2', customFoodId: 'custom-1', quantity: 500, unit: 'ml' })],
    });

    const result = resolveRecipePerServing(r, lookup([], [proteinShake]));

    expect(result.calories).toBeCloseTo(90, 3);
    expect(result.proteinG).toBeCloseTo(15, 3);
    expect(result.carbsG).toBeCloseTo(4.5, 3);
    expect(result.fatG).toBeCloseTo(1, 3);
  });

  it('combines a food item and a custom-food item in the same recipe', () => {
    // 100 g chicken (1x basis) = 165 / 31 / 0 / 3.6; 250 ml shake (1x) = 180 / 30 / 9 / 2.
    // Sum = 345 / 61 / 9 / 5.6, over 2 servings -> 172.5 / 30.5 / 4.5 / 2.8.
    const r = recipe({
      id: 'recipe-3',
      name: 'Chicken and Shake',
      servings: 2,
      items: [
        item({ id: 'item-3a', recipeId: 'recipe-3', foodId: 'food-1', quantity: 100, unit: 'g', sortOrder: 0 }),
        item({ id: 'item-3b', recipeId: 'recipe-3', customFoodId: 'custom-1', quantity: 250, unit: 'ml', sortOrder: 1 }),
      ],
    });

    const result = resolveRecipePerServing(r, lookup([chickenBreast], [proteinShake]));

    expect(result.calories).toBeCloseTo(172.5, 3);
    expect(result.proteinG).toBeCloseTo(30.5, 3);
    expect(result.carbsG).toBeCloseTo(4.5, 3);
    expect(result.fatG).toBeCloseTo(2.8, 3);
  });

  it('throws when a food item references a food that no longer exists', () => {
    const r = recipe({
      id: 'recipe-4',
      name: 'Dangling Food Reference',
      items: [item({ id: 'item-4', recipeId: 'recipe-4', foodId: 'food-missing' })],
    });

    expect(() => resolveRecipePerServing(r, lookup())).toThrow(/missing food food-missing/);
  });

  it('throws when a recipe item has neither a food nor a custom food', () => {
    const r = recipe({
      id: 'recipe-5',
      name: 'Malformed Item',
      items: [item({ id: 'item-5', recipeId: 'recipe-5' })],
    });

    expect(() => resolveRecipePerServing(r, lookup())).toThrow(/neither foodId nor customFoodId/);
  });
});

describe('unit safety — the rule the whole file exists for', () => {
  const slice: FoodServing = {
    id: 'serving-1',
    foodId: 'food-1',
    label: 'slice',
    quantity: 1,
    unit: 'slice',
    grams: 30,
    millilitres: null,
    isDefault: true,
    sortOrder: 0,
  };

  it('refuses to convert grams to millilitres rather than guessing a density', () => {
    expect(() => scaleTo(chickenBreast, 100, 'ml')).toThrow(IncompatibleUnitError);
    // The message has to name the food's real unit: the athlete's next move is
    // to re-enter the quantity, and they need to know in what.
    expect(() => scaleTo(chickenBreast, 100, 'ml')).toThrow(/serving unit 'g'/);
  });

  it('converts through a serving row, because that gram figure came from the source', () => {
    // 2 slices x 30 g = 60 g = 0.6x the 100 g basis.
    const result = resolveFoodMacros(chickenBreast, [slice], 2, 'slice');
    expect(result.calories).toBeCloseTo(99, 3);
    expect(result.proteinG).toBeCloseTo(18.6, 3);
  });

  it('still refuses when no serving row records the requested unit', () => {
    expect(() => resolveFoodMacros(chickenBreast, [slice], 1, 'cup')).toThrow(IncompatibleUnitError);
  });

  it('rejects a non-positive quantity instead of returning zero macros', () => {
    // Not an IncompatibleUnitError: `resolveFoodMacros` catches that one to try
    // the serving table, and must not swallow a caller bug on the way past.
    expect(() => scaleTo(chickenBreast, 0, 'g')).toThrow(/quantity must be finite/);
    expect(() => resolveFoodMacros(chickenBreast, [slice], -5, 'g')).toThrow(/quantity must be finite/);
  });
});
