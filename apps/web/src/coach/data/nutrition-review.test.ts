import { describe, expect, it } from 'vitest';
import { emptyNutritionDB, type MacroProgram } from '@hybrid/nutrition-core';
import { buildCoachNutritionReview } from './nutrition-review';

const program: MacroProgram = {
  id: 'program',
  userId: '',
  name: 'Maintain',
  mode: 'manual',
  goal: 'maintain',
  targetRateKgPerWeek: 0,
  startDate: '2026-08-03',
  status: 'active',
  days: [],
  createdAt: '2026-08-03T00:00:00.000Z',
  updatedAt: '2026-08-03T00:00:00.000Z',
};

describe('coach nutrition review', () => {
  it('keeps an empty week explicit instead of reading it as zero intake', () => {
    const review = buildCoachNutritionReview(emptyNutritionDB(), '2026-08-06');
    expect(review.days).toHaveLength(7);
    expect(review.days.every((day) => day.status === 'unlogged' && day.entryCount === 0)).toBe(true);
    expect(review.exceptions.map((exception) => exception.id)).toContain('no-program');
  });

  it('preserves athlete-declared partial and fasted states', () => {
    const db = emptyNutritionDB();
    db.program = program;
    db.dayStatus = [
      { userId: '', logDate: '2026-08-04', status: 'partial', updatedAt: '2026-08-04T00:00:00.000Z' },
      { userId: '', logDate: '2026-08-05', status: 'fasted', updatedAt: '2026-08-05T00:00:00.000Z' },
    ];
    const review = buildCoachNutritionReview(db, '2026-08-06');
    expect(review.days.find((day) => day.date === '2026-08-04')?.status).toBe('partial');
    expect(review.days.find((day) => day.date === '2026-08-05')?.status).toBe('fasted');
    expect(review.exceptions.map((exception) => exception.id)).not.toContain('no-program');
  });
});
