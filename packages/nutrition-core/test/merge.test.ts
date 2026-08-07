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
      // Distinct weeks: two check-ins for the SAME week are one row to the
      // server, and the merge is required to collapse them — see the
      // natural-key test below.
      checkIns: [checkIn('c-a', { weekStart: '2026-08-03', weekEnd: '2026-08-09' })],
      dayStatus: [day('2026-08-05')],
      settings: { unitSystem: 'metric' },
    });
    const b = dbWith({
      logEntries: [entry('lunch-1')],
      weightEntries: [weight('w-b')],
      checkIns: [checkIn('c-b', { weekStart: '2026-08-10', weekEnd: '2026-08-16' })],
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
    // Both argument orders: the clear must not depend on which device synced
    // first, or the athlete keeps last week's number next to a held status on
    // exactly one of their devices.
    for (const merged of [
      mergeNutrition(dbWith({ checkIns: [ready] }), dbWith({ checkIns: [held] })),
      mergeNutrition(dbWith({ checkIns: [held] }), dbWith({ checkIns: [ready] })),
    ]) {
      expect(merged.checkIns).toHaveLength(1);
      expect(merged.checkIns[0]!.proposedCalories).toBe(null);
      expect(merged.checkIns[0]!.status).toBe('held');
    }
  });
});

describe('mergeNutrition — convergence', () => {
  /* A merge that is not commutative in CONTENT never converges: each device
   * merges the other's blob in its own argument order and they disagree
   * forever. Asserting `.sort()`ed id lists cannot see this — the divergence is
   * in which record survived and in what order the array serialises. */
  const divergent = () => {
    const a = dbWith({
      logEntries: [
        entry('z-late', { displayName: 'A side', updatedAt: '2026-08-07T06:00:00.000Z' }),
        // Both copies were repaired by the sanitizer, so both carry the epoch
        // and no stamp can separate them.
        entry('a-epoch', { displayName: 'A repair', updatedAt: '1970-01-01T00:00:00.000Z' }),
      ],
      weightEntries: [weight('w-2'), weight('w-1', { weightKg: 80.1 })],
      checkIns: [checkIn('c-a', { weekStart: '2026-08-03' })],
      dayStatus: [day('2026-08-06'), day('2026-08-05')],
      settings: { unitSystem: 'metric', theme: 'dark' },
    });
    const b = dbWith({
      logEntries: [
        entry('z-late', { displayName: 'B side', updatedAt: '2026-08-07T06:00:00.000Z' }),
        entry('a-epoch', { displayName: 'B repair', updatedAt: '1970-01-01T00:00:00.000Z' }),
      ],
      weightEntries: [weight('w-1', { weightKg: 80.9 }), weight('w-3')],
      checkIns: [checkIn('c-b', { weekStart: '2026-08-10', weekEnd: '2026-08-16' })],
      dayStatus: [day('2026-08-05', { status: 'partial' }), day('2026-08-07')],
      settings: { timezone: 'Australia/Sydney', theme: 'light' },
    });
    return { a, b };
  };

  it('produces the same DB whichever side is passed first', () => {
    const { a, b } = divergent();
    expect(mergeNutrition(a, b)).toEqual(mergeNutrition(b, a));
  });

  it('serialises identically in both orders, so a sync fingerprint cannot flap', () => {
    // Sync layers dirty-check the serialised blob. Array order and key order
    // are part of that fingerprint, so an order-dependent merge makes two
    // settled devices push a write that changes nothing, forever.
    const { a, b } = divergent();
    expect(JSON.stringify(mergeNutrition(a, b))).toBe(JSON.stringify(mergeNutrition(b, a)));
  });

  it('emits records in key order rather than a-then-b order', () => {
    const { a, b } = divergent();
    const merged = mergeNutrition(a, b);
    expect(merged.logEntries.map((e) => e.id)).toEqual(['a-epoch', 'z-late']);
    expect(merged.weightEntries.map((e) => e.id)).toEqual(['w-1', 'w-2', 'w-3']);
    expect(merged.dayStatus.map((d) => d.logDate)).toEqual([
      '2026-08-05',
      '2026-08-06',
      '2026-08-07',
    ]);
  });
});

