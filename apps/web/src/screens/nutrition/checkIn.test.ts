import { describe, expect, it } from 'vitest';
import type { CheckIn } from '@hybrid/nutrition-core';
import type { WeeklyCheckIn } from '@hybrid/nutrition-engine';
import { acceptedDays, checkInRow, completeTarget } from './checkIn';

/*
 * `checkInRow`/`completeTarget`/`acceptedDays` are the pure write-path
 * helpers `CheckIn.tsx` calls from inside its own `update()` — see this
 * file's header. Pinned here the same way `entry.test.ts` pins
 * `entryFromFood` et al. against nutrition-core's builders.
 */

const readyLive: WeeklyCheckIn = {
  status: 'ready',
  estimate: {
    state: 'updating',
    confidence: 'high',
    estimateKcal: 2400,
    rawEstimateKcal: 2380,
    previousEstimateKcal: 2350,
    trendSlopeKgPerWeek: -0.2,
    nutritionDays: 7,
    weightDays: 7,
    windowStart: '2026-08-03',
    windowEnd: '2026-08-09',
    explanation: 'Used a full week of logging and weigh-ins.',
  },
  modules: [{ key: 'program_update', action: 'review and accept the proposed calorie and macro targets' }],
  targets: { calories: 2200, proteinG: 180, carbsG: 220, fatG: 70, macroCalories: 2200 },
  explanation: 'Proposing new targets from this week.',
};

const heldLive: WeeklyCheckIn = {
  status: 'held',
  estimate: {
    state: 'holding',
    confidence: 'low',
    estimateKcal: 2350,
    rawEstimateKcal: null,
    previousEstimateKcal: 2350,
    trendSlopeKgPerWeek: null,
    nutritionDays: 2,
    weightDays: 1,
    windowStart: '2026-08-03',
    windowEnd: '2026-08-09',
    explanation: 'Not enough logging this week to update.',
  },
  modules: [{ key: 'weigh_in', action: 'add a weigh-in for each seven-day period' }],
  targets: null,
  explanation: 'Holding your current targets.',
};

describe('checkInRow', () => {
  it('a ready result maps to a pending row carrying the engine numbers verbatim', () => {
    const row = checkInRow({
      existing: undefined,
      programId: 'program-1',
      weekStart: '2026-08-03',
      weekEnd: '2026-08-09',
      live: readyLive,
      at: '2026-08-10T09:00:00.000Z',
    });
    expect(row.status).toBe('pending');
    expect(row.observedExpenditureKcal).toBe(2380);
    expect(row.proposedExpenditureKcal).toBe(2400);
    expect(row.proposedCalories).toBe(2200);
    expect(row.proposedProteinG).toBe(180);
    expect(row.explanation).toBe(readyLive.explanation);
    expect(row.resolvedAt).toBeNull();
    expect(row.createdAt).toBe('2026-08-10T09:00:00.000Z');
  });

  it('a held result maps to a held row with no proposed targets', () => {
    const row = checkInRow({
      existing: undefined,
      programId: 'program-1',
      weekStart: '2026-08-03',
      weekEnd: '2026-08-09',
      live: heldLive,
      at: '2026-08-10T09:00:00.000Z',
    });
    expect(row.status).toBe('held');
    expect(row.observedExpenditureKcal).toBeNull();
    expect(row.proposedCalories).toBeNull();
  });

  it('an existing row keeps its id and createdAt, and resolvedAt clears on recompute', () => {
    const existing: CheckIn = {
      id: 'checkin-1',
      userId: '',
      programId: 'program-1',
      weekStart: '2026-08-03',
      weekEnd: '2026-08-09',
      status: 'held',
      modules: [],
      explanation: 'earlier',
      createdAt: '2026-08-09T09:00:00.000Z',
      resolvedAt: null,
      updatedAt: '2026-08-09T09:00:00.000Z',
    };
    const row = checkInRow({
      existing,
      programId: 'program-1',
      weekStart: '2026-08-03',
      weekEnd: '2026-08-09',
      live: readyLive,
      at: '2026-08-10T09:00:00.000Z',
    });
    expect(row.id).toBe('checkin-1');
    expect(row.createdAt).toBe('2026-08-09T09:00:00.000Z');
    expect(row.updatedAt).toBe('2026-08-10T09:00:00.000Z');
  });
});

describe('completeTarget', () => {
  it('returns the four macros when the row carries a complete proposal', () => {
    const row = checkInRow({
      existing: undefined,
      programId: 'program-1',
      weekStart: '2026-08-03',
      weekEnd: '2026-08-09',
      live: readyLive,
      at: '2026-08-10T09:00:00.000Z',
    });
    expect(completeTarget(row)).toEqual({ calories: 2200, proteinG: 180, carbsG: 220, fatG: 70 });
  });

  it('returns null when any of the four proposed fields is missing', () => {
    const row = checkInRow({
      existing: undefined,
      programId: 'program-1',
      weekStart: '2026-08-03',
      weekEnd: '2026-08-09',
      live: heldLive,
      at: '2026-08-10T09:00:00.000Z',
    });
    expect(completeTarget(row)).toBeNull();
  });
});

describe('acceptedDays', () => {
  it('writes seven consecutive MacroProgramDay rows starting at the given date, provenanced to the accepted check-in', () => {
    const days = acceptedDays('program-1', '2026-08-10', { calories: 2200, proteinG: 180, carbsG: 220, fatG: 70 }, '2026-08-09T20:00:00.000Z');
    expect(days).toHaveLength(7);
    expect(days[0]?.targetDate).toBe('2026-08-10');
    expect(days[6]?.targetDate).toBe('2026-08-16');
    for (const day of days) {
      expect(day.programId).toBe('program-1');
      expect(day.source).toBe('accepted_check_in');
      expect(day.calories).toBe(2200);
      expect(day.createdAt).toBe('2026-08-09T20:00:00.000Z');
    }
  });
});
