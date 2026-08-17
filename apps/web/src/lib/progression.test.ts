import { describe, expect, it } from 'vitest';
import type { CondResult, Settings } from '@hybrid/engine';
import {
  applyApprovedProposal,
  conditioningProgressionProposal,
  proposalIsStale,
} from './progression';

/*
 * Strength progression proposals (`strengthProgressionProposals`,
 * `LiftState`) were deleted with the strength engine — see CLAUDE.md. Only
 * conditioning progression coverage survives here now.
 */

const conditioningResult = (mechanicalCompletion: CondResult['mechanicalCompletion'] = 'met'): CondResult => ({
  id: 'conditioning-1',
  fmt: 'intervals',
  felt: 'hard',
  mechanicalCompletion,
  cardioCompletion: 'met',
  zsec: { low: 0, mod: 500, high: 100 },
  dur: 600,
  rec: 70,
  startedAt: 2000,
});

describe('progression proposals', () => {
  it('makes conditioning progression approval-only', () => {
    const settings: Settings = { conProgress: { intervals: { level: 2, miss: 0 } } };
    const proposal = conditioningProgressionProposal(conditioningResult(), settings);
    expect(proposal?.direction).toBe('increase');
    expect(proposal?.after.level).toBe(3);
    expect(settings.conProgress?.intervals.level).toBe(2);
  });

  it('blocks conditioning progression after a reported pain stop', () => {
    const proposal = conditioningProgressionProposal(conditioningResult('pain_stop'), {});
    expect(proposal?.direction).toBe('review');
    expect(proposal?.after).toEqual(proposal?.before);
    expect(proposal?.reason).toMatch(/pain/i);
  });

  it('refuses to apply a conditioning proposal over a changed accepted prescription', () => {
    const settings: Settings = { conProgress: { intervals: { level: 2, miss: 0 } } };
    const proposal = conditioningProgressionProposal(conditioningResult(), settings)!;
    const changed: Settings = { conProgress: { intervals: { level: 5, miss: 0 } } };
    expect(proposalIsStale(proposal, changed)).toBe(true);
    expect(() => applyApprovedProposal(proposal, changed)).toThrow(/changed/i);
  });

  it('applies an approved conditioning proposal', () => {
    const settings: Settings = { conProgress: { intervals: { level: 2, miss: 0 } } };
    const proposal = conditioningProgressionProposal(conditioningResult(), settings)!;
    const approved = applyApprovedProposal(proposal, settings);
    expect(approved.conProgress?.intervals.level).toBe(3);
    expect(settings.conProgress?.intervals.level).toBe(2);
  });

  it('a review-direction proposal cannot be applied', () => {
    const proposal = conditioningProgressionProposal(conditioningResult('pain_stop'), {})!;
    expect(() => applyApprovedProposal(proposal, {})).toThrow(/cannot be applied/i);
  });
});
