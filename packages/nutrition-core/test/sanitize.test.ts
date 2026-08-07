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
        { id: '', entryKind: 'food', logDate: '2026-08-01' }, // no id -> unaddressable
        { id: 'e1', entryKind: 'invented_kind', logDate: '2026-08-01' }, // outside the DB check constraint
        { id: 'e3', entryKind: 'food' }, // log_date is NOT NULL -> could never be written back
        { id: 'e2', entryKind: 'quick_add', logDate: '2026-08-01', calories: 300 },
      ],
      weightEntries: [
        { id: 'w1', weightKg: 'heavy', measuredAt: '2026-08-01T06:00:00.000Z' }, // a weigh-in with no weight is not a weigh-in
        { id: 'w3', weightKg: 82.4 }, // ...and one with no measured_at has no place on the trend
        { id: 'w2', weightKg: 82.4, measuredAt: '2026-08-01T06:00:00.000Z' },
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
          logDate: '2026-08-01',
          quantity: -3,
          calories: -100,
          proteinG: Number.POSITIVE_INFINITY,
          carbsG: 'x',
          fatG: null,
        },
      ],
    });
    expect(db.logEntries[0]!.quantity).toBe(1); // the column default, not 0
    expect(db.logEntries[0]!.calories).toBe(0);
    expect(db.logEntries[0]!.proteinG).toBe(0);
    expect(db.logEntries[0]!.carbsG).toBe(0);
    expect(db.logEntries[0]!.fatG).toBe(0);
  });

  it('drops an out-of-range weigh-in rather than clamping it to the bound', () => {
    // `check (weight_kg between 20 and 500)` rejects the row. Clamping would
    // manufacture a 500 kg weigh-in the athlete never recorded and hand it to
    // the trend regression as real data.
    const db = sanitizeNutritionDB({
      weightEntries: [
        { id: 'w1', weightKg: 9000, measuredAt: '2026-08-01T06:00:00.000Z' },
        { id: 'w2', weightKg: 1, measuredAt: '2026-08-01T06:00:00.000Z' },
        { id: 'w3', weightKg: 20, measuredAt: '2026-08-01T06:00:00.000Z' },
        { id: 'w4', weightKg: 500, measuredAt: '2026-08-01T06:00:00.000Z' },
      ],
    });
    expect(db.weightEntries.map((e) => e.id)).toEqual(['w3', 'w4']); // the bounds are inclusive
    expect(db.weightEntries.map((e) => e.weightKg)).toEqual([20, 500]);
  });

  it('drops a weigh-in whose measuredAt would have to be fabricated', () => {
    // measuredAt is the x-axis of every trend fit. An epoch fallback plants a
    // real weight in 1970 and drags the regression through 56 years of nothing.
    const db = sanitizeNutritionDB({
      weightEntries: [
        { id: 'w1', weightKg: 82.4 },
        { id: 'w2', weightKg: 82.4, measuredAt: '' },
        { id: 'w3', weightKg: 82.4, measuredAt: 'this morning' },
        { id: 'w4', weightKg: 82.4, measuredAt: '2026-08-01T06:00:00.000Z' },
      ],
    });
    expect(db.weightEntries.map((e) => e.id)).toEqual(['w4']);
    // createdAt/updatedAt ARE merge metadata, and losing every conflict is the
    // right outcome for a record whose own write time is unknown.
    expect(db.weightEntries[0]!.createdAt).toBe('1970-01-01T00:00:00.000Z');
    expect(db.weightEntries[0]!.updatedAt).toBe('1970-01-01T00:00:00.000Z');
  });

  it('never stamps a repaired record with the wall clock', () => {
    // A wall-clock fallback would make a locally repaired copy outrank the
    // server's good copy on the very next merge, and churn the sync
    // fingerprint on every boot.
    const before = Date.now();
    const db = sanitizeNutritionDB({
      logEntries: [{ id: 'e1', entryKind: 'food', logDate: '2026-08-01' }],
      checkIns: [{ id: 'c1', status: 'pending' }],
      dayStatus: [{ userId: 'u1', logDate: '2026-08-01', status: 'complete' }],
      program: { id: 'p1', mode: 'coached', goal: 'lose', status: 'active' },
    });
    for (const t of [
      db.logEntries[0]!.createdAt,
      db.logEntries[0]!.updatedAt,
      db.checkIns[0]!.createdAt,
      db.checkIns[0]!.updatedAt,
      db.dayStatus[0]!.updatedAt,
      db.program!.createdAt,
      db.program!.updatedAt,
    ]) {
      expect(t).toBe('1970-01-01T00:00:00.000Z');
      expect(Date.parse(t)).toBeLessThan(before);
    }
  });

  it('keeps an empty id-or-timestamp field absent rather than blank', () => {
    // `''` is neither absent nor a uuid/instant: `if (e.deletedAt)` reads the
    // entry live while `e.deletedAt != null` reads it deleted.
    const db = sanitizeNutritionDB({
      logEntries: [
        {
          id: 'e1',
          entryKind: 'quick_add',
          logDate: '2026-08-01',
          foodId: '',
          customFoodId: '',
          recipeId: '',
          deletedAt: '',
        },
      ],
      checkIns: [{ id: 'c1', status: 'pending', programId: '', resolvedAt: '' }],
      program: { id: 'p1', mode: 'coached', goal: 'lose', status: 'active', endDate: '' },
    });
    const e = db.logEntries[0]!;
    expect([e.foodId, e.customFoodId, e.recipeId, e.deletedAt]).toEqual([null, null, null, null]);
    expect(db.checkIns[0]!.programId).toBe(null);
    expect(db.checkIns[0]!.resolvedAt).toBe(null);
    expect(db.program!.endDate).toBe(null);
  });

  it('leaves targetRateKgPerWeek unbounded — the table constrains its sign, not its size', () => {
    const fast = sanitizeNutritionDB({
      program: {
        id: 'p1',
        mode: 'coached',
        goal: 'gain',
        status: 'active',
        targetRateKgPerWeek: 7.5,
      },
    });
    expect(fast.program!.targetRateKgPerWeek).toBe(7.5);
    const nonsense = sanitizeNutritionDB({
      program: {
        id: 'p1',
        mode: 'coached',
        goal: 'lose',
        status: 'active',
        targetRateKgPerWeek: 'fast',
      },
    });
    expect(nonsense.program!.targetRateKgPerWeek).toBe(0); // the column default
  });

  it('never lets a hostile __proto__ key out of an open-shaped field', () => {
    const db = sanitizeNutritionDB(
      JSON.parse(
        '{"settings":{"__proto__":{"polluted":true},"timezone":"Australia/Sydney"},' +
          '"logEntries":[{"id":"e1","entryKind":"food","logDate":"2026-08-01",' +
          '"sourceSnapshot":{"__proto__":{"x":1},"foodId":"f1"}}]}',
      ),
    );
    expect(Object.keys(db.settings)).toEqual(['timezone']);
    expect(Object.keys(db.logEntries[0]!.sourceSnapshot)).toEqual(['foodId']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('scrubs __proto__ at every depth, not just the top level', () => {
    // sourceSnapshot is an opaque nested blob preserved byte-for-byte, so a
    // payload only has to be one level down to reach a consumer that spreads it.
    const db = sanitizeNutritionDB(
      JSON.parse(
        '{"settings":{"sync":{"remote":{"__proto__":{"deeplyPolluted":true},"host":"x"}}},' +
          '"logEntries":[{"id":"e1","entryKind":"food","logDate":"2026-08-01",' +
          '"sourceSnapshot":{"scaling":[{"__proto__":{"arrayPolluted":true},"factor":1.5}]}}]}',
      ),
    );
    const remote = (db.settings.sync as Record<string, Record<string, unknown>>).remote;
    expect(Object.keys(remote)).toEqual(['host']);
    const scaling = (db.logEntries[0]!.sourceSnapshot as { scaling: Record<string, unknown>[] })
      .scaling;
    expect(Object.keys(scaling[0]!)).toEqual(['factor']);
    expect(({} as Record<string, unknown>).deeplyPolluted).toBeUndefined();
    expect(({} as Record<string, unknown>).arrayPolluted).toBeUndefined();
  });

  it('keeps a legitimate key named constructor or prototype', () => {
    // Only `__proto__` re-homes a prototype. Dropping the other two deletes a
    // real athlete-authored key to close a hole that is not there.
    const db = sanitizeNutritionDB({
      settings: { constructor: 'manual', prototype: 'v2' },
      logEntries: [
        {
          id: 'e1',
          entryKind: 'food',
          logDate: '2026-08-01',
          sourceSnapshot: { constructor: 'importer', prototype: 'usda' },
        },
      ],
    });
    expect(Object.keys(db.settings).sort()).toEqual(['constructor', 'prototype']);
    expect(db.settings['constructor']).toBe('manual');
    expect(db.settings['prototype']).toBe('v2');
    const snapshot = db.logEntries[0]!.sourceSnapshot;
    expect(Object.keys(snapshot).sort()).toEqual(['constructor', 'prototype']);
    expect(snapshot['constructor']).toBe('importer');
  });

  it('keeps nutrients numeric so nothing downstream multiplies a NaN', () => {
    const db = sanitizeNutritionDB({
      logEntries: [
        {
          id: 'e1',
          entryKind: 'food',
          logDate: '2026-08-01',
          nutrients: { sodium_mg: 410, fibre_g: '3', iron_mg: null },
        },
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
