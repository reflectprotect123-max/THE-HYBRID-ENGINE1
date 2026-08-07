import type { CachedFood, CustomFood, FoodLogEntry, Recipe } from './types';
import type { NutritionDB } from './db';
import { isLive } from './day';

/*
 * One search over four sources, ported from MacroTrack's
 * `ui/search/FoodSearchViewModel.kt` (its `onQueryChanged`, `loadRecent` and
 * `loadFavorites`) and `domain/RecentReferences.kt`.
 *
 * The reference queried four repositories, all of them networked. Here exactly
 * one source is remote — the shared `foods` catalogue — and the other three
 * (custom foods, recipes, favourites) plus the recents derived from the log are
 * local. Everything in this file is pure and works with no connection; the
 * caller passes in whatever the catalogue returned, or nothing at all when it
 * could not be reached. See `NutritionDB.foodCache` for why a catalogue food
 * the athlete has used before is still findable offline.
 */

/** Which of the three source tables a result came from. Mirrors `EntryKind`. */
export type FoodSourceKind = 'food' | 'custom_food' | 'recipe';

export interface FoodSearchResult {
  kind: FoodSourceKind;
  id: string;
  title: string;
  subtitle: string | null;
  /**
   * True when this row is on the device: a local custom food or recipe, or a
   * cached catalogue food. The screen shows it, because "can I still log this
   * on the train" is a question the athlete otherwise has to answer by trying.
   */
  offline: boolean;
}

/** The reference's `favoriteKey`: identity of a starrable thing across kinds. */
export const favoriteKey = (kind: FoodSourceKind, id: string): string => `${kind}:${id}`;

const resultKey = (r: FoodSearchResult): string => favoriteKey(r.kind, r.id);

/** A catalogue row, local or freshly fetched, as a result. */
export const catalogueResult = (food: CachedFood, offline: boolean): FoodSearchResult => ({
  kind: 'food',
  id: food.id,
  title: food.name,
  subtitle: food.brand ?? null,
  offline,
});

const customResult = (food: CustomFood): FoodSearchResult => ({
  kind: 'custom_food',
  id: food.id,
  title: food.name,
  subtitle: food.brand ?? null,
  offline: true,
});

const recipeResult = (recipe: Recipe): FoodSearchResult => ({
  kind: 'recipe',
  id: recipe.id,
  title: recipe.name,
  subtitle: `${recipe.servings} serving${recipe.servings === 1 ? '' : 's'}`,
  offline: true,
});

/**
 * Case-insensitive substring, the reference's `contains(query, ignoreCase)`.
 *
 * Substring rather than prefix because a brand often leads the name ("Woolworths
 * rolled oats"), and a prefix match would hide it from an athlete typing "oats".
 */
const matches = (haystack: string | null | undefined, needle: string): boolean =>
  (haystack ?? '').toLowerCase().includes(needle);

/**
 * Everything on THIS DEVICE that matches `query`.
 *
 * Cached catalogue foods are included: they are the reason a search still
 * returns real food with no connection. A cache row is not evidence the
 * catalogue is reachable, so results carry `offline: true` either way — see
 * `foodSearch` for how the two sources are combined.
 */
export function searchLocal(db: NutritionDB, query: string): FoodSearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return [
    ...db.foodCache.filter((f) => matches(f.name, q) || matches(f.brand, q)).map((f) => catalogueResult(f, true)),
    ...liveCustomFoods(db)
      .filter((f) => matches(f.name, q) || matches(f.brand, q))
      .map(customResult),
    ...liveRecipes(db)
      .filter((r) => matches(r.name, q))
      .map(recipeResult),
  ];
}

/**
 * The single result list: what the catalogue returned, then what is on the
 * device, deduplicated by identity.
 *
 * Remote rows lead because they are the fresher copy of the same food, and a
 * cached duplicate of a row already in the list would otherwise appear twice
 * under one name. `remote` being empty is not distinguishable here from the
 * catalogue being down — that distinction is the caller's `offline` flag, so
 * that a genuine "no catalogue match" is never dressed up as a network failure.
 */
