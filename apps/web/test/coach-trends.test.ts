import { describe, expect, it } from 'vitest';
import type { Concept2Result, Session, Workout } from '@hybrid/engine';
import { ergTrend, liftTrends, weeklyHardBudget } from '../src/coach/trends';

const TODAY = '2026-08-06'; // Thursday; week is Aug 3–9

function liftSession(date: string, name: string, kg: number, reps: number): Session {
  return {
    id: `s-${date}-${name}`,
    date,
    status: 'completed',
    blocks: [
      {
        id: 'b1',
        exercises: [
          {
            id: 'e1',
            name,
            mode: 'reps_kg',
            sets: [{ t: String(reps), rpe: '8', aVal: String(kg), aVal2: String(reps), done: true }],
          },
        ],
      },
    ],
  } as Session;
}

function c2(startedAt: string, distanceRaw: number, seconds: number, modality = 'rower'): Concept2Result {
  return {
    provider: 'concept2',
    externalId: startedAt,
    providerUserId: null,
    modality,
    startedAt,
    durationRaw: seconds * 10, // tenths of a second
    distanceRaw,
    durationDisplay: null,
    workoutType: 'unknown',
  };
}

describe('liftTrends', () => {
  it('windows weekly bests and computes the delta from first to latest', () => {
    const sessions = [
      liftSession('2026-07-13', 'Back Squat', 140, 5),
      liftSession('2026-07-20', 'Back Squat', 145, 5),
      liftSession('2026-07-27', 'Back Squat', 150, 5),
      liftSession('2026-08-03', 'Back Squat', 152.5, 5),
    ];
    const [squat] = liftTrends(sessions, TODAY);
    expect(squat).toBeDefined();
    expect(squat!.label).toBe('Back Squat');
    expect(squat!.points.filter((p) => p != null)).toHaveLength(4);
    // Epley at 5 reps: kg * (1 + 5/30); delta ≈ (152.5 − 140) * 7/6
    expect(squat!.delta).toBeCloseTo(14.6, 1);
  });

  it('requires three exposures before a lift earns a trend', () => {
    const sessions = [
      liftSession('2026-07-27', 'Bench Press', 100, 5),
      liftSession('2026-08-03', 'Bench Press', 102.5, 5),
    ];
    expect(liftTrends(sessions, TODAY)).toEqual([]);
  });
});

describe('ergTrend', () => {
  it('groups by modality and distance and converts tenths to pace per 500m', () => {
    const results = [
      c2('2026-07-01T10:00:00Z', 2000, 440),
      c2('2026-07-15T10:00:00Z', 2000, 432),
      c2('2026-08-01T10:00:00Z', 2000, 424),
      c2('2026-07-20T10:00:00Z', 5000, 1180), // different test — must not pollute
    ];
    const t = ergTrend(results)!;
    expect(t.label).toBe('2000m rower');
    expect(t.points).toEqual([110, 108, 106]); // 440s over 4×500m = 110 s/500m
    expect(t.latest).toBe(106);
    expect(t.delta).toBe(-4); // negative = faster
  });

  it('returns null below three comparable tests', () => {
    expect(ergTrend([c2('2026-07-01T10:00:00Z', 2000, 440), c2('2026-07-15T10:00:00Z', 2000, 432)])).toBeNull();
  });
});

describe('weeklyHardBudget', () => {
  const hardWorkout: Workout = {
    id: 'w1',
    name: 'Intervals',
    kind: 'conditioning',
    days: [5], // Fridays — Aug 7 is in the current week, future
    blocks: [{ id: 'c1', kind: 'conditioning', condFmt: 'intervals', effort: 'hard' }],
  } as Workout;

  it('counts logged hard sessions and future planned hard occurrences', () => {
    const logged = liftSession('2026-08-03', 'Heavy Lower', 150, 5); // rpe 8 → hard
    const { count, budget } = weeklyHardBudget([hardWorkout], [logged], TODAY, 4);
    expect(count).toBe(2);
    expect(budget).toBe(4);
  });

  it('does not double-count a planned workout already logged that day', () => {
    const loggedIntervals = {
      ...liftSession('2026-08-07', 'Intervals', 0, 0),
      name: 'Intervals',
      kind: 'conditioning',
      blocks: [{ id: 'c2', kind: 'conditioning', condFmt: 'intervals', effort: 'hard' }],
    } as unknown as Session;
    const { count } = weeklyHardBudget([hardWorkout], [loggedIntervals], TODAY, 3);
    expect(count).toBe(1);
  });
});
