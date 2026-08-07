import { describe, expect, it } from 'vitest';
import { LS_KEY, cloudFp, emptyDB, ensureSharedCore, loadDB, saveDB, type Storage } from '@hybrid/engine';
import { emptyNutritionDB, quickAddEntry, sanitizeNutritionDB } from '@hybrid/nutrition-core';
import { NUTRITION_LS_KEY, loadNutrition, saveNutrition } from '../src/store/nutrition';
import { blankDraft, draftOf, entryFromDraft, draftFields, parseLocalDay, shiftDay } from '../src/screens/nutrition/entry';

/*
 * The web food log's write path.
 *
 * Web and mobile write the SAME athlete's slice, so the only thing worth
 * pinning hard is that they write the same record. Everything below is either
 * that equality, or one of the rules the phone app's Daily Log already keeps
 * and this screen had to keep identically.
 */

const ymd = (d: Date): string => {
  const p = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
};

const filled = () => ({
  ...blankDraft('lunch'),
  displayName: '  Chicken and rice  ',
  calories: '620',
  proteinG: '48',
  carbsG: '70',
  fatG: '12',
});

const CTX = { id: 'entry-1', logDate: '2026-08-07', at: '2026-08-07T12:30:00.000Z' };

describe('web food log writes through the shared nutrition-core writer', () => {
  /*
   * THE test this file exists for. `quickAddEntry` is the single snapshot
   * builder both apps call; if web ever grows its own object literal, the
   * `sourceSnapshot` keys, the null provenance ids or the empty `nutrients` map
   * drift and the merge starts reconciling two record shapes.
   */
  it('produces exactly what quickAddEntry produces for the same inputs', () => {
    const expected = quickAddEntry(
      { id: CTX.id, logDate: CTX.logDate, meal: 'lunch', at: CTX.at },
      { displayName: 'Chicken and rice', calories: 620, proteinG: 48, carbsG: 70, fatG: 12 },
    );
    expect(entryFromDraft(filled(), CTX)).toEqual(expected);
  });

  it('writes a quick_add with no provenance and no fabricated micronutrients', () => {
    const entry = entryFromDraft(filled(), CTX)!;
    expect(entry.entryKind).toBe('quick_add');
    expect([entry.foodId, entry.customFoodId, entry.recipeId]).toEqual([null, null, null]);
    // Empty, not fabricated: a typed-in entry HAS no micronutrient profile.
    expect(entry.nutrients).toEqual({});
    // Ownership belongs to the sync layer and RLS, never to a client guess.
    expect(entry.userId).toBe('');
  });

  it('survives the sanitizer unchanged, so nothing it writes is later clamped away', () => {
    const entry = entryFromDraft(filled(), CTX)!;
    const stored = sanitizeNutritionDB({ ...emptyNutritionDB(), logEntries: [entry] });
    expect(stored.logEntries).toEqual([entry]);
  });

  it('refuses a nameless entry rather than storing an unreadable row', () => {
    expect(entryFromDraft({ ...filled(), displayName: '   ' }, CTX)).toBeNull();
    expect(draftFields({ ...filled(), displayName: '' })).toBeNull();
  });

  it('parses a junk or negative macro to 0 rather than to NaN', () => {
    const entry = entryFromDraft({ ...filled(), calories: 'abc', proteinG: '-30' }, CTX)!;
    expect(entry.calories).toBe(0);
    expect(entry.proteinG).toBe(0);
  });

  it('round-trips an entry through the edit draft without changing a number', () => {
    const entry = entryFromDraft(filled(), CTX)!;
    const back = draftOf(entry);
    expect(back.id).toBe(entry.id);
    expect(draftFields(back)).toEqual({
      displayName: 'Chicken and rice',
      calories: 620,
      proteinG: 48,
      carbsG: 70,
      fatG: 12,
    });
  });
});

describe('day navigation stays on the local calendar', () => {
  it('reads a bare ISO date as a LOCAL day, not as UTC midnight', () => {
    // `new Date('2026-08-07')` is UTC midnight, which is 6 August for every
    // athlete west of Greenwich — a whole day of food filed one day early.
    expect(ymd(parseLocalDay('2026-08-07'))).toBe('2026-08-07');
  });

  it('steps whole days in both directions', () => {
    expect(shiftDay('2026-08-07', -1, ymd)).toBe('2026-08-06');
    expect(shiftDay('2026-08-01', -1, ymd)).toBe('2026-07-31');
    expect(shiftDay('2026-08-07', 1, ymd)).toBe('2026-08-08');
  });
});

/*
 * THE ARCHITECTURAL RULE, restated for the new surface: logging food from the
 * WEB must not dirty the training fingerprint. `apps/web/test/nutrition-store`
 * proves it for the slice; this proves it for the entry this screen actually
 * writes, which is the thing that changed in Phase 4.
 */
describe('a web food log write cannot touch the training slice', () => {
  const memory = (): Storage => {
    const m = new Map<string, string>();
    return {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => void m.set(k, v),
      removeItem: (k) => void m.delete(k),
    };
  };

  it('leaves the EngineDB fingerprint untouched', () => {
    const store = memory();
    saveDB(store, ensureSharedCore(emptyDB(), 1_754_000_000_000), LS_KEY);
    saveNutrition(store, emptyNutritionDB(), NUTRITION_LS_KEY);
    const before = cloudFp(loadDB(store, LS_KEY).db);

    const entry = entryFromDraft(filled(), CTX)!;
    const next = loadNutrition(store, NUTRITION_LS_KEY).nutrition;
    next.logEntries.push(entry);
    saveNutrition(store, next, NUTRITION_LS_KEY);

    expect(loadNutrition(store, NUTRITION_LS_KEY).nutrition.logEntries).toHaveLength(1);
    expect(cloudFp(loadDB(store, LS_KEY).db)).toBe(before);
  });
});
