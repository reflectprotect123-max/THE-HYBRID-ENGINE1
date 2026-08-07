import type { CachedFood, CustomFood, FoodServing, Recipe, RecipeItem, Scalable } from './types';

/*
 * Serving scaling and recipe macro resolution, ported function-for-function
 * from MacroTrack's `domain/ServingScaler.kt`, `domain/MacroResolution.kt` and
 * `data/RecipeMacroResolver.kt` (`reflectprotect123-max/thehybridsystem`
 * @ 079b356). `test/recipe.test.ts` is that repository's
 * `RecipeMacroResolverTest.kt`, fixture for fixture.
 *
 * PURE. The Kotlin resolver was "I/O only" and reached three Supabase-backed
 * repositories for its ingredients; the maths it called was already pure. Here
 * the split is the same one drawn differently: the ingredient lookups arrive as
 * a `RecipeLookup`, so the same code resolves a recipe from the local slice
 * with no connection and is testable without faking a network.
 *
 * THE RULE ALL OF THIS PROTECTS (MacroTrack's non-negotiable #1): a cross-unit
 * conversion is NEVER guessed. Grams to millilitres needs a density, this app
 * does not have one, and inventing one would put a number in front of the
 * athlete that no source ever stated. The only sanctioned bridge is a
 * `FoodServing` row carrying the real grams/millilitres for that serving,
 * because that value came from the source data.
 */

/** The four macros after a multiplier has been applied. */
export interface ScaledMacros {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export const ZERO_MACROS: ScaledMacros = { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 };

/**
 * A requested unit that this food cannot be scaled to.
 *
 * Its own class because `resolveFoodMacros` CATCHES exactly this one to try
 * the serving table, and must not swallow "quantity was negative" — which is a
 * caller bug, not a missing conversion — on the way past.
 */
export class IncompatibleUnitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IncompatibleUnitError';
  }
}

const positive = (n: number): boolean => Number.isFinite(n) && n > 0;

const byMultiplier = (food: Scalable, multiplier: number): ScaledMacros => ({
  calories: food.calories * multiplier,
  proteinG: food.proteinG * multiplier,
  carbsG: food.carbsG * multiplier,
  fatG: food.fatG * multiplier,
});

/**
 * Scale a food's stored macros to `quantity` of `unit`.
 *
 * The denominator is `servingQty`/`servingUnit` and NOT
 * `nutritionBasisQty`/`nutritionBasisUnit`: the import pipeline already scaled
 * every row's macros to its serving before writing it, so the basis fields are
 * provenance for `nutrients` only. Dividing by the basis here would silently
 * mis-scale every food whose serving is not 100 g.
 */
export function scaleTo(food: Scalable, quantity: number, unit: string): ScaledMacros {
  if (!positive(quantity)) throw new Error(`quantity must be finite and > 0, got ${quantity}`);
  if (!positive(food.servingQty)) throw new Error(`${food.name} has an invalid serving quantity ${food.servingQty}`);
  if (unit.toLowerCase() !== food.servingUnit.toLowerCase()) {
    throw new IncompatibleUnitError(
      `Cannot scale ${food.name}: requested unit '${unit}' does not match this food's serving unit ` +
        `'${food.servingUnit}'. Use a serving with an explicit gram/millilitre conversion instead of guessing a density.`,
    );
  }
  return byMultiplier(food, quantity / food.servingQty);
}

/**
 * Scale via a named serving, which is the only route between two units.
 *
 * The serving's recorded grams (or millilitres, whichever matches the food's
 * own basis unit) is a real measurement from the source data; multiplying it
 * out and dividing by the food's serving quantity converts without a density.
 */
export function scaleByServing(food: Scalable, serving: FoodServing, servingCount = 1): ScaledMacros {
  if (!positive(servingCount)) throw new Error(`servingCount must be finite and > 0, got ${servingCount}`);
  if (serving.foodId !== food.id) {
    throw new Error(`Serving ${serving.id} belongs to food ${serving.foodId}, not ${food.id}`);
  }
  const basisUnit = food.servingUnit.toLowerCase();
  const perServingAmount =
    basisUnit === 'g' ? serving.grams : basisUnit === 'ml' ? serving.millilitres : null;
  if (perServingAmount == null) {
    throw new IncompatibleUnitError(
      `Serving '${serving.label}' for ${food.name} has no ${basisUnit} conversion recorded.`,
    );
  }
  if (!positive(perServingAmount)) {
    throw new Error(`Serving '${serving.label}' has an invalid amount ${perServingAmount}`);
  }
  if (!positive(food.servingQty)) throw new Error(`${food.name} has an invalid serving quantity ${food.servingQty}`);
  return byMultiplier(food, (perServingAmount * servingCount) / food.servingQty);
}

/**
 * Scale a catalogue food, falling back to its serving table when the requested
 * unit is not the food's own.
 *
 * The fallback rethrows the ORIGINAL incompatibility when no serving matches,
 * because "this food has no slices" is a less useful thing to tell the athlete
 * than "this food is measured in grams".
 */
