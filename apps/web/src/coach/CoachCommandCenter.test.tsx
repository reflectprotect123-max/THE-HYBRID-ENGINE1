// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DbProvider } from '../store/db';
import { NutritionProvider } from '../store/nutrition';
import { CoachCommandCenter } from './CoachCommandCenter';
import { resetProgressionLedgerForTests } from './progression-store';
import { FakeCoachWorkspaceRepository, renderCoachScreen, rosterClient } from './coach-test-harness';
import type { AthleteProgressionProposal } from './contracts';

/*
 * docs/RISK_REGISTER.md R8. CoachCommandCenter is the one coach-bench screen
 * that is NOT fully behind `ClientDetailGate` — its client-overview sections
 * render for every client, so the "resolved week" and "operating context"
 * sections gate themselves individually on `isLocalClient`
 * (checks/coach-contract.mjs's static check "CoachCommandCenter's
 * local-only sections stay behind isLocalClient"). That check only proves
 * the `isLocalClient` token appears near the risky read in source — it
 * cannot prove the branch actually renders correctly for both a real roster
 * client and the signed-in athlete. A gate-inversion bug here is exactly the
 * failure named in the component's own comment: "renders the coach's own
 * records under a client's name."
 *
 * `AthleteStatus` (one of the three risky markers the static check watches)
 * pulls in `useConcept2()`/`useSync()`, which need `Concept2Provider` and
 * `SyncProvider` — real network/Supabase wiring that has nothing to do with
 * CoachCommandCenter's OWN gating logic. It is mocked here to a plain marker
 * so this test exercises exactly what CoachCommandCenter is responsible for:
 * whether that section renders at all for a given client, not what
 * AthleteStatus does internally once it does.
 */
vi.mock('./AthleteStatus', () => ({
  AthleteStatus: () => <div>MOCKED_ATHLETE_STATUS</div>,
}));

const ENGINE_LOCAL_CLIENT = rosterClient({
  id: 'engine-local',
  name: 'Alex Morgan',
  initials: 'AM',
  source: 'engine-local',
  completion: {
    strength: { completed: 3, planned: 4 },
    conditioning: { completed: 2, planned: 3 },
    nutritionDays: 5,
    checkInDays: 6,
  },
});

const ROSTER_CLIENT = rosterClient({
  id: 'roster-9',
  name: 'Riley Roster',
  initials: 'RR',
  source: 'roster-summary',
  completion: {
    strength: { completed: 1, planned: 2 },
    conditioning: { completed: 0, planned: 2 },
    nutritionDays: 3,
    checkInDays: 4,
  },
});

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

/**
 * `CoachWorkspaceProvider` resolves `clients`/`selectedClient` via an async
 * `useEffect`, same as every other roster screen in this batch — see
 * ArcCoachFrame.test.tsx's `renderFrame()` for why `act(async () => {})`
 * after `render()` is required before any assertion.
 *
 * `CoachCommandCenter` also reads `useDb()` (resolved week, readiness) and
 * `useNutrition()` (the nutrition system row) directly, for every client —
 * not just `engine-local` — so both providers are always required, not only
 * for the local-athlete branch.
 */
