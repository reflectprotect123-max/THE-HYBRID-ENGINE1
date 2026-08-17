// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { LS_KEY } from '@hybrid/engine';
import { DbProvider } from '../../store/db';
import { ProgressionActions, RosterProgressionActions } from './progression-actions';
import { resetProgressionLedgerForTests } from '../../store/progression';
import type { ConditioningProgressionProposal } from '../../lib/progression';
import type { AthleteProgressionProposal } from '../data/contracts';
import { FakeCoachWorkspaceRepository, renderCoachScreen, rosterClient } from '../testing/coach-test-harness';

const LEDGER_KEY = 'hybrid-coach-progression-v1';

function ledgerDecisions(): unknown[] {
  const raw = JSON.parse(localStorage.getItem(LEDGER_KEY) ?? 'null');
  return raw?.decisions ?? [];
}

function conditioningProposal(over: Partial<ConditioningProgressionProposal> = {}): ConditioningProgressionProposal {
  return {
    id: 'cond-1',
    domain: 'conditioning',
    subject: 'Row 2k',
    sourceId: 'result-1',
    sourceAt: Date.now(),
    createdAt: Date.now(),
    direction: 'hold',
    status: 'pending',
    intent: 'Set the next prescription level for this exact format and modality.',
    reason: 'Held: completion was borderline.',
    evidence: ['Completion: full'],
    confidence: 'medium',
    dataLimitations: [],
    ruleVersion: 'progression-proposal-v1',
    authority: 'coach-approval-required',
    before: { level: 0, miss: 0 },
    after: { level: 0, miss: 0 },
    key: 'row_2k',
    ...over,
  };
}

function seedHardConstraint() {
  const db = {
    workouts: [],
    sessions: [],
    settings: {},
    core: { safety: { painHold: { active: true, areas: ['knee'], updatedAt: Date.now() } } },
  };
  localStorage.setItem(LS_KEY, JSON.stringify(db));
}

function renderSelfCoach(proposal: ConditioningProgressionProposal) {
  return render(
    <DbProvider>
      <ProgressionActions proposal={proposal} />
    </DbProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  resetProgressionLedgerForTests();
});