export function foodSearch(
  db: NutritionDB,
  query: string,
  remote: readonly CachedFood[],
): FoodSearchResult[] {
  const out: FoodSearchResult[] = [];
  const seen = new Set<string>();
  const cached = cachedIds(db);
  for (const r of [...remote.map((f) => catalogueResult(f, cached.has(f.id))), ...searchLocal(db, query)]) {
    const key = resultKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

const cachedIds = (db: NutritionDB): Set<string> => new Set(db.foodCache.map((f) => f.id));

export const liveCustomFoods = (db: NutritionDB): CustomFood[] => db.customFoods.filter((f) => f.deletedAt == null);

export const liveRecipes = (db: NutritionDB): Recipe[] => db.recipes.filter((r) => r.deletedAt == null);

/**
 * The starred foods, custom foods and recipes, as results.
 *
 * A favourite whose source record is gone is DROPPED rather than shown as a
 * dead row — the reference does the same, and for the same reason: one deleted
 * custom food must not break the whole screen. A star pointing at an
 * un-cached catalogue food is likewise dropped, because tapping it offline
 * could not produce macros to log.
 */
export function favoriteResults(db: NutritionDB): FoodSearchResult[] {
  const foods = new Map(db.foodCache.map((f) => [f.id, f]));
  const customs = new Map(liveCustomFoods(db).map((f) => [f.id, f]));
  const recipes = new Map(liveRecipes(db).map((r) => [r.id, r]));
  return db.favorites
    .filter((f) => f.deletedAt == null)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || (a.createdAt < b.createdAt ? -1 : 1))
    .map((fav): FoodSearchResult | null => {
      if (fav.foodId) {
        const food = foods.get(fav.foodId);
        return food ? catalogueResult(food, true) : null;
      }
      if (fav.customFoodId) {
        const food = customs.get(fav.customFoodId);
        return food ? customResult(food) : null;
      }
      if (fav.recipeId) {
        const recipe = recipes.get(fav.recipeId);
        return recipe ? recipeResult(recipe) : null;
      }
      return null;
    })
    .filter((r): r is FoodSearchResult => r !== null);
}

/** The set of `favoriteKey`s currently starred, for the star toggle's state. */
export const favoriteKeys = (db: NutritionDB): Set<string> =>
  new Set(
    db.favorites
      .filter((f) => f.deletedAt == null)
      .map((f) =>
        f.foodId
          ? favoriteKey('food', f.foodId)
          : f.customFoodId
            ? favoriteKey('custom_food', f.customFoodId)
            : f.recipeId
              ? favoriteKey('recipe', f.recipeId)
              : '',
      )
      .filter((k) => k !== ''),
  );

/**
 * The most recently logged distinct sources, newest first.
 *
 * Ported from `dedupeRecentReferences` and `SupabaseRecentFoodRepository`:
 * quick adds are excluded (there is no source to log again), deleted entries
 * are excluded, and only the first occurrence of each source identity is kept.
 *
 * Derived from the log rather than stored, so it needs no sync of its own and
 * cannot disagree with the log it describes. A source that has since been
 * deleted or was never cached is dropped, for `favoriteResults`' reason.
 */
export function recentResults(db: NutritionDB, limit = 10): FoodSearchResult[] {
  const foods = new Map(db.foodCache.map((f) => [f.id, f]));
  const customs = new Map(liveCustomFoods(db).map((f) => [f.id, f]));
  const recipes = new Map(liveRecipes(db).map((r) => [r.id, r]));
  const newestFirst = db.logEntries
    .filter((e: FoodLogEntry) => isLive(e) && e.entryKind !== 'quick_add')
    .slice()
    .sort((a, b) => (a.createdAt > b.createdAt ? -1 : a.createdAt < b.createdAt ? 1 : a.id < b.id ? -1 : 1));
  const out: FoodSearchResult[] = [];
  const seen = new Set<string>();
  for (const entry of newestFirst) {
    if (out.length >= limit) break;
    const result = entry.foodId
      ? (foods.get(entry.foodId) && catalogueResult(foods.get(entry.foodId)!, true)) || null
      : entry.customFoodId
        ? (customs.get(entry.customFoodId) && customResult(customs.get(entry.customFoodId)!)) || null
        : entry.recipeId
          ? (recipes.get(entry.recipeId) && recipeResult(recipes.get(entry.recipeId)!)) || null
          : null;
    if (!result) continue;
    const key = resultKey(result);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(result);
  }
  return out;
}
