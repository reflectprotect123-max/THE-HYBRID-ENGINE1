import { describe, expect, it } from 'vitest';
import { conditioningToProposal } from '../src';

describe('Conditioning Engine boundary', () => {
  it('emits modality-aware intensity and interference tags', () => {
    const out = conditioningToProposal({ id: 'c1', modality: 'Echo Bike V3', format: 'intervals', effort: 'hard' });
    expect(out.domain).toBe('conditioning');
    expect(out.effort).toBe('hard');
    expect(out.tags).toEqual(['high_intensity']);
    expect(out.sourceDomain).toBe('conditioning');
  });
});