export function resolveFoodMacros(
  food: Scalable,
  servings: readonly FoodServing[],
  quantity: number,
  unit: string,
): ScaledMacros {
  try {
    return scaleTo(food, quantity, unit);
  } catch (direct) {
    if (!(direct instanceof IncompatibleUnitError)) throw direct;
    const matching = servings.find((s) => s.unit.toLowerCase() === unit.toLowerCase());
    if (!matching) throw direct;
    return scaleByServing(food, matching, quantity / matching.quantity);
  }
}

/**
 * Every unit this food can ACTUALLY be logged in, with one serving's worth in
 * each — the offer list a log sheet should show.
 *
 * The companion to `resolveFoodMacros`: it answers, without throwing, exactly
 * the question that function answers by succeeding or failing. A UI that
 * derives its units any other way offers chips that can only fail on save,
 * because a serving row converts only when it records the amount in the food's
 * OWN basis, and both `grams` and `millilitres` are nullable.
 *
 * The amounts matter as much as the units. A quantity is only meaningful
 * against its unit, so a sheet that changes one must reseed the other from
 * here; carrying "100" from grams onto a "slice" chip logged 100 slices.
 *
 * Insertion order is the offer order. The food's own unit leads, and only the
 * FIRST serving row for a unit is kept — that is the row `resolveFoodMacros`
 * picks, so offering a second one under the same name would be a lie.
 */
export function loggableUnits(food: Scalable, servings: readonly FoodServing[] = []): Record<string, number> {
  const basis = food.servingUnit.toLowerCase();
  const out: Record<string, number> = { [food.servingUnit]: positive(food.servingQty) ? food.servingQty : 1 };
  servings.forEach((s) => {
    if (out[s.unit] != null) return;
    const amount = basis === 'g' ? s.grams : basis === 'ml' ? s.millilitres : null;
    if (amount == null || !positive(amount)) return;
    out[s.unit] = positive(s.quantity) ? s.quantity : 1;
  });
  return out;
}

export function sumMacros(items: readonly ScaledMacros[]): ScaledMacros {
  return items.reduce<ScaledMacros>(
    (acc, item) => ({
      calories: acc.calories + item.calories,
      proteinG: acc.proteinG + item.proteinG,
      carbsG: acc.carbsG + item.carbsG,
      fatG: acc.fatG + item.fatG,
    }),
    { ...ZERO_MACROS },
  );
}

export function perServing(total: ScaledMacros, recipeServings: number): ScaledMacros {
  if (!positive(recipeServings)) {
    throw new Error(`recipeServings must be finite and > 0, got ${recipeServings}`);
  }
  return {
    calories: total.calories / recipeServings,
    proteinG: total.proteinG / recipeServings,
    carbsG: total.carbsG / recipeServings,
    fatG: total.fatG / recipeServings,
  };
}

export function forLoggedServings(perServingMacros: ScaledMacros, loggedServings: number): ScaledMacros {
  if (!positive(loggedServings)) {
    throw new Error(`loggedServings must be finite and > 0, got ${loggedServings}`);
  }
  return {
    calories: perServingMacros.calories * loggedServings,
    proteinG: perServingMacros.proteinG * loggedServings,
    carbsG: perServingMacros.carbsG * loggedServings,
    fatG: perServingMacros.fatG * loggedServings,
  };
}

/**
 * Where a recipe's ingredients come from. The Kotlin resolver took three
 * repositories; this takes the two reads it actually made.
 *
 * A miss returns `null` and the resolver THROWS, exactly as the reference did:
 * a recipe missing an ingredient has no honest per-serving number, and
 * resolving it as if the ingredient contributed zero would under-report every
 * meal logged from it (MacroTrack rule #1 again).
 */
export interface RecipeLookup {
  food: (id: string) => (CachedFood | null) | undefined;
  customFood: (id: string) => (CustomFood | null) | undefined;
}

/**
 * A recipe's macros for ONE serving.
 *
 * A custom-food ingredient resolves by a direct unit match only. That is the
 * reference's behaviour and it is not an oversight: `custom_foods` has no
 * `food_servings` rows, so there is no recorded conversion to fall back on and
 * the alternative would be a guessed density.
 */
export function resolveRecipePerServing(recipe: Recipe, lookup: RecipeLookup): ScaledMacros {
  const items = [...recipe.items].sort((a, b) => a.sortOrder - b.sortOrder);
  const itemMacros = items.map((item) => resolveRecipeItem(item, lookup));
  return perServing(sumMacros(itemMacros), recipe.servings);
}

/** One ingredient's contribution, at the quantity the recipe calls for. */
export function resolveRecipeItem(item: RecipeItem, lookup: RecipeLookup): ScaledMacros {
  if (item.foodId) {
    const food = lookup.food(item.foodId);
    if (!food) throw new Error(`Recipe item ${item.id} references missing food ${item.foodId}`);
    return resolveFoodMacros(food, food.servings, item.quantity, item.unit);
  }
  if (item.customFoodId) {
    const customFood = lookup.customFood(item.customFoodId);
    if (!customFood) {
      throw new Error(`Recipe item ${item.id} references missing custom food ${item.customFoodId}`);
    }
    return scaleTo(customFood, item.quantity, item.unit);
  }
  throw new Error(
    `Recipe item ${item.id} has neither foodId nor customFoodId (violates the DB check constraint)`,
  );
}
