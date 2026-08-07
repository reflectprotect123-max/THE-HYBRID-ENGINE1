import { describe, expect, it } from 'vitest';
import {
  applyManualMacroEdit,
  logEntryFromCustomFood,
  logEntryFromFood,
  logEntryFromRecipe,
  quickAddEntry,
  resolveRecipePerServing,
  type CachedFood,
  type CustomFood,
  type LogContext,
  type Recipe,
  type RecipeLookup,
} from '.';

/*
 * THE SNAPSHOT INVARIANT.
 *
 * A log entry's macros and name are copied at log time and never re-derived
 * from the source record. The tests that matter here are the ones that MUTATE
 * a food after logging it and assert the entry did not move: that is the
 * failure mode the invariant exists to prevent, and it is invisible to any test
 * that only checks the numbers at the moment of the write.
 */

const ctx = (over: Partial<LogContext> = {}): LogContext => ({
  id: 'entry-1',
  logDate: '2026-08-07',
  meal: 'lunch',
  at: '2026-08-07T12:00:00.000Z',
  ...over,
});

const oats = (): CachedFood => ({
  id: 'food-1',
  name: 'Rolled oats',
  brand: 'Some brand',
  barcode: '9300000000000',
  servingQty: 100,
  servingUnit: 'g',
  calories: 379,
  proteinG: 13.2,
  carbsG: 67.7,
  fatG: 6.5,
  source: 'ausnut',
  externalId: '1-2',
  nutritionBasisQty: 100,
  nutritionBasisUnit: 'g',
  servingSizeText: '100 g',
  nutrients: { sodiumMg: 5 },
  servings: [],
  cachedAt: '2026-08-07T00:00:00.000Z',
});

const shake = (): CustomFood => ({
  id: 'custom-1',
  userId: '',
  name: 'Protein shake',
  brand: null,
  barcode: null,
  servingQty: 250,
  servingUnit: 'ml',
  calories: 180,
  proteinG: 30,
  carbsG: 9,
  fatG: 2,
  nutrients: { calciumMg: 300 },
  source: 'user_custom',
  createdAt: '2026-08-07T00:00:00.000Z',
  updatedAt: '2026-08-07T00:00:00.000Z',
  deletedAt: null,
});

describe('a catalogue food, logged', () => {
  it('scales the macros to the logged quantity and keeps the provenance', () => {
    const entry = logEntryFromFood(ctx(), oats(), 50, 'g');
    expect(entry.entryKind).toBe('food');
    expect(entry.foodId).toBe('food-1');
    expect(entry.customFoodId).toBeNull();
    expect(entry.recipeId).toBeNull();
    expect(entry.calories).toBeCloseTo(189.5, 3);
    expect(entry.proteinG).toBeCloseTo(6.6, 3);
    expect(entry.displayName).toBe('Rolled oats');
  });

  it('copies `nutrients` UNSCALED, at the source basis', () => {
    // 50 g of a 100 g-basis food is half the macros, and the SAME nutrient map.
    // Halving it here would be the bug `FoodLogEntry.nutrients` documents:
    // consumers scale by each entry's own basis, so a pre-scaled map is
    // silently double-scaled downstream.
    const entry = logEntryFromFood(ctx(), oats(), 50, 'g');
    expect(entry.nutrients).toEqual({ sodiumMg: 5 });
  });

  it('does not move when the source food is corrected afterwards', () => {
    const food = oats();
    const entry = logEntryFromFood(ctx(), food, 100, 'g');
    const before = JSON.parse(JSON.stringify(entry));

    // A catalogue re-import lands, or the athlete fixes a typo in the food.
    food.calories = 1;
    food.proteinG = 0;
    food.carbsG = 0;
    food.fatG = 0;
    food.name = 'Renamed entirely';
    food.nutrients.sodiumMg = 9999;

    expect(entry).toEqual(before);
    expect(entry.calories).toBe(379);
    expect(entry.displayName).toBe('Rolled oats');
    expect(entry.nutrients).toEqual({ sodiumMg: 5 });
  });

  it('records enough provenance to explain the number without re-deriving it', () => {
    const entry = logEntryFromFood(ctx(), oats(), 50, 'g');
    expect(entry.sourceSnapshot).toMatchObject({
      kind: 'food',
      food_id: 'food-1',
      serving_qty: 100,
      serving_unit: 'g',
      logged_quantity: 50,
      logged_unit: 'g',
      logged_calories: 189.5,
    });
  });
});

