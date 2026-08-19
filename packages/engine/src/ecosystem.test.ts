import { describe, expect, it } from 'vitest';
import { applyProductSyncNamespace, buildProductSyncNamespace } from './ecosystem';
import type { EngineDB } from './types';

const base: EngineDB = {
  workouts: [
    { id: 's-w', kind: 'strength', name: 'Lift', blocks: [], updatedAt: 1 },
    { id: 'c-w', kind: 'conditioning', name: 'Intervals', blocks: [{ id: 'c', kind: 'conditioning', condFmt: 'intervals' }], updatedAt: 1 },
  ],
  sessions: [],
  settings: {},
};

describe('product sync namespaces', () => {
  it('partitions strength and conditioning content and does not increment on retry', () => {
    const first = buildProductSyncNamespace(base, 'strength', 'device-a', 10);
    const second = buildProductSyncNamespace({ ...base, ecosystem: first }, 'strength', 'device-a', 11);
    expect(first.partitions.strength?.data).toMatchObject({ workouts: [{ id: 's-w' }] });
    expect(first.partitions.strength?.data).not.toMatchObject({ workouts: [{ id: 'c-w' }] });
    expect(second.partitions.strength?.revision).toBe(first.partitions.strength?.revision);
  });

  it('no longer projects the deleted liftProgress field into the strength snapshot', () => {
    // `Settings.liftProgress` was deleted 17 August 2026; a legacy value still
    // in a local blob rides through Settings' index signature but must not be
    // re-projected into the strength partition's settings.
    const legacy: EngineDB = { ...base, settings: { liftProgress: { 'back squat': { kg: 100, at: 1 } } } };
    const out = buildProductSyncNamespace(legacy, 'strength', 'device-a', 10);
    const settings = (out.partitions.strength?.data as { settings: Record<string, unknown> }).settings;
    expect('liftProgress' in settings).toBe(false);
  });

  it('folds a remote conditioning snapshot without dropping local strength data', () => {
    const local = buildProductSyncNamespace(base, 'strength', 'device-a', 10);
    const remote = buildProductSyncNamespace({ ...base, sessions: [{ id: 'c-s', kind: 'conditioning', date: '2026-08-04', status: 'completed', blocks: [] }] }, 'conditioning', 'device-b', 20);
    const out = applyProductSyncNamespace({ ...base, ecosystem: local }, remote);
    expect(out.workouts.map((x) => x.id).sort()).toEqual(['c-w', 's-w']);
    expect(out.sessions.map((x) => x.id)).toContain('c-s');
  });

  it('merges local shared facts when a remote namespace is older or partial', () => {
    const localCore = { ...base.core!, profile: { age: 40 }, updatedAt: 20 };
    const remote = buildProductSyncNamespace({ ...base, core: { ...base.core!, profile: { age: 30 }, updatedAt: 10 } }, 'conditioning', 'device-b', 10);
    const out = applyProductSyncNamespace({ ...base, core: localCore }, remote);
    expect(out.core?.profile.age).toBe(40);
  });

  it('carries deletion tombstones across partitions so stale data cannot resurrect', () => {
    const remoteWithTombstone = buildProductSyncNamespace(
      { ...base, settings: { deletedIds: { 'c-w': 99 } } },
      'strength',
      'device-a',
      20,
    );
    const conditioning = remoteWithTombstone.partitions.strength?.data as { settings?: { deletedIds?: Record<string, number> } };
    expect(conditioning.settings?.deletedIds?.['c-w']).toBe(99);
    const out = applyProductSyncNamespace({ ...base }, remoteWithTombstone);
    expect(out.workouts.map((x) => x.id)).toEqual(['s-w']);
    expect(out.settings.deletedIds?.['c-w']).toBe(99);
  });
});
