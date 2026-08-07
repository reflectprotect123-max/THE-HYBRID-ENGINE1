import { describe, expect, it } from 'vitest';
import { emptyNutritionDB, sanitizeNutritionDB, NUTRITION_SCHEMA_VERSION } from '../src';

/*
 * sanitizeNutritionDB is the trust boundary for every blob that arrives from
 * disk, a backup import or the network. The contract these tests hold it to is
 * the one @hybrid/engine's sanitizeDB has: it never throws, and whatever it
 * returns is a fully-shaped NutritionDB.
 */

const GARBAGE: unknown[] = [
  undefined,
  null,
  0,
  '',
  'a photo of a cat',
  NaN,
  true,
  [],
  [1, 2, 3],
  {},
  { logEntries: 'nope', weightEntries: 7, program: [], checkIns: null, dayStatus: {}, settings: [] },
  { logEntries: [null, 1, 'x', [], {}] },
  JSON.parse('{"settings":{"__proto__":{"polluted":true}}}'),
];

describe('sanitizeNutritionDB', () => {
  it('returns a fully-shaped DB for any input, without throwing', () => {
    for (const input of GARBAGE) {
      const db = sanitizeNutritionDB(input);
      expect(Array.isArray(db.logEntries)).toBe(true);
      expect(Array.isArray(db.weightEntries)).toBe(true);
      expect(Array.isArray(db.checkIns)).toBe(true);
      expect(Array.isArray(db.dayStatus)).toBe(true);
      expect(db.program === null || typeof db.program === 'object').toBe(true);
      expect(typeof db.settings).toBe('object');
      expect(Number.isFinite(db.schemaVersion)).toBe(true);
    }
  });

  it('sanitizes its own empty DB to an equal DB (the boundary is idempotent)', () => {
    expect(sanitizeNutritionDB(emptyNutritionDB())).toEqual(emptyNutritionDB());
    expect(NUTRITION_SCHEMA_VERSION).toBe(1);
  });

  it('drops records that cannot be addressed or trusted, keeps the rest', () => {
    const db = sanitizeNutritionDB({
      logEntries: [
        { id: '', entryKind: 'food' }, // no id -> unaddressable
        { id: 'e1', entryKind: 'invented_kind' }, // outside the DB check constraint
        { id: 'e2', entryKind: 'quick_add', calories: 300 },
      ],
      weightEntries: [
        { id: 'w1', weightKg: 'heavy' }, // a weigh-in with no weight is not a weigh-in
        { id: 'w2', weightKg: 82.4 },
      ],
      dayStatus: [
        { userId: 'u', logDate: '2026-08-01', status: 'wat' }, // never invent 'unlogged'
        { userId: 'u', logDate: '2026-08-02', status: 'fasted' },
      ],
      checkIns: [
        { id: 'c1', status: 'unknown' },
        { id: 'c2', status: 'pending', explanation: 'holding' },
      ],
    });
    expect(db.logEntries.map((e) => e.id)).toEqual(['e2']);
    expect(db.weightEntries.map((e) => e.id)).toEqual(['w2']);
    expect(db.dayStatus.map((d) => d.logDate)).toEqual(['2026-08-02']);
    expect(db.checkIns.map((c) => c.id)).toEqual(['c2']);
  });

  it('clamps numbers to the ranges the database itself enforces', () => {
    const db = sanitizeNutritionDB({
      logEntries: [
        {
          id: 'e1',
          entryKind: 'food',
          quantity: -3,
          calories: -100,
          proteinG: Number.POSITIVE_INFINITY,
          carbsG: 'x',
          fatG: null,
        },
      ],
      weightEntries: [
        { id: 'w1', weightKg: 9000 },
        { id: 'w2', weightKg: 1 },
      ],
    });
    expect(db.logEntries[0]!.quantity).toBe(1); // the column default, not 0
    expect(db.logEntries[0]!.calories).toBe(0);
    expect(db.logEntries[0]!.proteinG).toBe(0);
    expect(db.logEntries[0]!.carbsG).toBe(0);
    expect(db.logEntries[0]!.fatG).toBe(0);
    expect(db.weightEntries[0]!.weightKg).toBe(500);
    expect(db.weightEntries[1]!.weightKg).toBe(20);
  });

  it('never lets a hostile __proto__ key out of an open-shaped field', () => {
    const db = sanitizeNutritionDB(
      JSON.parse(
        '{"settings":{"__proto__":{"polluted":true},"timezone":"Australia/Sydney"},' +
          '"logEntries":[{"id":"e1","entryKind":"food","sourceSnapshot":{"__proto__":{"x":1},"foodId":"f1"}}]}',
      ),
    );
    expect(Object.keys(db.settings)).toEqual(['timezone']);
    expect(Object.keys(db.logEntries[0]!.sourceSnapshot)).toEqual(['foodId']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('keeps nutrients numeric so nothing downstream multiplies a NaN', () => {
    const db = sanitizeNutritionDB({
      logEntries: [
        { id: 'e1', entryKind: 'food', nutrients: { sodium_mg: 410, fibre_g: '3', iron_mg: null } },
      ],
    });
    expect(db.logEntries[0]!.nutrients).toEqual({ sodium_mg: 410 });
  });

  it('preserves unknown settings keys so an older build cannot strip a newer one', () => {
    const db = sanitizeNutritionDB({ settings: { someFutureFlag: 'on' } });
    expect(db.settings.someFutureFlag).toBe('on');
  });

  it('drops a program whose DB-constrained enums are unreadable', () => {
    expect(sanitizeNutritionDB({ program: { id: 'p1', mode: 'vibes', goal: 'lose', status: 'active' } }).program).toBe(
      null,
    );
    const ok = sanitizeNutritionDB({
      program: {
        id: 'p1',
        mode: 'coached',
        goal: 'lose',
        status: 'active',
        days: [{ targetDate: '2026-08-01', calories: 2400 }, { calories: 2400 }],
      },
    });
    expect(ok.program?.days.map((d) => d.targetDate)).toEqual(['2026-08-01']);
    expect(ok.program?.days[0]!.programId).toBe('p1');
  });
});
