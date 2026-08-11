import { describe, expect, it } from 'vitest';
import type { CondResult, Session, Settings } from '@hybrid/engine';
import {
  applyApprovedProposal,
  conditioningProgressionProposal,
  proposalIsStale,
  strengthProgressionProposals,
} from './progression';

const strengthSession = (): Session => ({
  id: 'strength-1',
  kind: 'strength',
  date: '2026-08-08',
  status: 'completed',
  completedAt: 1000,
  blocks: [{
    id: 'main',
    heading: 'Main',
    exercises: [{
      id: 'squat',
      name: 'Back squat',
      mode: 'reps_kg',
      sets: [{ t: '5', rpe: '8', aVal: '100', aVal2: '5', felt: '6', done: true }],
    }],
  }],
});

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
  it('keeps a strength increase proposal separate until approval', () => {
    const settings: Settings = { liftProgress: { 'back squat': { kg: 100, at: 500, reps: 5 } } };
    const [proposal] = strengthProgressionProposals(strengthSession(), settings);

    expect(proposal.direction).toBe('increase');
    expect(proposal.after.kg).toBeGreaterThan(100);
    expect(settings.liftProgress?.['back squat'].kg).toBe(100);

    const approved = applyApprovedProposal(proposal, settings);
    expect(approved.liftProgress?.['back squat']).toEqual(proposal.after);
    expect(settings.liftProgress?.['back squat'].kg).toBe(100);
  });

  it('turns strength progression into review when pain or illness is active', () => {
    const [proposal] = strengthProgressionProposals(strengthSession(), {}, ['Pain hold is active.']);
    expect(proposal.direction).toBe('review');
    expect(() => applyApprovedProposal(proposal, {})).toThrow(/cannot be applied/i);
  });

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

  it('refuses to apply a proposal over a changed accepted prescription', () => {
    const [proposal] = strengthProgressionProposals(strengthSession(), {});
    const changed: Settings = { liftProgress: { 'back squat': { kg: 110, at: 3000, reps: 5 } } };
    expect(proposalIsStale(proposal, changed)).toBe(true);
    expect(() => applyApprovedProposal(proposal, changed)).toThrow(/changed/i);
  });
});
