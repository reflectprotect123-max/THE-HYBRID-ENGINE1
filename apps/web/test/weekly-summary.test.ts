import { describe, expect, it } from 'vitest';
import type { Session, Workout } from '@hybrid/engine';
import type { AthleteEvent, RecoveryObservation } from '@hybrid/shared-core';
import { summarizeWeek } from '../src/autocoach/weeklySummary';

const TODAY = '2026-08-06'; // Thursday; week is Aug 3–9

describe('summarizeWeek', () => {
  it('tallies planned/completed/incomplete sessions, pain/illness days and feedback tags within the window', () => {
    const workouts: Workout[] = [
      { id: 'w1', name: 'Squat Day', blocks: [], days: [1] } as Workout, // recurring Monday -> Aug 3
      { id: 'w2', name: 'One-off Row', blocks: [], dates: ['2026-08-07'] } as Workout, // Aug 7
    ];
    const sessions: Session[] = [
      { id: 's1', date: '2026-08-03', status: 'completed', blocks: [] } as Session,
      { id: 's2', date: '2026-08-05', status: 'incomplete', blocks: [] } as Session,
      { id: 's3', date: '2026-07-30', status: 'completed', blocks: [] } as Session, // before the window
    ];
    const recovery: RecoveryObservation[] = [
      { id: 'r1', date: '2026-08-04', painAreas: ['lower back'], source: 'manual', recordedAt: 0 },
      { id: 'r2', date: '2026-08-05', illnessStatus: 'suspected', source: 'manual', recordedAt: 0 },
      { id: 'r3', date: '2026-07-29', painAreas: ['knee'], source: 'manual', recordedAt: 0 }, // before the window
    ];
    const events: AthleteEvent[] = [
      {
        id: 'e1',
        type: 'post_session_feedback',
        occurredAt: '2026-08-03T18:00:00.000Z',
        sourceDomain: 'strength',
        idempotencyKey: 'feedback:s1',
        payload: { sessionId: 's1', tags: ['too_hard', 'loved_session'] },
      },
      {
        id: 'e2',
        type: 'post_session_feedback',
        occurredAt: '2026-08-05T18:00:00.000Z',
        sourceDomain: 'strength',
        idempotencyKey: 'feedback:s2',
        payload: { sessionId: 's2', tags: ['low_energy'] },
      },
      {
        id: 'e3',
        type: 'workout_completed',
        occurredAt: '2026-08-03T18:00:00.000Z',
        sourceDomain: 'strength',
        idempotencyKey: 'wc:s1',
        payload: {},
      }, // wrong type — must not be counted as feedback
      {
        id: 'e4',
        type: 'post_session_feedback',
        occurredAt: '2026-07-30T10:00:00.000Z',
        sourceDomain: 'strength',
        idempotencyKey: 'feedback:old',
        payload: { tags: ['too_easy'] },
      }, // before the window
    ];

    const summary = summarizeWeek(sessions, workouts, recovery, events, TODAY);

    expect(summary.weekStart).toBe('2026-08-03');
    expect(summary.weekEnd).toBe('2026-08-09');
    expect(summary.plannedCount).toBe(2);
    expect(summary.completedCount).toBe(1);
    expect(summary.incompleteCount).toBe(1);
    expect(summary.painDays).toBe(1);
    expect(summary.illnessDays).toBe(1);
    expect(summary.feedbackCount).toBe(2);
    expect(summary.tagCounts).toEqual({ too_hard: 1, loved_session: 1, low_energy: 1 });
  });

  it('reads a quiet week as honest zeros, never a fabricated score', () => {
    const summary = summarizeWeek([], [], [], [], TODAY);
    expect(summary).toMatchObject({
      plannedCount: 0,
      completedCount: 0,
      incompleteCount: 0,
      painDays: 0,
      illnessDays: 0,
      feedbackCount: 0,
      tagCounts: {},
    });
  });
});
