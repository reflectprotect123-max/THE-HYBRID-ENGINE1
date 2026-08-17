import { describe, expect, it } from 'vitest';
import type { Concept2Result, Session, Workout } from '@hybrid/engine';
import { ergTrend, weeklyHardBudget } from './trends';

const TODAY = '2026-08-06'; // Thursday; week is Aug 3–9

/*
 * Lift trends (`liftTrends`/`liftTrendSummary`) were deleted with the
 * strength engine — see CLAUDE.md. Only conditioning (`ergTrend`,
 * `weeklyHardBudget`) coverage survives here now.
 */

function condSession(date: string, name: string, effort: 'easy' | 'hard'): Session {
  return {
    id: `s-${date}-${name}`,
    date,
    status: 'completed',
    name,
    kind: 'conditioning',
    blocks: [{ id: 'c1', kind: 'conditioning', condFmt: 'intervals', effort }],
  } as unknown as Session;
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
    const logged = condSession('2026-08-03', 'Heavy Row', 'hard');
    const { count, budget } = weeklyHardBudget([hardWorkout], [logged], TODAY, 4);
    expect(count).toBe(2);
    expect(budget).toBe(4);
  });

  it('does not double-count a planned workout already logged that day', () => {
    const loggedIntervals = condSession('2026-08-07', 'Intervals', 'hard');
    const { count } = weeklyHardBudget([hardWorkout], [loggedIntervals], TODAY, 3);
    expect(count).toBe(1);
  });
});