describe('mergeNutrition — record identity', () => {
  it('collapses two offline uuids for one week onto the server natural key', () => {
    // Uniqueness is (user_id, program_id, week_start) — the NULLS NOT DISTINCT
    // index in 005_checkin_program_provenance.sql. Keying on `id` shows the
    // athlete two contradictory proposals for one week, then lets the server's
    // upsert silently pick one.
    const older = checkIn('local-uuid-1', { proposedCalories: 2450 });
    const newer = checkIn('local-uuid-2', {
      proposedCalories: 2380,
      updatedAt: '2026-08-09T22:00:00.000Z',
    });
    for (const merged of [
      mergeNutrition(dbWith({ checkIns: [older] }), dbWith({ checkIns: [newer] })),
      mergeNutrition(dbWith({ checkIns: [newer] }), dbWith({ checkIns: [older] })),
    ]) {
      expect(merged.checkIns).toHaveLength(1);
      expect(merged.checkIns[0]!.proposedCalories).toBe(2380);
    }
  });

  it('keeps the same week under two different programs apart', () => {
    // program_id is in the natural key precisely so a goal change mid-week
    // cannot overwrite the previous program's proposal.
    const cut = checkIn('c1', { programId: 'p-cut' });
    const bulk = checkIn('c2', { programId: 'p-bulk' });
    const merged = mergeNutrition(dbWith({ checkIns: [cut] }), dbWith({ checkIns: [bulk] }));
    expect(merged.checkIns.map((c) => c.programId).sort()).toEqual(['p-bulk', 'p-cut']);
  });

  it('cannot be made to collide two dayStatus keys through a delimiter in userId', () => {
    // userId and logDate are free strings from an untrusted blob. A delimiter
    // smuggled into one part would fuse two athletes' days into one key and
    // drop a real record.
    const NUL = '\u0000';
    const sneaky = day('2026-08-05', { userId: `u1${NUL}2026-08-06`, status: 'fasted' });
    const real = day(`2026-08-06${NUL}2026-08-05`, { userId: 'u1', status: 'complete' });
    const merged = mergeNutrition(dbWith({ dayStatus: [sneaky] }), dbWith({ dayStatus: [real] }));
    expect(merged.dayStatus).toHaveLength(2);
  });

  it('refuses to merge across schema versions rather than mislabelling the result', () => {
    // Math.max would stamp v1-shaped records as v2, so a real v2 device skips
    // the migration that would have converted them.
    const v1 = dbWith({ schemaVersion: 1, logEntries: [entry('e1')] });
    const v2 = dbWith({ schemaVersion: 2, logEntries: [entry('e2')] });
    expect(() => mergeNutrition(v1, v2)).toThrow(/schemaVersion/);
    expect(() => mergeNutrition(v2, v1)).toThrow(/schemaVersion/);
    expect(mergeNutrition(v2, dbWith({ schemaVersion: 2 })).schemaVersion).toBe(2);
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

  it('takes a one-sided program WITH its day targets rather than dropping them', () => {
    // A program with `days: []` proves nothing here: the whole risk is that the
    // side holding the calendar loses it to the side that has no program at all.
    const a = dbWith({
      program: program('p1', '2026-08-05T00:00:00.000Z', [
        { targetDate: '2026-08-05', calories: 2400, createdAt: '2026-08-05T00:00:00.000Z' },
        { targetDate: '2026-08-06', calories: 2350, createdAt: '2026-08-05T00:00:00.000Z' },
      ]),
    });
    for (const merged of [mergeNutrition(a, emptyNutritionDB()), mergeNutrition(emptyNutritionDB(), a)]) {
      expect(merged.program?.id).toBe('p1');
      expect(merged.program?.days.map((d) => d.targetDate)).toEqual(['2026-08-05', '2026-08-06']);
      expect(merged.program?.days.map((d) => d.calories)).toEqual([2400, 2350]);
    }
  });

  it('resolves two targets for the SAME date by createdAt, in both orders', () => {
    // One row per (program_id, target_date), and the row has no updatedAt — a
    // recompute wins by having been written later, not by which device asked.
    const a = dbWith({
      program: program('p1', '2026-08-05T00:00:00.000Z', [
        { targetDate: '2026-08-05', calories: 2400, createdAt: '2026-08-05T00:00:00.000Z' },
      ]),
    });
    const b = dbWith({
      program: program('p1', '2026-08-05T00:00:00.000Z', [
        { targetDate: '2026-08-05', calories: 2250, createdAt: '2026-08-05T09:00:00.000Z' },
      ]),
    });
    for (const merged of [mergeNutrition(a, b), mergeNutrition(b, a)]) {
      expect(merged.program?.days).toHaveLength(1);
      expect(merged.program?.days[0]!.calories).toBe(2250);
    }

    // Same date, same createdAt: `createdAt` is the row's only stamp, so two
    // recomputes in the same second leave nothing to order them by. Resolving
    // that by argument order hands the two devices different targets for a day
    // the athlete is about to eat.
    const tied = dbWith({
      program: program('p1', '2026-08-05T00:00:00.000Z', [
        { targetDate: '2026-08-05', calories: 2100, createdAt: '2026-08-05T09:00:00.000Z' },
      ]),
    });
    expect(mergeNutrition(b, tied).program?.days).toEqual(mergeNutrition(tied, b).program?.days);
  });

  it('picks the same program when two ids carry the same updatedAt', () => {
    // Equal stamps on different ids is permanent split-brain if it resolves by
    // argument order: each device keeps its own program and the loser's whole
    // day-target calendar is gone.
    const a = dbWith({
      program: program('p1', '2026-08-05T00:00:00.000Z', [
        { targetDate: '2026-08-05', calories: 2400, createdAt: '2026-08-05T00:00:00.000Z' },
      ]),
    });
    const b = dbWith({
      program: program('p2', '2026-08-05T00:00:00.000Z', [
        { targetDate: '2026-08-09', calories: 3000, createdAt: '2026-08-09T00:00:00.000Z' },
      ]),
    });
    expect(mergeNutrition(a, b).program).toEqual(mergeNutrition(b, a).program);
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