async function renderCommandCenter(repository: FakeCoachWorkspaceRepository) {
  const result = renderCoachScreen(
    <DbProvider>
      <NutritionProvider>
        <MemoryRouter initialEntries={['/coach']}>
          <CoachCommandCenter />
        </MemoryRouter>
      </NutritionProvider>
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

describe('CoachCommandCenter', () => {
  it('lists every client from the repository with their own summary counts, and switching clients updates the overview', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [ENGINE_LOCAL_CLIENT, ROSTER_CLIENT];
    await renderCommandCenter(repo);

    // Both clients are listed in the roster strip.
    expect(screen.getByRole('button', { name: /Alex Morgan/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Riley Roster/ })).toBeInTheDocument();

    // Default selection (no prior localStorage pick) is engine-local, and its
    // own summary counts are the ones on screen.
    expect(screen.getByRole('heading', { name: 'Alex Morgan' })).toBeInTheDocument();
    expect(screen.getByText('3 of 4')).toBeInTheDocument();
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
    expect(screen.getByText('5 of 7 days')).toBeInTheDocument();
    expect(screen.getByText('6 of 7')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Riley Roster/ }));
    });

    // Selecting the other client swaps the overview to THEIR counts, not a
    // merge or a stale leftover of the first client's numbers.
    expect(screen.getByRole('heading', { name: 'Riley Roster' })).toBeInTheDocument();
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
    expect(screen.getByText('0 of 2')).toBeInTheDocument();
    expect(screen.getByText('3 of 7 days')).toBeInTheDocument();
    expect(screen.getByText('4 of 7')).toBeInTheDocument();
    expect(screen.queryByText('3 of 4')).not.toBeInTheDocument();
    expect(screen.queryByText('5 of 7 days')).not.toBeInTheDocument();
  });

  it('shows the local-only resolved-week and readiness sections for the signed-in athlete (engine-local)', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [ENGINE_LOCAL_CLIENT];
    await renderCommandCenter(repo);

    // `weeklyPlan.entries.map` branch: a fresh, empty local DB resolves to no
    // entries, which is its own distinct empty state — not the roster refusal.
    expect(
      screen.getByText('No sessions resolved. Inspect safety, schedule and proposal inputs; do not invent a plan.'),
    ).toBeInTheDocument();
    // `athleteState.readiness.band` branch.
    expect(screen.getByText('Readiness')).toBeInTheDocument();
    // `<AthleteStatus` branch.
    expect(screen.getByText('MOCKED_ATHLETE_STATUS')).toBeInTheDocument();

    expect(screen.queryByText(/resolved week is not readable here yet/)).not.toBeInTheDocument();
    expect(screen.queryByText(/readiness and capacity are not readable here yet/)).not.toBeInTheDocument();
  });

  it('hides the local-only resolved-week and readiness sections for a roster-summary client, showing the refusal copy instead', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [ROSTER_CLIENT];
    await renderCommandCenter(repo);

    expect(
      screen.queryByText('No sessions resolved. Inspect safety, schedule and proposal inputs; do not invent a plan.'),
    ).not.toBeInTheDocument();
    // No band figures for a roster client — there is no repository method
    // that returns a derived readiness/capacity band for one.
    expect(screen.queryByText('Readiness')).not.toBeInTheDocument();
    // AthleteStatus itself IS rendered for a roster client now, in its
    // consent-gated roster form (clientId passed through) — this is the
    // intentional Stage 5 change, not a regression of the old "never shown"
    // behavior this test used to assert.
    expect(screen.getByText('MOCKED_ATHLETE_STATUS')).toBeInTheDocument();

    expect(screen.getByText(/Riley Roster.s resolved week is not readable here yet/)).toBeInTheDocument();
    expect(screen.getByText(/Riley Roster.s readiness band is not readable here yet/)).toBeInTheDocument();
  });

  it('shows live pending counts and the nutrition summary for a roster client, linked to the real screens', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [ROSTER_CLIENT];
    repo.progressionProposals = [
      rosterProposal({ id: 'prop-1', domain: 'strength' }),
      rosterProposal({ id: 'prop-2', domain: 'strength', clientKey: 'bench_press', subject: 'Bench press' }),
      rosterProposal({ id: 'prop-3', domain: 'conditioning', clientKey: 'row_erg', subject: 'Row erg' }),
    ];
    repo.nutritionSummary = { loggedDays: 4, windowDays: 7, trendDirection: 'stable', estimateConfidence: 'medium' };
    await renderCommandCenter(repo);

    const strengthRow = screen.getByText('2 pending').closest('a');
    expect(strengthRow).toHaveAttribute('href', '/coach/progression');
    const conditioningRow = screen.getByText('1 pending').closest('a');
    expect(conditioningRow).toHaveAttribute('href', '/coach/progression');
    const nutritionRow = screen.getByText('4/7 days logged').closest('a');
    expect(nutritionRow).toHaveAttribute('href', '/coach/nutrition');

    // The stale static-snapshot phrasing is gone for roster clients.
    expect(screen.queryByText(/completed in the current week/)).not.toBeInTheDocument();
  });

  it('renders the decision queue first in DOM order, ahead of the collapsed reference sections', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [rosterClient({ source: 'engine-local', id: 'engine-local' })];
    const { container } = await renderCommandCenter(repo);
    const queueSection = container.querySelector('section[aria-labelledby="priority-title"]');
    const overviewSection = container.querySelector('summary');
    expect(queueSection).toBeInTheDocument();
    expect(overviewSection).toBeInTheDocument();
    // compareDocumentPosition: DOCUMENT_POSITION_FOLLOWING (4) means `overviewSection`
    // comes AFTER `queueSection` in the document — true for every reader, not just
    // a CSS `order` trick that only ever affected sighted, visual-order users.
    expect(queueSection!.compareDocumentPosition(overviewSection!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('collapses the Overview and Three systems sections by default', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [rosterClient({ source: 'engine-local', id: 'engine-local' })];
    const { container } = await renderCommandCenter(repo);

    const overviewSummary = screen.getByText('Overview');
    expect(overviewSummary).toBeInTheDocument();
    const overviewDetails = overviewSummary.closest('details');
    expect(overviewDetails).not.toHaveAttribute('open');
    expect(within(overviewDetails as HTMLElement).getByText('Strength')).not.toBeVisible();

    const systemsSummary = screen.getByText('Three systems');
    const systemsDetails = systemsSummary.closest('details');
    expect(systemsDetails).not.toHaveAttribute('open');

    // The queue card itself is NOT a <details> — it's always open, unlike
    // every CoachSection around it.
    expect(container.querySelector('section[aria-labelledby="priority-title"]')?.tagName).not.toBe('DETAILS');
  });
});
