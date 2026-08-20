// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { DbProvider } from '../../store/db';
import { CoachProgression } from './CoachProgression';
import { resetProgressionLedgerForTests } from '../../store/progression';
import { FakeCoachWorkspaceRepository, renderCoachScreen, rosterClient } from '../testing/coach-test-harness';
import type { AthleteAutocoachReceipt, AthleteProgressionProposal } from '../data/contracts';

/*
 * docs/RISK_REGISTER.md R8. `CoachProgression`'s roster branch
 * (`RosterProgressionView`) is where a coach approves or declines a REAL
 * athlete's progression proposal — "Approve" never mutates a prescription
 * directly, it only writes a decision the athlete's own device reads and
 * applies on its next sync. A logic bug in the disabled condition, or in
 * what gets removed from the list on decide, fails exactly the way that
 * matters here: either a coach can't approve safe work, or they CAN approve
 * something the backend flagged for direct human review.
 *
 * This also covers the newly-added "What the system adjusted" autocoach
 * receipts panel, which has had zero test coverage since it was built this
 * session.
 */

const CLIENT = rosterClient({ id: 'roster-1', name: 'Riley Roster', source: 'roster-summary' });

function rosterProposal(over: Partial<AthleteProgressionProposal> = {}): AthleteProgressionProposal {
  return {
    id: 'prop-1',
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

function rosterReceipt(over: Partial<AthleteAutocoachReceipt> = {}): AthleteAutocoachReceipt {
  return {
    clientEntryId: 'entry-1',
    occurredAt: '2026-08-02T00:00:00.000Z',
    sessionDate: '2026-08-02',
    workoutId: 'workout-1',
    action: 'applied',
    wasForked: false,
    operations: [{ type: 'cap_intensity', targetPath: 'blocks[0]', reasonCode: 'hard_constraint_active', materiality: 'moderate' }],
    reasonCodes: ['hard_constraint_active'],
    ...over,
  };
}

/**
 * `CoachWorkspaceProvider` resolves `clients` via an async `useEffect`, and
 * `RosterProgressionView` (only mounted once `selectedClient` is the roster
 * client) fires two MORE async effects of its own — `listProgressionProposals`
 * and `listAutocoachReceipts`. Before any of that settles, `CoachProgression`
 * transiently renders a `<Navigate>` (selectedClient is still null, which
 * counts as local) — hence wrapping in `MemoryRouter` even for the roster
 * tests, and `DbProvider` for parity with how the route is actually mounted
 * in `index.tsx`. `act(async () => {})` flushes the whole cascade before any
 * assertion runs, landing on the roster view once `selectedClient` resolves.
 */
async function renderProgression(repository: FakeCoachWorkspaceRepository) {
  const result = renderCoachScreen(
    <DbProvider>
      <MemoryRouter initialEntries={['/coach/progression']}>
        <CoachProgression />
      </MemoryRouter>
    </DbProvider>,
    { repository },
  );
  await act(async () => {});
  return result;
}

beforeEach(() => {
  localStorage.clear();
  resetProgressionLedgerForTests();
});

describe('CoachProgression (roster)', () => {
  it('shows the pain/illness warning and disables Approve for a hard, review-direction proposal; Decline stays enabled', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [CLIENT];
    repo.progressionProposals = [rosterProposal({ hard: true, direction: 'review' })];
    await renderProgression(repo);

    expect(
      screen.getByText('A pain or illness hold was active when this was computed. Route Riley Roster for direct review before approving.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeEnabled();
  });

  it('disables Approve for a review-direction proposal even without a hard flag, and shows no warning copy', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [CLIENT];
    repo.progressionProposals = [rosterProposal({ hard: false, direction: 'review' })];
    await renderProgression(repo);

    expect(screen.queryByText(/pain or illness hold/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeEnabled();
  });

  it('disables Approve for hard:true even paired with a non-review direction — defence-in-depth, not just the direction gate', async () => {
    // hard and direction are independent fields; nothing in this component
    // enforces that a hard proposal always carries direction:'review'. If
    // that pairing invariant ever slipped (a backend change, a bad fixture),
    // Approve must still refuse a pain/illness-blocked proposal on `hard`
    // alone -- this is the regression test for that specific defence.
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [CLIENT];
    repo.progressionProposals = [rosterProposal({ hard: true, direction: 'increase' })];
    await renderProgression(repo);

    expect(screen.getByText(/A pain or illness hold was active/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeEnabled();
  });

  it('approving calls repository.decideProgressionProposal and removes the proposal from the list', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [CLIENT];
    repo.progressionProposals = [rosterProposal({ id: 'prop-approve', direction: 'increase', hard: false })];
    await renderProgression(repo);

    expect(screen.getByText('Back squat')).toBeInTheDocument();
    const approveButton = screen.getByRole('button', { name: 'Approve' });
    await act(async () => {
      fireEvent.click(approveButton);
    });

    expect(repo.decidedProposals).toEqual([{ clientId: 'roster-1', proposalId: 'prop-approve', decision: 'approved' }]);
    expect(screen.queryByText('Back squat')).not.toBeInTheDocument();
    expect(screen.getByText('No pending proposals for Riley Roster')).toBeInTheDocument();
  });

  it('shows the empty state when there are zero pending proposals', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [CLIENT];
    repo.progressionProposals = [];
    await renderProgression(repo);

    expect(screen.getByText('No pending proposals for Riley Roster')).toBeInTheDocument();
  });

  it('does not render the autocoach receipts panel when there are none', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [CLIENT];
    repo.progressionProposals = [rosterProposal()];
    repo.autocoachReceipts = [];
    await renderProgression(repo);

    expect(screen.queryByText('Autonomy · read-only')).not.toBeInTheDocument();
    expect(screen.queryByText(/What the system adjusted/)).not.toBeInTheDocument();
  });

  it('renders the autocoach receipts panel with the mapped operation label when receipts exist', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [CLIENT];
    repo.progressionProposals = [];
    repo.autocoachReceipts = [rosterReceipt()];
    await renderProgression(repo);

    expect(screen.getByText('Autonomy · read-only')).toBeInTheDocument();
    expect(screen.getByText('What the system adjusted for Riley Roster')).toBeInTheDocument();

    const article = screen.getByText('Adjusted in place').closest('article');
    expect(article).not.toBeNull();
    expect(article as HTMLElement).toHaveTextContent('Capped intensity at blocks[0]');
    expect(article as HTMLElement).toHaveTextContent('(moderate · hard constraint active)');
  });

  it('collapses the "What the system adjusted" receipts panel by default on the roster view', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [CLIENT];
    repo.autocoachReceipts = [rosterReceipt()];
    await renderProgression(repo);

    const summary = screen.getByText('What the system adjusted for Riley Roster');
    const details = summary.closest('details');
    expect(details).not.toHaveAttribute('open');
  });
});

/*
 * Task 7 (11 August 2026, amended): the self-coach ledger view this screen
 * used to render moved to the Strength/Conditioning pillar queues, which
 * mount the same `ProgressionActions` from `progression-actions.tsx` (see
 * their own colocated tests). What is left to prove here is that a
 * signed-in coach hitting `/coach/progression` — an old bookmark, the tile
 * that used to point here — lands on the pillar that now owns their view,
 * instead of a page rendering nothing behind a gate that already let them
 * through.
 */
describe('CoachProgression (self-coach)', () => {
  function renderAt(repo: FakeCoachWorkspaceRepository) {
    return renderCoachScreen(
      <DbProvider>
        <MemoryRouter initialEntries={['/coach/progression']}>
          <Routes>
            <Route path="/coach/progression" element={<CoachProgression />} />
            {/* Was /coach/strength until 21 August 2026, when the Strength
                pillar MOVED to reflectprotect123-max/strengthside (repo
                split, Task 2) — Conditioning owns the self-coach queue now. */}
            <Route path="/coach/conditioning" element={<p>Conditioning pillar landed</p>} />
          </Routes>
        </MemoryRouter>
      </DbProvider>,
      { repository: repo },
    );
  }

  it('redirects a local (self-coach) client to /coach/conditioning instead of rendering a ledger here', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [rosterClient({ id: 'engine-local', name: 'Alex Morgan', source: 'engine-local' })];
    renderAt(repo);
    await act(async () => {});

    expect(screen.getByText('Conditioning pillar landed')).toBeInTheDocument();
    expect(screen.queryByText('Decision history')).not.toBeInTheDocument();
  });

  /*
   * The redirect must not fire off the EMPTY first paint. `clients` is []
   * until the fetch settles, which made `selectedClient` null and every
   * visitor look local — including a roster coach, who would be bounced to
   * the self-coach pillar before their own client existed. Harmless while the rail
   * linked here (the click came after the fetch); fatal once the owner
   * removed that link on 11 August 2026 and the address bar became the only
   * way in, because this route is the app's only roster approve/decline.
   */
  it('waits for the client list rather than redirecting a roster coach off the empty first paint', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [rosterClient({ id: 'roster-1', name: 'Riley Roster', source: 'roster-summary' })];
    renderAt(repo);

    // Before the fetch settles: no redirect has happened.
    expect(screen.queryByText('Conditioning pillar landed')).not.toBeInTheDocument();

    await act(async () => {});
    expect(screen.queryByText('Conditioning pillar landed')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Riley Roster.{0,3}s pending proposals/i })).toBeInTheDocument();
  });
});
