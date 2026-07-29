import { describe, expect, it } from 'vitest';
import { canAdvance, nextStep, prevStep, stepsFor } from '../src/builder/flowSteps';

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
    // Conditioning has nowhere to put a note (CondBlock has no such field),
    // so it skips 'more' too and goes straight to review. Metcon's note IS
    // wired to TextBlock.body, so it keeps the 'more' step.
    expect(stepsFor({ blockKind: 'cond', isWarmupSet: false })).toEqual(['block-type', 'review']);
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

describe('canAdvance — what each step requires before moving on', () => {
  const draft = (over: Partial<{ movementName: string; reps: string; rpe: string }> = {}) => ({
    movementName: '', reps: '', rpe: '', ...over,
  });

  it('movement requires a picked movement', () => {
    expect(canAdvance('movement', draft())).toBe(false);
    expect(canAdvance('movement', draft({ movementName: 'Back Squat' }))).toBe(true);
  });

  it('reps requires a target', () => {
    expect(canAdvance('reps', draft())).toBe(false);
    expect(canAdvance('reps', draft({ reps: '8' }))).toBe(true);
  });

  it('rpe requires a value', () => {
    expect(canAdvance('rpe', draft())).toBe(false);
    expect(canAdvance('rpe', draft({ rpe: '8' }))).toBe(true);
  });

  it('sets and the optional more step never block', () => {
    expect(canAdvance('sets', draft())).toBe(true);
    expect(canAdvance('more', draft())).toBe(true);
    expect(canAdvance('block-type', draft())).toBe(true);
  });

  it('whitespace-only input does not count', () => {
    expect(canAdvance('movement', draft({ movementName: '   ' }))).toBe(false);
    expect(canAdvance('reps', draft({ reps: ' ' }))).toBe(false);
  });
});
