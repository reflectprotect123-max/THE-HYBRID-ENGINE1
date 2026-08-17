import { describe, expect, it } from 'vitest';
import { canAdvance, nextStep, prevStep, stepsFor, type FlowDraft } from './flowSteps';

const draft = (over: Partial<FlowDraft> = {}): FlowDraft => ({
  condFmt: '', text: '', ...over,
});

describe('stepsFor', () => {
  it('a conditioning block goes straight to its detail step', () => {
    expect(stepsFor({ blockKind: 'cond' })).toEqual(['block-type', 'cond-detail']);
  });

  it('a warm-up/cooldown BLOCK and a metcon/notes block are both a single text step', () => {
    expect(stepsFor({ blockKind: 'warmup' })).toEqual(['block-type', 'text']);
    expect(stepsFor({ blockKind: 'metcon' })).toEqual(['block-type', 'text']);
  });
});

describe('nextStep / prevStep', () => {
  const cond = { blockKind: 'cond' as const };

  it('walks forward through the sequence', () => {
    expect(nextStep('block-type', cond)).toBe('cond-detail');
  });

  it('is null past the last step — the orchestrator commits the block here', () => {
    expect(nextStep('cond-detail', cond)).toBeNull();
  });

  it('walks backward, and is null before the first step', () => {
    expect(prevStep('cond-detail', cond)).toBe('block-type');
    expect(prevStep('block-type', cond)).toBeNull();
  });
});

describe('canAdvance — what each step requires before moving on', () => {
  it('cond-detail requires a picked format', () => {
    expect(canAdvance('cond-detail', draft())).toBe(false);
    expect(canAdvance('cond-detail', draft({ condFmt: 'steady' }))).toBe(true);
  });

  it('text requires actual content — an empty warm-up/metcon note is not worth a block', () => {
    expect(canAdvance('text', draft())).toBe(false);
    expect(canAdvance('text', draft({ text: '10 min bike' }))).toBe(true);
  });

  it('block-type never blocks', () => {
    expect(canAdvance('block-type', draft())).toBe(true);
  });

  it('whitespace-only input does not count', () => {
    expect(canAdvance('text', draft({ text: '  \n ' }))).toBe(false);
  });
});