describe('a custom food, logged', () => {
  it('scales by the athlete-entered serving and snapshots the result', () => {
    const entry = logEntryFromCustomFood(ctx(), shake(), 500, 'ml');
    expect(entry.entryKind).toBe('custom_food');
    expect(entry.customFoodId).toBe('custom-1');
    expect(entry.calories).toBeCloseTo(360, 3);
    expect(entry.proteinG).toBeCloseTo(60, 3);
  });

  it('does not move when the athlete edits the custom food afterwards', () => {
    const food = shake();
    const entry = logEntryFromCustomFood(ctx(), food, 250, 'ml');

    food.calories = 999;
    food.name = 'Edited';
    food.updatedAt = '2026-08-09T00:00:00.000Z';

    expect(entry.calories).toBe(180);
    expect(entry.displayName).toBe('Protein shake');
  });

  it('refuses a unit the custom food cannot express', () => {
    // No `food_servings` for a custom food, so there is no recorded conversion
    // and the only alternative would be a guessed density.
    expect(() => logEntryFromCustomFood(ctx(), shake(), 100, 'g')).toThrow(/does not match/);
  });
});

describe('a recipe, logged', () => {
  const recipe: Recipe = {
    id: 'recipe-1',
    userId: '',
    name: 'Overnight oats',
    description: null,
    instructions: null,
    servings: 2,
    items: [
      { id: 'i1', recipeId: 'recipe-1', foodId: 'food-1', customFoodId: null, quantity: 100, unit: 'g', sortOrder: 0 },
      { id: 'i2', recipeId: 'recipe-1', foodId: null, customFoodId: 'custom-1', quantity: 250, unit: 'ml', sortOrder: 1 },
    ],
    createdAt: '2026-08-07T00:00:00.000Z',
    updatedAt: '2026-08-07T00:00:00.000Z',
    deletedAt: null,
  };

  const lookupFor = (food: CachedFood, custom: CustomFood): RecipeLookup => ({
    food: (id) => (id === food.id ? food : null),
    customFood: (id) => (id === custom.id ? custom : null),
  });

  it('logs a serving at the resolved per-serving macros', () => {
    // (379 + 180) / 2 servings = 279.5 kcal per serving.
    const perServing = resolveRecipePerServing(recipe, lookupFor(oats(), shake()));
    const entry = logEntryFromRecipe(ctx(), recipe, perServing, 1);
    expect(entry.entryKind).toBe('recipe');
    expect(entry.recipeId).toBe('recipe-1');
    expect(entry.unit).toBe('serving');
    expect(entry.quantity).toBe(1);
    expect(entry.calories).toBeCloseTo(279.5, 3);
  });

  it('carries no nutrient map, because a recipe has no single basis', () => {
    const perServing = resolveRecipePerServing(recipe, lookupFor(oats(), shake()));
    expect(logEntryFromRecipe(ctx(), recipe, perServing, 1).nutrients).toEqual({});
  });

  it('does not move when an ingredient is corrected afterwards', () => {
    const food = oats();
    const custom = shake();
    const perServing = resolveRecipePerServing(recipe, lookupFor(food, custom));
    const entry = logEntryFromRecipe(ctx(), recipe, perServing, 2);
    expect(entry.calories).toBeCloseTo(559, 3);

    food.calories = 0;
    custom.calories = 0;
    // The recipe itself changes too — this is the case a resolver-on-read
    // implementation would get wrong, because the recipe is the live record.
    recipe.items.pop();
    recipe.name = 'Renamed';

    expect(entry.calories).toBeCloseTo(559, 3);
    expect(entry.displayName).toBe('Overnight oats');
  });
});

