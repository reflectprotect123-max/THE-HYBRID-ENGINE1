import { describe, it, expect } from 'vitest';
import { detectPr } from './pr';

describe('detectPr', () => {
  it('is a PR when there is no prior best', () => {
    expect(detectPr({ exerciseId: 'sq', reps: 5, loadKg: 100 }, null)).toBe(true);
  });

  it('is a PR when the new load beats the prior best at this rep count', () => {
    expect(detectPr({ exerciseId: 'sq', reps: 5, loadKg: 105 }, 100)).toBe(true);
  });

  it('is not a PR when the new load ties or is below the prior best', () => {
    expect(detectPr({ exerciseId: 'sq', reps: 5, loadKg: 100 }, 100)).toBe(false);
    expect(detectPr({ exerciseId: 'sq', reps: 5, loadKg: 95 }, 100)).toBe(false);
  });
});