describe('ProgressionActions (self-coach)', () => {
  it('guard 1 — refuses to approve a proposal flagged for review', () => {
    renderSelfCoach(conditioningProposal({ direction: 'review' }));
    expect(screen.getByRole('button', { name: /approve/i })).toBeDisabled();
  });

  it('guard 2 — refuses to approve while a hard whole-athlete-state constraint is active, even for an increase', () => {
    seedHardConstraint();
    // before === current default ({level:0,miss:0}) so this proposal is not ALSO stale — isolates the hard-safety guard.
    renderSelfCoach(conditioningProposal({ direction: 'increase', before: { level: 0, miss: 0 } }));
    expect(screen.getByRole('button', { name: /approve/i })).toBeDisabled();
  });

  it('guard 2 — NAMES every blocking constraint and its adjustment, not just that one exists', () => {
    // Promoted from a deferred minor by the Stage-1 final review: this line
    // is the only acknowledgement of a hard constraint left in the reachable
    // workspace, and "Blocked while a hard safety constraint is active."
    // named neither the constraint nor what the engine says to do instead.
    // Both members of the safety class are seeded, because a `find`-shaped
    // read of the constraint list would show one and drop the other.
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        workouts: [],
        sessions: [],
        settings: {},
        core: {
          safety: {
            painHold: { active: true, areas: ['knee'], updatedAt: Date.now() },
            illness: { status: 'active', updatedAt: Date.now() },
          },
        },
      }),
    );
    renderSelfCoach(conditioningProposal({ direction: 'increase', before: { level: 0, miss: 0 } }));

    expect(screen.getByText(/Pain hold: knee\./)).toBeInTheDocument();
    expect(screen.getByText(/Do not push through the flagged pain/)).toBeInTheDocument();
    expect(screen.getByText(/A manual or observed illness flag is active\./)).toBeInTheDocument();
    expect(screen.getByText(/follow the return-to-training process/)).toBeInTheDocument();
  });

  it('guard 3 — refuses to approve a stale proposal whose accepted prescription changed since it was computed', () => {
    // Default DB has no accepted row_2k baseline (current === {level:0,miss:0}). A
    // proposal computed against a different baseline is therefore stale.
    renderSelfCoach(conditioningProposal({ direction: 'increase', before: { level: 2, miss: 0 } }));
    expect(screen.getByRole('button', { name: /approve/i })).toBeDisabled();
  });

  it('guard 4 — records no decision, for any of approve/reject/hold, without a rationale', () => {
    const proposal = conditioningProposal();
    renderSelfCoach(proposal);

    fireEvent.click(screen.getByRole('button', { name: /reject/i }));
    expect(screen.getByText('Add a rationale before closing this proposal.')).toBeInTheDocument();
    expect(ledgerDecisions()).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: /hold/i }));
    expect(ledgerDecisions()).toHaveLength(0);
  });

  it('records an approval once a rationale is present and no guard blocks it', () => {
    const proposal = conditioningProposal({ direction: 'hold' });
    renderSelfCoach(proposal);

    fireEvent.change(screen.getByLabelText(/coach rationale/i), { target: { value: 'Athlete plateaued, holding is right.' } });
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));

    expect(screen.getByText(`${proposal.subject}: accepted prescription updated.`)).toBeInTheDocument();
    const decisions = ledgerDecisions() as { decision: string; applied: boolean; rationale: string }[];
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ decision: 'approved', applied: true, rationale: 'Athlete plateaued, holding is right.' });
  });

  it('records a rejection without touching the accepted prescription, once a rationale is present', () => {
    const proposal = conditioningProposal();
    renderSelfCoach(proposal);

    fireEvent.change(screen.getByLabelText(/coach rationale/i), { target: { value: 'Not ready yet.' } });
    fireEvent.click(screen.getByRole('button', { name: /reject/i }));

    expect(screen.getByText(`${proposal.subject}: rejected. The accepted prescription was not changed.`)).toBeInTheDocument();
    const decisions = ledgerDecisions() as { decision: string; applied: boolean }[];
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ decision: 'rejected', applied: false });
  });
});

function rosterProposal(over: Partial<AthleteProgressionProposal> = {}): AthleteProgressionProposal {
  return {
    id: 'roster-prop-1',
    domain: 'strength',
    subject: 'Back squat',
    clientKey: 'back_squat',
    before: { kg: 100, reps: 5 },
    after: { kg: 102.5, reps: 5 },
    confidence: 'high',
    hard: false,
    direction: 'increase',
    createdAt: '2026-08-01T00:00:00.000Z',
    ...over,
  };
}

describe('RosterProgressionActions', () => {
  it('guard 1 — refuses to approve a review-direction proposal', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [rosterClient()];
    renderCoachScreen(
      <RosterProgressionActions clientId="roster-1" clientName="Riley Roster" proposal={rosterProposal({ direction: 'review' })} />,
      { repository: repo },
    );
    await act(async () => {});
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
  });

  it('guard 2 — refuses to approve a hard-flagged proposal even paired with a non-review direction (defence-in-depth)', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [rosterClient()];
    renderCoachScreen(
      <RosterProgressionActions clientId="roster-1" clientName="Riley Roster" proposal={rosterProposal({ hard: true, direction: 'increase' })} />,
      { repository: repo },
    );
    await act(async () => {});
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeEnabled();
  });

  it('approving calls repository.decideProgressionProposal and reports the decision back via onDecided', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [rosterClient()];
    const decided: { proposalId: string; decision: string }[] = [];
    renderCoachScreen(
      <RosterProgressionActions
        clientId="roster-1"
        clientName="Riley Roster"
        proposal={rosterProposal({ id: 'prop-approve' })}
        onDecided={(proposalId, decision) => decided.push({ proposalId, decision })}
      />,
      { repository: repo },
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    });

    expect(repo.decidedProposals).toEqual([{ clientId: 'roster-1', proposalId: 'prop-approve', decision: 'approved' }]);
    expect(decided).toEqual([{ proposalId: 'prop-approve', decision: 'approved' }]);
  });
});