describe('a quick add', () => {
  it('carries no provenance at all, because there is nothing to re-derive from', () => {
    const entry = quickAddEntry(ctx(), {
      displayName: 'Pub lunch',
      calories: 900,
      proteinG: 40,
      carbsG: 80,
      fatG: 45,
    });
    expect(entry.entryKind).toBe('quick_add');
    expect(entry.foodId).toBeNull();
    expect(entry.customFoodId).toBeNull();
    expect(entry.recipeId).toBeNull();
    expect(entry.quantity).toBe(1);
    expect(entry.unit).toBe('serving');
    expect(entry.nutrients).toEqual({});
    expect(entry.calories).toBe(900);
  });
});

/*
 * A hand edit of the macros, from a sheet that opens on ANY entry kind. The
 * bug this guards: the four macros moved and the snapshot did not, so the
 * record said 495 in one place and 330 in another — and an export reads the
 * snapshot.
 */
describe('applyManualMacroEdit', () => {
  const edited = {
    displayName: 'Chicken breast, 300 g',
    meal: 'dinner',
    calories: 495,
    proteinG: 93,
    carbsG: 0,
    fatG: 10.8,
  };

  it('carries the snapshot with the numbers on a catalogue-sourced entry', () => {
    const entry = logEntryFromFood(ctx(), oats(), 50, 'g');
    applyManualMacroEdit(entry, edited, '2026-08-07T19:00:00.000Z');

    expect(entry.calories).toBe(495);
    expect(entry.sourceSnapshot.logged_calories).toBe(495);
    expect(entry.sourceSnapshot.logged_protein_g).toBe(93);
    expect(entry.updatedAt).toBe('2026-08-07T19:00:00.000Z');
  });

  it('keeps the provenance and flags that the source no longer explains the macros', () => {
    const entry = logEntryFromFood(ctx(), oats(), 50, 'g');
    applyManualMacroEdit(entry, edited, '2026-08-07T19:00:00.000Z');

    // Still true: this IS where the entry came from.
    expect(entry.foodId).toBe('food-1');
    expect(entry.sourceSnapshot.food_id).toBe('food-1');
    expect(entry.sourceSnapshot.serving_qty).toBe(100);
    // No longer true, and now recorded as such — a reader must not scale by
    // `quantity` to reproduce these macros.
    expect(entry.sourceSnapshot.manual_macro_edit).toBe('2026-08-07T19:00:00.000Z');
    expect(entry.quantity).toBe(50);
  });

  it('never re-derives: mutating the source food afterwards moves nothing', () => {
    const food = oats();
    const entry = logEntryFromFood(ctx(), food, 50, 'g');
    applyManualMacroEdit(entry, edited, '2026-08-07T19:00:00.000Z');
    food.calories = 9999;
    food.name = 'Renamed';

    expect(entry.calories).toBe(495);
    expect(entry.displayName).toBe('Chicken breast, 300 g');
  });

  it('updates a quick add\'s bare snapshot keys too, and does not flag it', () => {
    const entry = quickAddEntry(ctx(), { displayName: 'Toast', calories: 100, proteinG: 3, carbsG: 18, fatG: 1 });
    applyManualMacroEdit(entry, { ...edited, displayName: 'Toast, two slices' }, '2026-08-07T19:00:00.000Z');

    expect(entry.sourceSnapshot.calories).toBe(495);
    expect(entry.sourceSnapshot.logged_calories).toBe(495);
    expect(entry.sourceSnapshot.display_name).toBe('Toast, two slices');
    // A quick add has no source to contradict — its macros ARE the record.
    expect(entry.sourceSnapshot.manual_macro_edit).toBeUndefined();
  });
});
