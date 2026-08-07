import { describe, expect, it } from 'vitest';
import { emptySharedCore } from '@hybrid/shared-core';
import { deriveAthleteState } from '@hybrid/whole-athlete-state';
import { reconcileWeeklyPlan, type SessionProposal } from '.';

const proposal = (over: Partial<SessionProposal>): SessionProposal => ({
  schemaVersion: 1,
  id: 'p-' + (over.id || Math.random()),
  domain: 'strength',
  title: 'Strength session',
  durationMinutes: 45,
  effort: 'moderate',
  priority: 'preferred',
  goalWeight: 1,
  staleness: 0,
  tags: ['full_body'],
  estimatedLoad: 50,
  minimumSpacingDays: 1,
  sourceEngineVersion: 'test',
  sourceDomain: 'strength',
  ...over,
});

const base = () => {
  const core = emptySharedCore(1);
  return {
    weekStart: '2026-08-03',
    state: deriveAthleteState({ core, today: '2026-08-04' }),
    goals: core.goals,
    schedule: { ...core.schedule, availableDays: [1, 2, 3, 4, 5, 6, 7], strengthSessionsPerWeek: 2, conditioningSessionsPerWeek: 2 },
    now: 123,
  };
};

describe('Coordinator', () => {
  it('places default strength and conditioning proposals and never mixes hard interference on a day', () => {
    const out = reconcileWeeklyPlan({
      ...base(),
      proposals: [
        proposal({ id: 'lower', domain: 'strength', title: 'Heavy lower', effort: 'hard', tags: ['heavy_lower'] }),
        proposal({ id: 'hiit', domain: 'conditioning', title: 'Intervals', effort: 'hard', tags: ['high_intensity'] }),
        proposal({ id: 'easy', domain: 'conditioning', title: 'Easy aerobic', effort: 'easy', tags: ['easy_aerobic'] }),
      ],
    });
    expect(out.entries).toHaveLength(3);
    const days = new Map(out.entries.map((x) => [x.title, x.date]));
    expect(days.get('Heavy lower')).not.toBe(days.get('Intervals'));
  });

  it('preserves locked entries and drops lower-priority overflow with a reason', () => {
    const out = reconcileWeeklyPlan({
      ...base(),
      schedule: { ...base().schedule, maxSessionsPerWeek: 1, strengthSessionsPerWeek: 1, conditioningSessionsPerWeek: 1 },
      lockedEntries: [{ id: 'locked', date: '2026-08-03', domain: 'strength', title: 'Locked lift', effort: 'moderate', tags: ['full_body'], locked: true }],
      proposals: [proposal({ id: 'extra', title: 'Optional lift', priority: 'optional' })],
    });
    expect(out.entries.map((x) => x.id)).toContain('locked');
    expect(out.decisions.find((x) => x.proposalId === 'extra')?.reasonCode).toBe('dropped_domain_cap');
  });

  it('does not schedule hard work while illness safety is active', () => {
    const b = base();
    b.state.illness = { status: 'active', source: 'manual' };
    const out = reconcileWeeklyPlan({ ...b, proposals: [proposal({ id: 'hard', effort: 'hard', tags: ['high_intensity'] })] });
    expect(out.entries).toHaveLength(0);
    expect(out.decisions[0]?.reasonCode).toBe('dropped_illness_safety');
  });
});
