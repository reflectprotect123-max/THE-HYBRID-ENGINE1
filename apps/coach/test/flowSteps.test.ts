import { describe, expect, it } from 'vitest';
import { nextStep, prevStep, stepsFor } from '../src/builder/flowSteps';

describe('stepsFor', () => {
  it('a lift block walks movement through review, including RPE', () => {
    expect(stepsFor({ blockKind: 'lift', isWarmupSet: false })).toEqual([
      'block-type', 'movement', 'sets', 'reps', 'rpe', 'more', 'review',
    ]);
  });

  it('a warm-up SET skips the RPE step entirely', () => {
    expect(stepsFor({ blockKind: 'lift', isWarmupSet: true })).toEqual([
      'block-type', 'movement', 'sets', 'reps', 'more', 'review',
    ]);
  });

  it('conditioning and metcon blocks skip movement/sets/reps/rpe entirely', () => {
    expect(stepsFor({ blockKind: 'cond', isWarmupSet: false })).toEqual(['block-type', 'more', 'review']);
    expect(stepsFor({ blockKind: 'metcon', isWarmupSet: false })).toEqual(['block-type', 'more', 'review']);
  });
});

describe('nextStep / prevStep', () => {
  const lift = { blockKind: 'lift' as const, isWarmupSet: false };

  it('walks forward through the sequence', () => {
    expect(nextStep('block-type', lift)).toBe('movement');
    expect(nextStep('movement', lift)).toBe('sets');
  });

  it('is null past the last step', () => {
    expect(nextStep('review', lift)).toBeNull();
  });

  it('walks backward, and is null before the first step', () => {
    expect(prevStep('sets', lift)).toBe('movement');
    expect(prevStep('block-type', lift)).toBeNull();
  });

  it('adapts mid-flow when isWarmupSet flips between reps and more', () => {
    // Sitting on 'reps' and the coach flips the set to a warm-up before
    // advancing: the RPE step should no longer be next.
    const warm = { blockKind: 'lift' as const, isWarmupSet: true };
    expect(nextStep('reps', warm)).toBe('more');
  });
});
