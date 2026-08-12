import { describe, expect, it } from 'vitest';
import { mergeEngines, sanitizeDB } from '@hybrid/engine';
import type { EngineDB } from '@hybrid/engine';
import { startFresh, startFreshCounts } from './startFresh';

function db(): EngineDB {
  return sanitizeDB({
    workouts: [
      { id: 'w1', name: 'Session', blocks: [{ id: 'b0', heading: 'New block', exercises: [] }], updatedAt: 10 },
      { id: 'w2', name: '', blocks: [], updatedAt: 10 },
    ],
    sessions: [{ id: 's1', date: '2026-08-12', status: 'active', blocks: [], updatedAt: 10 }],
    settings: { units: 'kg' },
  });
}

describe('startFresh', () => {
  it('removes every workout and session', () => {
    const out = startFresh(db(), 100);
    expect(out.workouts).toEqual([]);
    expect(out.sessions).toEqual([]);
  });

  it('tombstones each removed id, so a cloud pull cannot resurrect it', () => {
    const out = startFresh(db(), 100);
    expect(out.settings.deletedIds).toMatchObject({ w1: 100, w2: 100, s1: 100 });
  });

  it('actually survives a merge with a server copy that still has the old rows', () => {
    // The property that matters, asserted through the REAL merge rather than
    // by inspecting the tombstone map: without tombstones every cleared
    // session comes straight back on the next pull and the clear looks like it
    // silently failed.
    const before = db();
    const cleared = startFresh(before, 100);
    const merged = mergeEngines(cleared, before);
    expect(merged.workouts).toEqual([]);
    expect(merged.sessions).toEqual([]);
  });

  it('keeps a tombstone already recorded rather than dropping it', () => {
    const source = db();
    source.settings.deletedIds = { old: 5 };
    expect(startFresh(source, 100).settings.deletedIds).toMatchObject({ old: 5, w1: 100 });
  });

  it('leaves every other setting alone', () => {
    const source = db();
    source.settings.units = 'lb';
    const out = startFresh(source, 100);
    expect(out.settings.units).toBe('lb');
  });

  it('leaves the shared-core facts alone — they are observations, not workouts', () => {
    const source = { ...db(), core: { version: 1 } as never };
    expect(startFresh(source, 100).core).toBe(source.core);
  });

  it('empties the TRAINING sync partitions, so a second device cannot hand them back', () => {
    // Tombstones cover records that travel by id. A partition is a whole blob
    // under a revision — clearing workouts while leaving the strength snapshot
    // holding them is how the junk reappeared from the other device.
    const source = {
      ...db(),
      ecosystem: {
        schemaVersion: 1,
        core: {},
        partitions: {
          strength: { rev: 3, data: { workouts: ['junk'] } },
          conditioning: { rev: 2, data: {} },
          athleteState: { rev: 1, data: {} },
          weeklyPlan: { rev: 1, data: {} },
          nutrition: { rev: 9, data: { foods: ['keep me'] } },
        },
        events: [{ id: 'e1' }],
      } as never,
    };
    const eco = startFresh(source, 100).ecosystem as unknown as {
      partitions: Record<string, unknown>;
      events: unknown[];
    };
    expect(eco.partitions.strength).toBeUndefined();
    expect(eco.partitions.conditioning).toBeUndefined();
    expect(eco.partitions.athleteState).toBeUndefined();
    expect(eco.partitions.weeklyPlan).toBeUndefined();
    expect(eco.events).toEqual([]);
  });

  it('does not touch the nutrition partition, which is its own slice', () => {
    // CLAUDE.md: nutrition is its own slice and its own sync partition, and a
    // training write must never be able to reach it.
    const nutrition = { rev: 9, data: { foods: ['keep me'] } };
    const source = {
      ...db(),
      ecosystem: { schemaVersion: 1, core: {}, partitions: { nutrition }, events: [] } as never,
    };
    const eco = startFresh(source, 100).ecosystem as unknown as { partitions: { nutrition: unknown } };
    expect(eco.partitions.nutrition).toBe(nutrition);
  });

  it('is safe on a database that has no ecosystem slice at all', () => {
    const source = db();
    delete (source as { ecosystem?: unknown }).ecosystem;
    expect(() => startFresh(source, 100)).not.toThrow();
  });

  it('does not mutate the database it was handed', () => {
    const source = db();
    startFresh(source, 100);
    expect(source.workouts).toHaveLength(2);
    expect(source.settings.deletedIds).toBeUndefined();
  });

  it('is safe on an already-empty store', () => {
    const empty = sanitizeDB({});
    const out = startFresh(empty, 100);
    expect(out.workouts).toEqual([]);
    expect(out.sessions).toEqual([]);
  });
});

describe('startFreshCounts', () => {
  it('reports what would go, so the confirmation is not a guess', () => {
    expect(startFreshCounts(db())).toEqual({ workouts: 2, sessions: 1 });
  });
});
