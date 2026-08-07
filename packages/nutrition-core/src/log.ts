import type {
  CachedFood,
  CustomFood,
  FoodLogEntry,
  IsoDate,
  IsoTimestamp,
  Recipe,
  SourceSnapshot,
} from './types';
import { forLoggedServings, scaleTo, resolveFoodMacros, type ScaledMacros } from './recipe';

/*
 * Building a log entry, ported from MacroTrack's `data/LogRepository.kt`
 * (`logFood`, `logCustomFood`, `logRecipeServings`, `logQuickAdd` and the three
 * private `*Snapshot` builders).
 *
 * THE ONE INVARIANT THIS FILE EXISTS FOR: an entry's `calories`, `proteinG`,
 * `carbsG`, `fatG` and `displayName` are computed HERE, once, at log time, and
 * are never derived again. `foodId`/`customFoodId`/`recipeId` ride along as
 * provenance and as the handle for "log this again" — nothing may read them to
 * recompute what the athlete ate. Editing a custom food tomorrow, or a
 * catalogue re-import moving a food's numbers, must leave last month's log
 * exactly as it was. See `FoodLogEntry`.
 *
 * `nutrients` is the deliberate exception and is copied UNSCALED, at the
 * source's own basis, because that is the shape every consumer of a
 * micronutrient profile expects. `FoodLogEntry.nutrients` says so at the field.
 *
 * `sourceSnapshot` keys are the reference's snake_case verbatim. They are
 * opaque to this repository, so renaming them to camelCase would fork a record
 * that MacroTrack's own exports and any future importer still read.
 */

/** Everything about a log write that is not the food. */
export interface LogContext {
  /** Minted by the caller — this package has no id generator and needs none. */
  id: string;
  /** Left blank until the sync layer owns it; see DailyLog's note on `userId`. */
  userId?: string;
  logDate: IsoDate;
  meal: string;
  /** One instant for `createdAt`/`updatedAt`, passed in so a write is testable. */
  at: IsoTimestamp;
  notes?: string | null;
}

/** The fields every branch below fills identically. */
const base = (ctx: LogContext) => ({
  id: ctx.id,
  userId: ctx.userId ?? '',
  logDate: ctx.logDate,
  meal: ctx.meal,
  notes: ctx.notes ?? null,
  createdAt: ctx.at,
  updatedAt: ctx.at,
  deletedAt: null,
});

const macroFields = (m: ScaledMacros) => ({
  calories: m.calories,
  proteinG: m.proteinG,
  carbsG: m.carbsG,
  fatG: m.fatG,
});

/** The four scaled numbers, under the reference's `logged_*` snapshot keys. */
const loggedMacros = (m: ScaledMacros): SourceSnapshot => ({
  logged_calories: m.calories,
  logged_protein_g: m.proteinG,
  logged_carbs_g: m.carbsG,
  logged_fat_g: m.fatG,
});

/**
 * Log `quantity` `unit` of a catalogue food.
 *
 * The food is the LOCAL CACHE copy (`NutritionDB.foodCache`), not a live
 * fetch: the athlete must be able to log a food they have used before with no
 * connection. Because the numbers are snapshotted right here, logging from a
 * cache row that the server has since corrected produces exactly the same
 * outcome as logging from a stale in-memory row would have — an entry that
 * records what the app showed at the moment the athlete confirmed it.
 *
 * Throws `IncompatibleUnitError` when neither the food's own unit nor any of
 * its servings can express `unit`. A thrown error is the correct outcome: the
 * alternative is a guessed density.
 */
export function logEntryFromFood(
  ctx: LogContext,
  food: CachedFood,
  quantity: number,
  unit: string,
): FoodLogEntry {
  const macros = resolveFoodMacros(food, food.servings, quantity, unit);
  return {
    ...base(ctx),
    entryKind: 'food',
    foodId: food.id,
    customFoodId: null,
    recipeId: null,
    quantity,
    unit,
    ...macroFields(macros),
    displayName: food.name,
    // Copied at the SOURCE's basis and NOT scaled — see the file header.
    nutrients: { ...food.nutrients },
    sourceSnapshot: {
      kind: 'food',
      food_id: food.id,
      name: food.name,
      ...(food.brand ? { brand: food.brand } : {}),
      ...(food.barcode ? { barcode: food.barcode } : {}),
      source: food.source,
      ...(food.externalId ? { external_id: food.externalId } : {}),
      serving_qty: food.servingQty,
      serving_unit: food.servingUnit,
      nutrition_basis_qty: food.nutritionBasisQty,
      nutrition_basis_unit: food.nutritionBasisUnit,
      ...(food.servingSizeText ? { serving_size_text: food.servingSizeText } : {}),
      logged_quantity: quantity,
      logged_unit: unit,
      ...loggedMacros(macros),
    },
  };
}

/**
 * Log `quantity` `unit` of a custom food.
 *
 * Direct unit match only, because `custom_foods` has no servings table — the
 * reference's behaviour, and the honest one: there is no recorded conversion
 * to fall back on.
 */
