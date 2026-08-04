import { describe, expect, it } from 'vitest';
import { emptySharedCore } from '@hybrid/shared-core';
import { deriveAthleteState } from '../src';

describe('Whole-Athlete State', () => {
  it('returns an honest unknown state with no fabricated readiness data', () => {
    const out = deriveAthleteState({ core: emptySharedCore(1), today: '2026-08-04' });
    expect(out.readiness.score).toBeNull();
    expect(out.readiness.band).toBe('unknown');
    expect(out.dataQuality).toBe('missing');
    expect(out.capacity.overall).toBe('unknown');
  });

  it('uses recovery, sleep and life-load context to produce constrained capacity', () => {
    const core = emptySharedCore(1);
    core.recovery = [{ id: 'r1', date: '2026-08-04', sleepHours: 5, energy: 3, soreness: 8, stress: 7, recordedAt: 1 }];
    core.lifeLoad = [{ id: 'l1', date: '2026-08-04', physicalLoad: 8, stress: 7 }];
    const out = deriveAthleteState({
      core,
      today: '2026-08-04',
      availableMinutes: 25,
      recentTraining: { sessionsLast7d: 4, hardSessionsLast7d: 4, strengthSessionsLast7d: 2, conditioningSessionsLast7d: 2, lowerBodyHardSessionsLast72h: 1 },
    });
    expect(out.readiness.band).toBe('low');
    expect(out.constraints.map((x) => x.code)).toEqual(expect.arrayContaining(['low_readiness', 'physical_load_high', 'time_limited', 'recovery_debt_high']));
    expect(out.recoveryDebt.band).toBe('high');
  });

  it('treats pain and illness as safety constraints, not ordinary fatigue', () => {
    const core = emptySharedCore(1);
    core.safety = {
      painHold: { active: true, areas: ['lower back'], updatedAt: 1 },
      illness: { status: 'active', updatedAt: 1 },
    };
    const out = deriveAthleteState({ core, today: '2026-08-04' });
    expect(out.constraints.filter((x) => x.hard).map((x) => x.code)).toEqual(['pain_hold_active', 'illness_flag_active']);
    expect(out.constraints.find((x) => x.code === 'pain_hold_active')?.adjustment).toMatch(/stop|modify/i);
  });

  it('uses recorded available time when the caller does not provide a separate override', () => {
    const core = emptySharedCore(1);
    core.lifeLoad = [{ id: 'l1', date: '2026-08-04', availableMinutes: 20 }];
    const out = deriveAthleteState({ core, today: '2026-08-04' });
    expect(out.constraints.map((x) => x.code)).toContain('time_limited');
  });

  it('does not let HRV alone change readiness or create a pain gate', () => {
    const a = emptySharedCore(1);
    const b = emptySharedCore(1);
    a.whoopDaily = [{ date: '2026-08-04', hrvMs: 20 }];
    b.whoopDaily = [{ date: '2026-08-04', hrvMs: 120 }];
    const left = deriveAthleteState({ core: a, today: '2026-08-04' });
    const right = deriveAthleteState({ core: b, today: '2026-08-04' });
    expect(left.readiness.score).toBe(right.readiness.score);
    expect(left.constraints).toEqual(right.constraints);
    expect(left.advisory.hrvMs).toBe(20);
  });
});
