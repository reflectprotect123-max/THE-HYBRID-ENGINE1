import { describe, it, expect } from 'vitest';
import { e1rm } from './e1rm';

describe('e1rm', () => {
  it('returns the load unchanged at 1 rep', () => {
    expect(e1rm(140, 1)).toBe(140);
  });

  it('computes Epley by default', () => {
    expect(e1rm(100, 5)).toBeCloseTo(100 * (1 + 5 / 30), 5);
  });

  it('computes Brzycki when requested', () => {
    expect(e1rm(100, 5, 'brzycki')).toBeCloseTo(100 * (36 / (37 - 5)), 5);
  });

  it('falls back to Epley above Brzycki\'s valid rep range', () => {
    const brzycki = e1rm(100, 40, 'brzycki');
    const epley = e1rm(100, 40, 'epley');
    expect(brzycki).toBeCloseTo(epley, 5);
  });

  it('throws for zero or negative reps', () => {
    expect(() => e1rm(100, 0)).toThrow();
    expect(() => e1rm(100, -1)).toThrow();
  });
});
