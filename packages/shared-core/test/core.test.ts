import { describe, expect, it } from 'vitest';
import {
  emptyEcosystemNamespace,
  emptySharedCore,
  appendSharedCoreEvent,
  mergeEcosystemNamespaces,
  mergeSharedCore,
  migrateLegacySettings,
  sanitizeSharedCore,
} from '../src';

describe('shared-core sanitisation and migration', () => {
  it('keeps a strict, bounded shape for malformed input', () => {
    const out = sanitizeSharedCore({
      profile: { age: '32', units: 'kg' },
      schedule: { availableDays: [1, 1, 8, '2'], strengthSessionsPerWeek: 3 },
      bodyMetrics: [{ id: 'w', kind: 'weight', value: '89', unit: 'kg', measuredAt: '2026-08-04' }, null],
      recovery: [{ id: 'r', date: '2026-08-04', stress: 30 }],
      safety: { illness: { status: 'active', updatedAt: 2 } },
    });
    expect(out.profile.age).toBe(32);
    expect(out.schedule.availableDays).toEqual([1, 2]);
    expect(out.bodyMetrics).toHaveLength(1);
    expect(out.recovery[0]?.stress).toBe(10);
    expect(out.safety.illness?.status).toBe('active');
  });

  it('migrates legacy WHOOP history without deleting the old shape', () => {
    const out = migrateLegacySettings({
      profile: { age: 32, units: 'kg' },
      whoopDaily: [{ date: '2026-08-04', recovery: 72, strain: 9, hrvMs: 54, restingHr: 49, sleepPerformance: 88 }],
    }, 123);
    expect(out.profile).toMatchObject({ age: 32, units: 'kg' });
    expect(out.whoopDaily[0]).toMatchObject({ recoveryScore: 72, hrvMs: 54, restingHr: 49 });
    expect(out.recovery[0]).toMatchObject({ date: '2026-08-04', source: 'whoop' });
  });
});

describe('shared-core merge and sync namespaces', () => {
  it('appends integration events idempotently', () => {
    const core = emptySharedCore(1);
    const event = {
      type: 'workout_completed' as const,
      occurredAt: '2026-08-04T10:00:00.000Z',
      sourceDomain: 'strength' as const,
      idempotencyKey: 'session:s1:completed',
      payload: { sessionId: 's1' },
    };
    const once = appendSharedCoreEvent(core, event);
    const twice = appendSharedCoreEvent(once, event);
    expect(twice.events).toHaveLength(1);
    expect(twice.events[0]?.payload).toEqual({ sessionId: 's1' });
  });

  it('keeps a nutrition-sourced event attributed to nutrition through sanitisation', () => {
    const out = sanitizeSharedCore({
      events: [
        {
          id: 'e-nutrition',
          type: 'nutrition_target_updated',
          occurredAt: '2026-08-07T06:00:00.000Z',
          sourceDomain: 'nutrition',
          idempotencyKey: 'nutrition:target:2026-08-07',
          payload: { calories: 2800 },
        },
        {
          id: 'e-unknown',
          type: 'nutrition_target_updated',
          occurredAt: '2026-08-07T07:00:00.000Z',
          sourceDomain: 'sleep_tracker',
          idempotencyKey: 'unknown:2026-08-07',
          payload: {},
        },
      ],
    });
    expect(out.events).toHaveLength(2);
    // The nutrition domain is a first-class owner: it must survive, not be
    // silently relabelled 'core' the way an unrecognised domain is.
    expect(out.events[0]).toMatchObject({ id: 'e-nutrition', sourceDomain: 'nutrition', payload: { calories: 2800 } });
    expect(out.events[1]?.sourceDomain).toBe('core');
  });

  it('carries a nutrition partition through an ecosystem merge', () => {
    const local = emptyEcosystemNamespace();
    const remote = emptyEcosystemNamespace();
    const event = {
      type: 'nutrition_target_updated' as const,
      occurredAt: '2026-08-07T06:00:00.000Z',
      sourceDomain: 'nutrition' as const,
      idempotencyKey: 'nutrition:target:2026-08-07',
      payload: { calories: 2800 },
    };
    local.core = appendSharedCoreEvent(emptySharedCore(1), event);
    const out = mergeEcosystemNamespaces(local, remote);
    expect(out.core.events[0]?.sourceDomain).toBe('nutrition');
  });

  it('unions append-only facts and keeps the newer scalar state', () => {
    const a = { ...emptySharedCore(1), updatedAt: 1, bodyMetrics: [{ id: 'a', kind: 'weight' as const, value: 89, unit: 'kg', measuredAt: '2026-08-01' }] };
    const b = { ...emptySharedCore(2), updatedAt: 2, profile: { age: 32 }, bodyMetrics: [{ id: 'b', kind: 'weight' as const, value: 88.5, unit: 'kg', measuredAt: '2026-08-02' }] };
    const out = mergeSharedCore(a, b);
    expect(out.profile.age).toBe(32);
    expect(out.bodyMetrics.map((x) => x.id).sort()).toEqual(['a', 'b']);
  });

  it('chooses domain snapshots by revision, not whichever client pushed last', () => {
    const local = emptyEcosystemNamespace();
    const remote = emptyEcosystemNamespace();
    local.partitions.strength = { schemaVersion: 1, domain: 'strength', revision: 4, updatedAt: 10, writer: 'a', data: { x: 1 } };
    remote.partitions.strength = { schemaVersion: 1, domain: 'strength', revision: 3, updatedAt: 99, writer: 'b', data: { x: 2 } };
    const out = mergeEcosystemNamespaces(local, remote);
    expect(out.partitions.strength?.data).toEqual({ x: 1 });
  });
});
