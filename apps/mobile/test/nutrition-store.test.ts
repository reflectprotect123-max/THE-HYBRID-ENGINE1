import { LS_KEY, cloudFp, emptyDB, ensureSharedCore, loadDB, saveDB, type Storage } from '@hybrid/engine';
import { emptyNutritionDB, type FoodLogEntry, type NutritionDB } from '@hybrid/nutrition-core';
import { NUTRITION_LS_KEY, loadNutrition, saveNutrition } from '../src/store/nutrition';

/*
 * The nutrition slice next to the engine slice, sharing a storage port and
 * nothing else. Mirrors apps/web/test/nutrition-store.test.ts — the two apps
 * share these rules, so a rule proved on one and not the other is a rule that
 * can quietly stop holding on the phone.
 */

const memory = (): Storage => {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
};

const meal = (id: string): FoodLogEntry => ({
  id,
  userId: 'u1',
  logDate: '2026-08-07',
  meal: 'breakfast',
  entryKind: 'food',
  foodId: null,
  customFoodId: null,
  recipeId: null,
  quantity: 1,
  unit: 'serving',
  calories: 400,
  proteinG: 30,
  carbsG: 40,
  fatG: 10,
  displayName: 'Oats',
  nutrients: {},
  notes: null,
  sourceSnapshot: {},
  createdAt: '2026-08-07T07:00:00.000Z',
  updatedAt: '2026-08-07T07:00:00.000Z',
  deletedAt: null,
});

const withMeal = (id: string): NutritionDB => ({ ...emptyNutritionDB(), logEntries: [meal(id)] });

/* Stamped before it is stored: `loadDB` mints a shared core when the blob has
   none, so an un-stamped fixture would change its own fingerprint on every
   read and the isolation assertions below would be measuring the clock. */
const seeded = () => ensureSharedCore(emptyDB(), 1_754_000_000_000);

describe('nutrition storage slice', () => {
  it('survives a reload', () => {
    const store = memory();
    expect(saveNutrition(store, withMeal('m-1'))).toBe(true);
    expect(loadNutrition(store)).toEqual({ nutrition: withMeal('m-1'), recovered: false });
  });

  it('falls back to an empty slice rather than throwing on a corrupt blob', () => {
    const store = memory();
    store.setItem(NUTRITION_LS_KEY, '{not json');
    const { nutrition, recovered } = loadNutrition(store);
    expect(recovered).toBe(true);
    expect(nutrition).toEqual(emptyNutritionDB());
  });

  it('uses a key of its own, so neither slice can read or clobber the other', () => {
    const store = memory();
    saveDB(store, seeded(), LS_KEY);
    saveNutrition(store, withMeal('m-1'), NUTRITION_LS_KEY);
    expect(NUTRITION_LS_KEY).not.toBe(LS_KEY);
    expect(loadDB(store, LS_KEY).db.workouts).toEqual([]);
    expect(loadNutrition(store, NUTRITION_LS_KEY).nutrition.logEntries).toHaveLength(1);
  });

  /*
   * THE isolation this slice exists to guarantee. A nutrition write must not
   * dirty the training fingerprint (or every meal would push the whole training
   * blob), and a training write must not dirty the nutrition slice (or a logged
   * set would push the food log).
   */
  it('a nutrition-only change leaves the EngineDB fingerprint untouched', () => {
    const store = memory();
    saveDB(store, seeded(), LS_KEY);
    saveNutrition(store, emptyNutritionDB(), NUTRITION_LS_KEY);
    const before = cloudFp(loadDB(store, LS_KEY).db);

    saveNutrition(store, withMeal('m-1'), NUTRITION_LS_KEY);

    expect(cloudFp(loadDB(store, LS_KEY).db)).toBe(before);
  });

  it('a training-only change leaves the nutrition slice untouched', () => {
    const store = memory();
    saveDB(store, seeded(), LS_KEY);
    saveNutrition(store, withMeal('m-1'), NUTRITION_LS_KEY);

    const db = loadDB(store, LS_KEY).db;
    db.workouts = [{ id: 'w-1', name: 'Squat day', blocks: [] }];
    saveDB(store, db, LS_KEY);

    expect(loadNutrition(store, NUTRITION_LS_KEY).nutrition).toEqual(withMeal('m-1'));
  });
});
