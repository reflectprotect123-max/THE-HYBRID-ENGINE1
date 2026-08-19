import type { CondResult, Settings } from '@hybrid/engine';
import {
  applyApprovedProposal,
  conditioningProgressionProposal,
  proposalIsStale,
} from './progression';

/*
 * MIRRORS apps/web/src/lib/progression.test.ts case for case, because this
 * file is a deliberate duplicate of the web's (see its own header): both
 * clients mint proposals into the same server table, so the rules must not
 * drift. If a case is added on one side, add it on the other.
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

  it('derives a stable id from the session and key, so re-banking cannot mint a second proposal', () => {
    const a = conditioningProgressionProposal(conditioningResult(), {})!;
    const b = conditioningProgressionProposal(conditioningResult(), {})!;
    expect(a.id).toBe(b.id);
    expect(a.id).toBe('conditioning:conditioning-1:intervals');
  });
});
