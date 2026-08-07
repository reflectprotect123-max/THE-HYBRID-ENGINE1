import { describe, expect, it } from 'vitest';
import { canAdvance, nextStep, prevStep, stepsFor, type FlowDraft } from './flowSteps';

const draft = (over: Partial<FlowDraft> = {}): FlowDraft => ({
  movementName: '', reps: '', rpe: '', condFmt: '', text: '', ...over,
});

describe('stepsFor', () => {
  it('a lift block walks movement through RPE', () => {
    expect(stepsFor({ blockKind: 'lift', isWarmupSet: false })).toEqual([
      'block-type', 'movement', 'sets', 'reps', 'rpe',
    ]);
  });

  it('a warm-up SET skips the RPE step entirely', () => {
    expect(stepsFor({ blockKind: 'lift', isWarmupSet: true })).toEqual([
      'block-type', 'movement', 'sets', 'reps',
    ]);
  });

  it('a conditioning block goes straight to its detail step', () => {
    expect(stepsFor({ blockKind: 'cond', isWarmupSet: false })).toEqual(['block-type', 'cond-detail']);
  });

  it('a warm-up/cooldown BLOCK and a metcon/notes block are both a single text step', () => {
    expect(stepsFor({ blockKind: 'warmup', isWarmupSet: false })).toEqual(['block-type', 'text']);
    expect(stepsFor({ blockKind: 'metcon', isWarmupSet: false })).toEqual(['block-type', 'text']);
  });
});

describe('nextStep / prevStep', () => {
  const lift = { blockKind: 'lift' as const, isWarmupSet: false };

  it('walks forward through the sequence', () => {
    expect(nextStep('block-type', lift)).toBe('movement');
    expect(nextStep('movement', lift)).toBe('sets');
    expect(nextStep('sets', lift)).toBe('reps');
    expect(nextStep('reps', lift)).toBe('rpe');
  });

  it('is null past the last step — the orchestrator commits the block here', () => {
    expect(nextStep('rpe', lift)).toBeNull();
  });

  it('walks backward, and is null before the first step', () => {
    expect(prevStep('sets', lift)).toBe('movement');
    expect(prevStep('block-type', lift)).toBeNull();
  });

  it('adapts mid-flow when isWarmupSet flips between reps and rpe', () => {
    // Sitting on 'reps' and the athlete ticks "this is a warm-up" before
    // advancing: RPE should no longer be next.
    const warm = { blockKind: 'lift' as const, isWarmupSet: true };
    expect(nextStep('reps', warm)).toBeNull();
  });
});

describe('canAdvance — what each step requires before moving on', () => {
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

  it('cond-detail requires a picked format', () => {
    expect(canAdvance('cond-detail', draft())).toBe(false);
    expect(canAdvance('cond-detail', draft({ condFmt: 'steady' }))).toBe(true);
  });

  it('text requires actual content — an empty warm-up/metcon note is not worth a block', () => {
    expect(canAdvance('text', draft())).toBe(false);
    expect(canAdvance('text', draft({ text: '10 min bike' }))).toBe(true);
  });

  it('sets and block-type never block', () => {
    expect(canAdvance('sets', draft())).toBe(true);
    expect(canAdvance('block-type', draft())).toBe(true);
  });

  it('whitespace-only input does not count', () => {
    expect(canAdvance('movement', draft({ movementName: '   ' }))).toBe(false);
    expect(canAdvance('reps', draft({ reps: ' ' }))).toBe(false);
    expect(canAdvance('text', draft({ text: '  \n ' }))).toBe(false);
  });
});
