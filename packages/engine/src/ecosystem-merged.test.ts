import { describe, expect, it } from 'vitest';
import { buildMergedSyncNamespace, buildProductSyncNamespace } from './ecosystem';
import type { EngineDB } from './types';

/*
 * The merged mobile app writes BOTH domain partitions. Composition is the
 * whole guarantee: each partition must be exactly what the single-domain
 * builder produces, so every contract rule that holds for one domain holds
 * for both — this is not a third code path.
 */

const base: EngineDB = {
  workouts: [
    { id: 's-w', kind: 'strength', name: 'Lift', blocks: [], updatedAt: 1 },
    { id: 'c-w', kind: 'conditioning', name: 'Intervals', blocks: [{ id: 'c', kind: 'conditioning', condFmt: 'intervals' }], updatedAt: 1 },
  ],
  sessions: [],
  settings: {},
};

describe('buildMergedSyncNamespace', () => {
  it('populates both domain partitions, each scoped to its own kind', () => {
    const ns = buildMergedSyncNamespace(base, 'hybrid:mobile', 10);
    expect(ns.partitions.strength?.data).toMatchObject({ workouts: [{ id: 's-w' }] });
    expect(ns.partitions.conditioning?.data).toMatchObject({ workouts: [{ id: 'c-w' }] });
    expect(ns.partitions.strength?.data).not.toMatchObject({ workouts: [{ id: 'c-w' }] });
  });

  it('each partition matches the single-domain builder exactly', () => {
    const merged = buildMergedSyncNamespace(base, 'hybrid:mobile', 10);
    const strengthOnly = buildProductSyncNamespace(base, 'strength', 'hybrid:mobile', 10);
    expect(merged.partitions.strength).toEqual(strengthOnly.partitions.strength);
    const threaded = { ...base, core: strengthOnly.core, ecosystem: strengthOnly };
    const condOnly = buildProductSyncNamespace(threaded, 'conditioning', 'hybrid:mobile', 10);
    expect(merged.partitions.conditioning).toEqual(condOnly.partitions.conditioning);
  });

  it('does not increment revisions on a no-change rebuild', () => {
    const first = buildMergedSyncNamespace(base, 'hybrid:mobile', 10);
    const second = buildMergedSyncNamespace({ ...base, ecosystem: first }, 'hybrid:mobile', 11);
    expect(second.partitions.strength?.revision).toBe(first.partitions.strength?.revision);
    expect(second.partitions.conditioning?.revision).toBe(first.partitions.conditioning?.revision);
  });
});
