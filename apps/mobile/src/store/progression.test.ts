import type { ProgressionProposal } from '../lib/progression';
import {
  pendingProgressionProposals,
  progressionLedger,
  recordProgressionProposals,
  resetProgressionLedgerForTests,
} from './progression';

const proposal = (id: string): ProgressionProposal => ({
  id,
  domain: 'conditioning',
  subject: 'Intervals',
  sourceId: 's-1',
  sourceAt: 1000,
  createdAt: 2000,
  direction: 'increase',
  status: 'pending',
  intent: 'Set the next prescription level for this exact format and modality.',
  reason: 'On target.',
  evidence: [],
  confidence: 'high',
  dataLimitations: [],
  ruleVersion: 'progression-proposal-v1',
  authority: 'coach-approval-required',
  before: { level: 1, miss: 0 },
  after: { level: 2, miss: 0 },
  key: 'intervals',
});

beforeEach(() => resetProgressionLedgerForTests());

describe('the progression ledger', () => {
  it('records a proposal once — a re-banked session with the same derived id is a no-op', () => {
    recordProgressionProposals([proposal('p1')]);
    recordProgressionProposals([proposal('p1')]);
    expect(progressionLedger().proposals).toHaveLength(1);
  });

  it('newest first, and every undecided proposal is pending for the push', () => {
    recordProgressionProposals([proposal('p1')]);
    recordProgressionProposals([proposal('p2')]);
    expect(progressionLedger().proposals.map((p) => p.id)).toEqual(['p2', 'p1']);
    expect(pendingProgressionProposals().map((p) => p.id)).toEqual(['p2', 'p1']);
  });

  it('caps the ledger so a long-lived account cannot grow it without bound', () => {
    for (let i = 0; i < 230; i += 1) recordProgressionProposals([proposal(`p${i}`)]);
    expect(progressionLedger().proposals.length).toBeLessThanOrEqual(200);
    // The newest survive; the oldest fall off the tail.
    expect(progressionLedger().proposals[0].id).toBe('p229');
  });
});
