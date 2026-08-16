// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { measureFor, MEASURES, fmtEvery, DEFAULT_REST_SEC, DEFAULT_EVERY_SEC } from './ExerciseWizard';

describe('measureFor', () => {
  it('reads reps + weight_kg as reps_weight', () => {
    expect(measureFor('reps', 'weight_kg')).toBe('reps_weight');
  });

  it('reads reps with no second column as reps', () => {
    expect(measureFor('reps', '')).toBe('reps');
  });

  it('reads seconds as seconds regardless of the second column', () => {
    expect(measureFor('seconds', '')).toBe('seconds');
  });

  it('reads meters as distance', () => {
    expect(measureFor('meters', '')).toBe('distance');
  });

  it('falls back to reps for an unrecognised pair', () => {
    expect(measureFor('weight_pct', '')).toBe('reps');
  });
});

describe('MEASURES', () => {
  it('has exactly the four measures the wizard offers, each mapping to a real column pair', () => {
    expect(MEASURES.map((m) => m.key)).toEqual(['reps_weight', 'reps', 'seconds', 'distance']);
    expect(MEASURES.find((m) => m.key === 'reps_weight')).toMatchObject({ columnA: 'reps', columnB: 'weight_kg' });
    expect(MEASURES.find((m) => m.key === 'distance')).toMatchObject({ columnA: 'meters', columnB: '' });
  });
});

describe('fmtEvery', () => {
  it('formats seconds as minutes:seconds, matching the prescription card', () => {
    expect(fmtEvery(150)).toBe('2:30');
    expect(fmtEvery(65)).toBe('1:05');
  });
});

describe('defaults', () => {
  it('keeps the ninety-second rest and two-and-a-half-minute EMOM defaults', () => {
    expect(DEFAULT_REST_SEC).toBe(90);
    expect(DEFAULT_EVERY_SEC).toBe(150);
  });
});