export function logEntryFromCustomFood(
  ctx: LogContext,
  food: CustomFood,
  quantity: number,
  unit: string,
): FoodLogEntry {
  const macros = scaleTo(food, quantity, unit);
  return {
    ...base(ctx),
    entryKind: 'custom_food',
    foodId: null,
    customFoodId: food.id,
    recipeId: null,
    quantity,
    unit,
    ...macroFields(macros),
    displayName: food.name,
    nutrients: { ...food.nutrients },
    sourceSnapshot: {
      kind: 'custom_food',
      custom_food_id: food.id,
      name: food.name,
      ...(food.brand ? { brand: food.brand } : {}),
      ...(food.barcode ? { barcode: food.barcode } : {}),
      source: 'user_custom',
      serving_qty: food.servingQty,
      serving_unit: food.servingUnit,
      logged_quantity: quantity,
      logged_unit: unit,
      ...loggedMacros(macros),
    },
  };
}

/**
 * Log `loggedServings` servings of a recipe.
 *
 * `perServingMacros` is resolved by the caller (`resolveRecipePerServing`) so
 * that this function stays a pure snapshot write and the resolution — which can
 * throw on a missing ingredient — happens where the screen can report it.
 *
 * `nutrients` is deliberately EMPTY, as in the reference. A recipe has no
 * single nutrition basis: its ingredients each have their own, and merging them
 * into one map would produce a micronutrient profile no source ever stated.
 */
export function logEntryFromRecipe(
  ctx: LogContext,
  recipe: Recipe,
  perServingMacros: ScaledMacros,
  loggedServings: number,
): FoodLogEntry {
  const macros = forLoggedServings(perServingMacros, loggedServings);
  return {
    ...base(ctx),
    entryKind: 'recipe',
    foodId: null,
    customFoodId: null,
    recipeId: recipe.id,
    quantity: loggedServings,
    unit: 'serving',
    ...macroFields(macros),
    displayName: recipe.name,
    nutrients: {},
    sourceSnapshot: {
      kind: 'recipe',
      recipe_id: recipe.id,
      name: recipe.name,
      recipe_servings: recipe.servings,
      logged_servings: loggedServings,
      per_logged_calories: macros.calories,
      per_logged_protein_g: macros.proteinG,
      per_logged_carbs_g: macros.carbsG,
      per_logged_fat_g: macros.fatG,
    },
  };
}

/**
 * Log bare macros with no food record behind them.
 *
 * `quantity: 1, unit: 'serving'` and all three provenance ids null — the
 * table's check constraint for `quick_add`. There is nothing here that could
 * ever be re-derived, which is the whole point of the kind: it is what keeps
 * logging possible when the catalogue is unreachable and the athlete has only
 * a wrapper in their hand.
 */
export function quickAddEntry(
  ctx: LogContext,
  fields: { displayName: string } & ScaledMacros,
): FoodLogEntry {
  return {
    ...base(ctx),
    entryKind: 'quick_add',
    foodId: null,
    customFoodId: null,
    recipeId: null,
    quantity: 1,
    unit: 'serving',
    ...macroFields(fields),
    displayName: fields.displayName,
    // Empty, not fabricated: a quick add HAS no micronutrient profile.
    nutrients: {},
    sourceSnapshot: {
      kind: 'quick_add',
      display_name: fields.displayName,
      calories: fields.calories,
      protein_g: fields.proteinG,
      carbs_g: fields.carbsG,
      fat_g: fields.fatG,
    },
  };
}

/**
 * Apply a hand edit of an entry's macros, keeping the entry internally
 * honest.
 *
 * The edit sheets are quick-add shaped — a name and four macros — but open on
 * ANY entry, including one logged from a catalogue food. Assigning the four
 * macros straight onto the record left `quantity`, `unit` and every
 * `logged_*` key in `sourceSnapshot` still stating the pre-edit numbers, so a
 * 200 g chicken breast corrected from 330 to 495 kcal became a record that
 * said 495 in one place and 330 in another. Nothing re-derived anything — the
 * snapshot simply stopped describing the entry, and an export or a future
 * importer reads the snapshot.
 *
 * So: the `logged_*` figures are brought with the edit, and the snapshot is
 * stamped `manual_macro_edit` with the instant. Provenance keys — the food id,
 * its name, its own serving basis — are left exactly as they were, because
 * they are still true: this food IS where the entry came from. What is no
 * longer true, and is now recorded as such, is that scaling that source by
 * `quantity` produces these macros.
 *
 * `quantity` and `unit` are untouched. They are what the athlete logged, and
 * this sheet gives them no way to restate it; the flag is what tells a reader
 * not to multiply by them.
 */
export function applyManualMacroEdit(
  entry: FoodLogEntry,
  fields: { displayName: string; meal: string } & ScaledMacros,
  at: IsoTimestamp,
): void {
  entry.displayName = fields.displayName;
  entry.meal = fields.meal;
  entry.calories = fields.calories;
  entry.proteinG = fields.proteinG;
  entry.carbsG = fields.carbsG;
  entry.fatG = fields.fatG;
  entry.updatedAt = at;
  entry.sourceSnapshot = {
    ...entry.sourceSnapshot,
    ...loggedMacros(fields),
    // A quick add states its macros under bare keys as well as `logged_*`.
    ...(entry.entryKind === 'quick_add'
      ? {
          display_name: fields.displayName,
          calories: fields.calories,
          protein_g: fields.proteinG,
          carbs_g: fields.carbsG,
          fat_g: fields.fatG,
        }
      : { manual_macro_edit: at }),
  };
}
