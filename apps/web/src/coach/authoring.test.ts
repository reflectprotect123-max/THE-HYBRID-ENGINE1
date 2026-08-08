import { describe, expect, it } from 'vitest';
import type { SessionProposal } from '@hybrid/coordinator-adapter';
import { applyProposalInputs, defaultProposalInput } from './authoring';

const proposal: SessionProposal = {
  schemaVersion: 1,
  id: 'strength-a',
  domain: 'strength',
  title: 'Lower strength',
  durationMinutes: 45,
  effort: 'moderate',
  priority: 'preferred',
  goalWeight: 1,
  staleness: 0,
  tags: ['heavy_lower'],
  estimatedLoad: 30,
  minimumSpacingDays: 1,
  sourceEngineVersion: '1',
  sourceDomain: 'strength',
};

describe('coach proposal inputs', () => {
  it('changes allowed inputs without replacing engine evidence', () => {
    const input = { ...defaultProposalInput(proposal), priority: 'must' as const, preferredWeekdays: [5] };
    const [next] = applyProposalInputs([proposal], { [proposal.id]: input });
    expect(next).toMatchObject({ priority: 'must', preferredWeekdays: [5], tags: ['heavy_lower'], estimatedLoad: 30 });
  });

  it('can withhold a proposal without deleting its workout', () => {
    const input = { ...defaultProposalInput(proposal), enabled: false };
    expect(applyProposalInputs([proposal], { [proposal.id]: input })).toEqual([]);
    expect(proposal.id).toBe('strength-a');
  });
});
