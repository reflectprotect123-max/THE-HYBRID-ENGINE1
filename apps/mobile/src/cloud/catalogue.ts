import type { SupabaseClient } from '@supabase/supabase-js';
import type { CachedFood, FoodServing } from '@hybrid/nutrition-core';
import { supabaseClient } from './sync';

/*
 * Reading the SHARED FOOD CATALOGUE.
 *
 * `public.foods` and `public.food_servings` are Postgres tables read over the
 * network by every athlete and written by nobody through the API (see the
 * ownership boundary in 20260807_macrotrack_food_catalogue.sql). They are
 * deliberately NOT part of the synced blob — a 5,000-row catalogue in a JSON
 * document is the thing the rebuild scope refused.
 *
 * So this module is the app's one networked read, and the ONLY one that can
 * fail for a reason the athlete cannot fix. Everything it returns is shaped as
 * `CachedFood`, because a food that gets logged is copied into
 * `NutritionDB.foodCache` and must be the same record either way.
 *
 * Ported from MacroTrack's `data/FoodRepository.kt` (`search`, `getServings`)
 * and `domain/SearchPatterns.kt`.
 */

/** How many catalogue rows a search asks for. The reference's default. */
const SEARCH_LIMIT = 20;

/**
 * An `ilike` pattern that cannot be turned into a wildcard by the query.
 *
 * A raw `%` or `_` typed by the athlete is a PATTERN character to Postgres, so
 * searching for "100_g" would match far more than it should; the backslash is
 * escaped first, or escaping the other two would corrupt it.
 */
export function ilikePattern(rawQuery: string): string {
  const escaped = rawQuery.trim().toLowerCase().replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  return `%${escaped}%`;
}

/**
 * The pattern as a value inside an `or=(...)` filter.
 *
 * PostgREST parses that filter as a COMMA-SEPARATED list, so an unquoted
 * pattern containing a comma or a bracket — "chicken, roast", "oats (rolled)" —
 * is read as extra filter terms and the request fails or, worse, filters on
 * something the athlete did not ask for. Quoting closes it, with `\` and `"`
 * escaped because the quoted form is what gives them meaning.
 *
 * This is OUR hazard, not one inherited from the reference: its Kotlin
 * `SupabaseFoodRepository.search` uses the SDK's typed `or { ilike(...) }`
 * builder, which composes the filter itself. supabase-js takes `.or()` as a
 * raw string we assemble, so the escaping the SDK did for them is ours to do.
 */
const orValue = (pattern: string): string => `"${pattern.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

type FoodRow = {
  id: string;
  name: string;
  brand: string | null;
  barcode: string | null;
  serving_qty: number;
  serving_unit: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  source: string;
  external_id: string | null;
  nutrition_basis_qty: number;
  nutrition_basis_unit: string;
  serving_size_text: string | null;
  nutrients: Record<string, number> | null;
};

type ServingRow = {
  id: string;
  food_id: string;
  label: string;
  quantity: number;
  unit: string;
  grams: number | null;
  millilitres: number | null;
  is_default: boolean;
  sort_order: number;
};

const FOOD_COLUMNS =
  'id,name,brand,barcode,serving_qty,serving_unit,calories,protein_g,carbs_g,fat_g,source,external_id,nutrition_basis_qty,nutrition_basis_unit,serving_size_text,nutrients';

const toServing = (row: ServingRow): FoodServing => ({
  id: row.id,
  foodId: row.food_id,
  label: row.label,
  quantity: row.quantity,
  unit: row.unit,
  grams: row.grams,
  millilitres: row.millilitres,
  isDefault: row.is_default,
  sortOrder: row.sort_order,
});

const toFood = (row: FoodRow, servings: FoodServing[], cachedAt: string): CachedFood => ({
  id: row.id,
  name: row.name,
  brand: row.brand,
  barcode: row.barcode,
  servingQty: row.serving_qty,
  servingUnit: row.serving_unit,
  calories: row.calories,
  proteinG: row.protein_g,
  carbsG: row.carbs_g,
  fatG: row.fat_g,
  source: row.source,
  externalId: row.external_id,
  nutritionBasisQty: row.nutrition_basis_qty,
  nutritionBasisUnit: row.nutrition_basis_unit,
  servingSizeText: row.serving_size_text,
  nutrients: row.nutrients ?? {},
  servings,
  cachedAt,
});

/** What a screen needs from the catalogue. Injectable, so a test needs no network. */
export type CatalogueSearch = (query: string) => Promise<CachedFood[]>;

/**
 * Name/brand search against the shared catalogue, with each row's servings.
 *
 * The servings come down in the SAME round trip pair rather than on demand,
 * because they are what lets a food be logged in a unit other than its own —
 * fetching them later would mean a food that is loggable online and not
 * offline, which is the exact split this app is trying not to have.
 *
 * THROWS when the catalogue cannot be reached. That is the contract the Food
 * search screen degrades on; swallowing it and returning `[]` would tell the
 * athlete their food does not exist.
 */
export async function searchCatalogue(query: string, client = supabaseClient): Promise<CachedFood[]> {
  const clean = query.trim();
  if (!clean) return [];
  if (!client) throw new Error('No connection to the food catalogue.');
  const pattern = ilikePattern(clean);
  const { data, error } = await client
    .from('foods')
    .select(FOOD_COLUMNS)
    .or(`name.ilike.${orValue(pattern)},brand.ilike.${orValue(pattern)}`)
    .order('name', { ascending: true })
    .limit(SEARCH_LIMIT);
  if (error) throw error;
  const rows = (data || []) as FoodRow[];
  if (!rows.length) return [];
  const servings = await fetchServings(client, rows.map((r) => r.id));
  const at = new Date().toISOString();
  return rows.map((row) => toFood(row, servings.get(row.id) ?? [], at));
}

async function fetchServings(client: SupabaseClient, foodIds: string[]): Promise<Map<string, FoodServing[]>> {
  const { data, error } = await client
    .from('food_servings')
    .select('id,food_id,label,quantity,unit,grams,millilitres,is_default,sort_order')
    .in('food_id', foodIds)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  const out = new Map<string, FoodServing[]>();
  for (const row of (data || []) as ServingRow[]) {
    const list = out.get(row.food_id);
    if (list) list.push(toServing(row));
    else out.set(row.food_id, [toServing(row)]);
  }
  return out;
}
