import { describe, expect, it } from 'vitest';
import { emptyNutritionDB, mergeNutrition, sanitizeNutritionDB } from '../src';
import type { CheckIn, DayStatus, FoodLogEntry, NutritionDB, WeightEntry } from '../src';

/*
 * The merge these tests guard is the one this repository has already lost user
 * data to twice: a resolution that takes one side whole drops every record the
 * other side alone holds. Additivity is asserted in BOTH argument orders on
 * purpose — a merge that only survives the order the caller happens to use is
 * the same bug waiting for the other device to sync first.
 */

function entry(id: string, over: Partial<FoodLogEntry> = {}): FoodLogEntry {
  return {
    id,
    userId: 'u1',
    logDate: '2026-08-07',
    meal: 'breakfast',
    entryKind: 'food',
    foodId: `food-${id}`,
    quantity: 1.5,
    unit: 'serving',
    calories: 412.5,
    proteinG: 30.25,
    carbsG: 41,
    fatG: 12.75,
    displayName: 'Rolled oats, dry',
    nutrients: { sodium_mg: 4, fibre_g: 9.7 },
    sourceSnapshot: { foodId: `food-${id}`, basisQty: 100, basisUnit: 'g' },
    createdAt: '2026-08-07T06:00:00.000Z',
    updatedAt: '2026-08-07T06:00:00.000Z',
    ...over,
  };
}

function weight(id: string, over: Partial<WeightEntry> = {}): WeightEntry {
  return {
    id,
    userId: 'u1',
    measuredAt: '2026-08-07T05:30:00.000Z',
    weightKg: 81.2,
    source: 'manual',
    createdAt: '2026-08-07T05:30:00.000Z',
    updatedAt: '2026-08-07T05:30:00.000Z',
    ...over,
  };
}

function checkIn(id: string, over: Partial<CheckIn> = {}): CheckIn {
  return {
    id,
    userId: 'u1',
    programId: 'p1',
    weekStart: '2026-08-03',
    weekEnd: '2026-08-09',
    status: 'pending',
    proposedCalories: 2450,
    modules: [{ key: 'calories', action: 'raise' }],
    explanation: 'Trend flat on 2,300 kcal.',
    createdAt: '2026-08-09T20:00:00.000Z',
    updatedAt: '2026-08-09T20:00:00.000Z',
    ...over,
  };
}

function day(logDate: string, over: Partial<DayStatus> = {}): DayStatus {
  return { userId: 'u1', logDate, status: 'complete', updatedAt: `${logDate}T23:00:00.000Z`, ...over };
}

function dbWith(over: Partial<NutritionDB>): NutritionDB {
  return { ...emptyNutritionDB(), ...over };
}

describe('mergeNutrition — additivity', () => {
  it('keeps a record present on only one side, in both argument orders', () => {
    const a = dbWith({
      logEntries: [entry('breakfast-1')],
      weightEntries: [weight('w-a')],
      checkIns: [checkIn('c-a')],
      dayStatus: [day('2026-08-05')],
      settings: { unitSystem: 'metric' },
    });
    const b = dbWith({
      logEntries: [entry('lunch-1')],
      weightEntries: [weight('w-b')],
      checkIns: [checkIn('c-b')],
      dayStatus: [day('2026-08-06')],
      settings: { timezone: 'Australia/Sydney' },
    });

    for (const merged of [mergeNutrition(a, b), mergeNutrition(b, a)]) {
      expect(merged.logEntries.map((e) => e.id).sort()).toEqual(['breakfast-1', 'lunch-1']);
      expect(merged.weightEntries.map((e) => e.id).sort()).toEqual(['w-a', 'w-b']);
      expect(merged.checkIns.map((c) => c.id).sort()).toEqual(['c-a', 'c-b']);
      expect(merged.dayStatus.map((d) => d.logDate).sort()).toEqual(['2026-08-05', '2026-08-06']);
      expect(merged.settings.unitSystem).toBe('metric');
      expect(merged.settings.timezone).toBe('Australia/Sydney');
    }
  });

  it('merging with an empty DB loses nothing, in both argument orders', () => {
    const a = dbWith({
      logEntries: [entry('e1'), entry('e2')],
      weightEntries: [weight('w1')],
      checkIns: [checkIn('c1')],
      dayStatus: [day('2026-08-05')],
    });
    expect(mergeNutrition(a, emptyNutritionDB())).toEqual(a);
    expect(mergeNutrition(emptyNutritionDB(), a)).toEqual(a);
  });

  it('resolves a same-id conflict by updatedAt, whichever side is passed first', () => {
    const older = entry('e1', { displayName: 'Oats', updatedAt: '2026-08-07T06:00:00.000Z' });
    const newer = entry('e1', { displayName: 'Oats, corrected', updatedAt: '2026-08-07T09:00:00.000Z' });
    const a = dbWith({ logEntries: [older] });
    const b = dbWith({ logEntries: [newer] });
    expect(mergeNutrition(a, b).logEntries).toEqual([newer]);
    expect(mergeNutrition(b, a).logEntries).toEqual([newer]);
  });

  it('carries a soft delete as a normal newer write rather than losing the record', () => {
    const live = entry('e1');
    const deleted = entry('e1', {
      deletedAt: '2026-08-07T10:00:00.000Z',
      updatedAt: '2026-08-07T10:00:00.000Z',
    });
    expect(mergeNutrition(dbWith({ logEntries: [live] }), dbWith({ logEntries: [deleted] })).logEntries).toEqual([
      deleted,
    ]);
    expect(mergeNutrition(dbWith({ logEntries: [deleted] }), dbWith({ logEntries: [live] })).logEntries).toEqual([
      deleted,
    ]);
  });

  it('clears a check-in proposal when the newer recompute holds the week', () => {
    // A held week must be able to write null over a number — the merge replaces
    // whole records, so it can, where a field-wise patch could not.
    const ready = checkIn('c1', { status: 'pending', proposedCalories: 2450 });
    const held = checkIn('c1', {
      status: 'held',
      proposedCalories: null,
      resolvedAt: null,
      updatedAt: '2026-08-10T20:00:00.000Z',
    });
    expect(mergeNutrition(dbWith({ checkIns: [ready] }), dbWith({ checkIns: [held] })).checkIns[0]!.proposedCalories).toBe(
      null,
    );
  });
});

