import { describe, expect, it } from 'vitest';
import type { Session } from '@hybrid/engine';
import type { WeeklyPlan } from '@hybrid/coordinator-adapter';
import { buildWeekReview } from './week-review';

const plan: WeeklyPlan = {
  schemaVersion: 1,
  id: 'week-1',
  weekStart: '2026-08-03',
  generatedAt: 1,
  writer: 'coordinator',
  entries: [
    {
      id: 'entry-lift',
      proposalId: 'lift',
      date: '2026-08-04',
      domain: 'strength',
      title: 'Lower strength',
      durationMinutes: 60,
      effort: 'hard',
      tags: ['heavy_lower'],
      locked: false,
    },
  ],
  decisions: [
    { proposalId: 'lift', action: 'scheduled', reasonCode: 'accepted', explanation: 'Accepted.' },
    {
      proposalId: 'intervals',
      action: 'dropped',
      reasonCode: 'dropped_pain_safety',
      explanation: 'Held because pain was reported.',
    },
  ],
};

function session(partial: Partial<Session> & Pick<Session, 'id' | 'date'>): Session {
  return { status: 'completed', blocks: [], ...partial };
}

describe('buildWeekReview', () => {
  it('pairs by stable workout id and keeps plan, actual and decision separate', () => {
    const review = buildWeekReview(
      plan,
      [session({ id: 'actual', date: '2026-08-05', workoutId: 'lift', name: 'Adapted lower' })],
      [],
    );

    expect(review.rows[0]).toMatchObject({
      plannedTitle: 'Lower strength',
      actualTitle: 'Adapted lower',
      status: 'completed',
    });
    expect(review.safetyDrops).toHaveLength(1);
  });

  it('does not silently pair ambiguous work', () => {
    const review = buildWeekReview(
      plan,
      [session({ id: 'other', date: '2026-08-04', name: 'Different session', kind: 'strength' })],
      [],
    );

    expect(review.rows.map((row) => row.status).sort()).toEqual(['planned-not-logged', 'unplanned']);
  });

  it('keeps pain and illness drops out of performance scoring', () => {
    const review = buildWeekReview(plan, [], []);
    expect(review.safetyDrops[0]?.reasonCode).toBe('dropped_pain_safety');
    expect(review.rows[0]?.status).toBe('planned-not-logged');
  });
});
