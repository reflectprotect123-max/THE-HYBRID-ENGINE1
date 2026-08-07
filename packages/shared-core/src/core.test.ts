import { describe, expect, it } from 'vitest';
import {
  emptyEcosystemNamespace,
  emptySharedCore,
  appendSharedCoreEvent,
  mergeEcosystemNamespaces,
  mergeSharedCore,
  migrateLegacySettings,
  sanitizeSharedCore,
} from '.';

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

/*
 * The three merge defects found in the 7 August adversarial debug. Each of
 * these fails against the pre-fix `mergeSharedCore`, and each describes a way
 * an athlete lost data that existed on only one of their two devices.
 */
describe('shared-core merge is safe under real two-device traffic', () => {
  const coreWith = (patch: Partial<ReturnType<typeof emptySharedCore>>) =>
    sanitizeSharedCore({ ...emptySharedCore(0), ...patch });

  it('does not erase a pain hold when the other device merely finished a session', () => {
    // Phone, 08:00 — the athlete flags a painful knee.
    const phone = coreWith({
      safety: { painHold: { active: true, areas: ['left knee'], updatedAt: 8 } },
      updatedAt: 8,
    });
    // Web, 09:00 — last pulled before that, so it has no pain hold. Completing
    // a session bumps the TOP-LEVEL stamp and touches nothing in `safety`.
    const web = appendSharedCoreEvent(coreWith({ updatedAt: 7 }), {
      type: 'workout_completed',
      occurredAt: '2026-08-07T09:00:00.000Z',
      sourceDomain: 'strength',
      idempotencyKey: 'session:1:completed',
      payload: {},
    });
    expect(web.updatedAt).toBeGreaterThan(phone.updatedAt);

    // Resolving `safety` on the top-level stamp took the web's empty flags.
    expect(mergeSharedCore(phone, web).safety.painHold?.active).toBe(true);
    expect(mergeSharedCore(web, phone).safety.painHold?.active).toBe(true);
  });

  it('keeps the raised flag when two devices stamp it at the same instant', () => {
    const raised = coreWith({ safety: { painHold: { active: true, areas: ['hip'], updatedAt: 5 } } });
    const cleared = coreWith({ safety: { painHold: { active: false, areas: [], updatedAt: 5 } } });
    expect(mergeSharedCore(raised, cleared).safety.painHold?.active).toBe(true);
    expect(mergeSharedCore(cleared, raised).safety.painHold?.active).toBe(true);
  });

  it('a later clearance still lifts the hold', () => {
    const raised = coreWith({ safety: { painHold: { active: true, areas: ['hip'], updatedAt: 5 } } });
    const cleared = coreWith({ safety: { painHold: { active: false, areas: [], updatedAt: 6 } } });
    expect(mergeSharedCore(raised, cleared).safety.painHold?.active).toBe(false);
    expect(mergeSharedCore(cleared, raised).safety.painHold?.active).toBe(false);
  });

  it('evicts the oldest records at the cap, not the ones the other device holds', () => {
    // Two devices, each with a FULL window of distinct daily check-ins: the web
    // holds Dec-Mar, the phone holds Apr-Aug. Slicing the concatenation kept
    // whichever side went second and deleted the other 120 days outright.
    const day = (n: number) => new Date(Date.UTC(2026, 0, n)).toISOString().slice(0, 10);
    const older = coreWith({
      recovery: Array.from({ length: 120 }, (_, i) => ({
        id: `r-${day(i + 1)}`, date: day(i + 1), source: 'manual' as const, recordedAt: 0, sleepHours: 7,
      })),
    });
    const newer = coreWith({
      recovery: Array.from({ length: 120 }, (_, i) => ({
        id: `r-${day(i + 121)}`, date: day(i + 121), source: 'manual' as const, recordedAt: 0, sleepHours: 8,
      })),
    });

    for (const merged of [mergeSharedCore(older, newer), mergeSharedCore(newer, older)]) {
      expect(merged.recovery).toHaveLength(120);
      // The cap is a retention policy over DATES: the newest 120 survive
      // whichever way round the merge ran.
      expect(merged.recovery[0]?.date).toBe(day(121));
      expect(merged.recovery[119]?.date).toBe(day(240));
    }
  });

  it('gives a record without an id the same id on both devices', () => {
    // Same observation, different position in each device's array.
    const a = sanitizeSharedCore({ recovery: [{ date: '2026-08-01', sleepHours: 7 }, { date: '2026-08-02', sleepHours: 8 }] });
    const b = sanitizeSharedCore({ recovery: [{ date: '2026-08-02', sleepHours: 8 }] });
    expect(b.recovery[0]?.id).toBe(a.recovery[1]?.id);
    // ...so the merge recognises it as one row, not two.
    expect(mergeSharedCore(a, b).recovery).toHaveLength(2);
  });

  it('does not collide two different events that share an array index', () => {
    // Neither carries an id. Index-derived keys made both `event-0`, and the
    // dedupe dropped one — a record present on only one device, lost.
    const a = sanitizeSharedCore({
      events: [{ type: 'workout_completed', occurredAt: '2026-08-01T10:00:00.000Z' }],
    });
    const b = sanitizeSharedCore({
      events: [{ type: 'body_weight_recorded', occurredAt: '2026-08-02T06:00:00.000Z' }],
    });
    expect(mergeSharedCore(a, b).events).toHaveLength(2);
    expect(mergeSharedCore(b, a).events).toHaveLength(2);
  });
});