describe('mergeNutrition — snapshot fields', () => {
  it('carries calories/macros/displayName/nutrients through a merge byte-identical', () => {
    const logged = entry('e1');
    const a = dbWith({ logEntries: [logged] });
    const b = dbWith({ logEntries: [entry('e2')] });

    for (const merged of [mergeNutrition(a, b), mergeNutrition(b, a)]) {
      const survivor = merged.logEntries.find((e) => e.id === 'e1')!;
      expect(survivor.calories).toBe(412.5);
      expect(survivor.proteinG).toBe(30.25);
      expect(survivor.carbsG).toBe(41);
      expect(survivor.fatG).toBe(12.75);
      expect(survivor.displayName).toBe('Rolled oats, dry');
      // nutrients stay at the SOURCE's basis, unscaled by quantity — copied,
      // never recomputed.
      expect(survivor.nutrients).toEqual({ sodium_mg: 4, fibre_g: 9.7 });
      expect(survivor.sourceSnapshot).toEqual({ foodId: 'food-e1', basisQty: 100, basisUnit: 'g' });
      expect(survivor).toEqual(logged);
    }
  });

  it('a newer edit to an unrelated field never re-derives the snapshot', () => {
    const logged = entry('e1');
    const renotedLater = entry('e1', { notes: 'post-session', updatedAt: '2026-08-07T12:00:00.000Z' });
    const merged = mergeNutrition(dbWith({ logEntries: [logged] }), dbWith({ logEntries: [renotedLater] }));
    expect(merged.logEntries[0]!.calories).toBe(logged.calories);
    expect(merged.logEntries[0]!.displayName).toBe(logged.displayName);
    expect(merged.logEntries[0]!.nutrients).toEqual(logged.nutrients);
  });

  it('survives a sanitize round trip on both sides of the merge', () => {
    const a = sanitizeNutritionDB(JSON.parse(JSON.stringify(dbWith({ logEntries: [entry('e1')] }))));
    const b = sanitizeNutritionDB(JSON.parse(JSON.stringify(dbWith({ logEntries: [entry('e2')] }))));
    const merged = sanitizeNutritionDB(mergeNutrition(a, b));
    expect(merged.logEntries.map((e) => e.id).sort()).toEqual(['e1', 'e2']);
    expect(merged.logEntries.find((e) => e.id === 'e1')).toEqual(a.logEntries[0]);
  });
});

describe('mergeNutrition — program', () => {
  const program = (id: string, updatedAt: string, days: { targetDate: string; calories: number; createdAt: string }[]) => ({
    id,
    userId: 'u1',
    name: 'Cut',
    mode: 'coached' as const,
    goal: 'lose' as const,
    targetRateKgPerWeek: -0.4,
    startDate: '2026-08-01',
    status: 'active' as const,
    days: days.map((d) => ({ programId: id, proteinG: 180, carbsG: 200, fatG: 70, source: 'engine', ...d })),
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt,
  });

  it('unions day targets of the same program instead of taking one side whole', () => {
    const a = dbWith({
      program: program('p1', '2026-08-05T00:00:00.000Z', [
        { targetDate: '2026-08-05', calories: 2400, createdAt: '2026-08-05T00:00:00.000Z' },
      ]),
    });
    const b = dbWith({
      program: program('p1', '2026-08-06T00:00:00.000Z', [
        { targetDate: '2026-08-06', calories: 2350, createdAt: '2026-08-06T00:00:00.000Z' },
      ]),
    });
    for (const merged of [mergeNutrition(a, b), mergeNutrition(b, a)]) {
      expect(merged.program?.days.map((d) => d.targetDate).sort()).toEqual(['2026-08-05', '2026-08-06']);
    }
  });

  it('takes a one-sided program rather than dropping it', () => {
    const a = dbWith({ program: program('p1', '2026-08-05T00:00:00.000Z', []) });
    expect(mergeNutrition(a, emptyNutritionDB()).program?.id).toBe('p1');
    expect(mergeNutrition(emptyNutritionDB(), a).program?.id).toBe('p1');
  });

  it('replaces wholesale when the athlete started a different program', () => {
    const a = dbWith({
      program: program('p1', '2026-08-05T00:00:00.000Z', [
        { targetDate: '2026-08-05', calories: 2400, createdAt: '2026-08-05T00:00:00.000Z' },
      ]),
    });
    const b = dbWith({
      program: program('p2', '2026-08-09T00:00:00.000Z', [
        { targetDate: '2026-08-09', calories: 3000, createdAt: '2026-08-09T00:00:00.000Z' },
      ]),
    });
    for (const merged of [mergeNutrition(a, b), mergeNutrition(b, a)]) {
      expect(merged.program?.id).toBe('p2');
      expect(merged.program?.days.map((d) => d.targetDate)).toEqual(['2026-08-09']);
    }
  });
});
