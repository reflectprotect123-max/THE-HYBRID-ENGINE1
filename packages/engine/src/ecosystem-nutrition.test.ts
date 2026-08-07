import { describe, expect, it } from 'vitest';
import {
  emptyEcosystemNamespace,
  mergeEcosystemNamespaces,
  sanitizeEcosystemNamespace,
} from '@hybrid/shared-core';
import { cloudFp } from './db';
import {
  applyProductSyncNamespace,
  buildMergedSyncNamespace,
  readNutritionPartition,
  SYNCED_SNAPSHOT_DOMAINS,
  withNutritionPartition,
} from './ecosystem';
import type { EngineDB } from './types';

/*
 * Nutrition rides its own partition. The engine models none of its shape — the
 * payload here is deliberately an opaque object, exactly as @hybrid/engine
 * sees it — so every assertion is about ISOLATION, not about food.
 */

const base: EngineDB = {
  workouts: [{ id: 's-w', kind: 'strength', name: 'Lift', blocks: [], updatedAt: 1 }],
  sessions: [],
  settings: {},
};

const slice = (id: string) => ({ schemaVersion: 1, logEntries: [{ id }] });

describe('nutrition partition', () => {
  it('round-trips through sanitize and merge', () => {
    const ns = withNutritionPartition(buildMergedSyncNamespace(base, 'hybrid:mobile', 10), slice('meal-1'), 'hybrid:mobile', 10);
    // sanitize whitelists partition keys, so an unlisted domain is not merely
    // untyped — it is deleted in transit, in both directions.
    expect(readNutritionPartition(sanitizeEcosystemNamespace(ns))).toEqual(slice('meal-1'));
    const merged = mergeEcosystemNamespaces(emptyEcosystemNamespace(), ns);
    expect(readNutritionPartition(merged)).toEqual(slice('meal-1'));
  });

  it('reports an absent partition as undefined, not as an empty slice', () => {
    // The caller must be able to tell "the server has never heard of this
    // athlete's nutrition" from "the athlete has logged nothing" — conflating
    // them leaves a populated local slice unpushed forever.
    expect(readNutritionPartition(buildMergedSyncNamespace(base, 'hybrid:mobile', 10))).toBeUndefined();
  });

  it('does not increment the revision on a no-change rebuild', () => {
    const first = withNutritionPartition(emptyEcosystemNamespace(), slice('meal-1'), 'hybrid:mobile', 10);
    const second = withNutritionPartition(first, slice('meal-1'), 'hybrid:mobile', 99);
    expect(second.partitions.nutrition).toEqual(first.partitions.nutrition);
    const third = withNutritionPartition(second, slice('meal-2'), 'hybrid:mobile', 99);
    expect(third.partitions.nutrition?.revision).toBe((first.partitions.nutrition?.revision ?? 0) + 1);
  });

  it('leaves the training partitions untouched', () => {
    const training = buildMergedSyncNamespace(base, 'hybrid:mobile', 10);
    const withNutrition = withNutritionPartition(training, slice('meal-1'), 'hybrid:mobile', 10);
    expect(withNutrition.partitions.strength).toEqual(training.partitions.strength);
    expect(withNutrition.partitions.conditioning).toEqual(training.partitions.conditioning);
  });

  it('is never folded into the EngineDB, so it cannot move the training fingerprint', () => {
    const training = buildMergedSyncNamespace(base, 'hybrid:mobile', 10);
    const clean = applyProductSyncNamespace(base, training);
    const remote = withNutritionPartition(training, slice('meal-1'), 'hybrid:mobile', 10);
    const applied = applyProductSyncNamespace(base, remote);
    expect(applied.ecosystem?.partitions.nutrition).toBeUndefined();
    // The whole point: a meal logged on another device arrives, and the
    // training blob this device would push is byte-identical.
    expect(cloudFp(applied)).toBe(cloudFp(clean));
  });

  it('lists nutrition among the synced domains exactly once', () => {
    // One list feeds both the pull filter and the push loop in both apps; a
    // domain missing from it is written and never read, or read and never
    // written, and nothing fails loudly when that happens.
    expect([...SYNCED_SNAPSHOT_DOMAINS]).toEqual(['strength', 'conditioning', 'nutrition']);
  });
});
