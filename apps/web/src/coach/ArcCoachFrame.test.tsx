// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { DbProvider } from '../store/db';
import { ArcCoachFrame } from './ArcCoachFrame';
import { resetProgressionLedgerForTests } from './progression-store';
import { FakeCoachWorkspaceRepository, renderCoachScreen, rosterClient } from './coach-test-harness';

/*
 * docs/RISK_REGISTER.md R8. ArcCoachFrame is where the "renders the coach's
 * own records under a client's name" risk (docs/HANDOFF_2026-08-08_ARC_IMPORT.md)
 * is disclosed — `ClientDetailGate` BLOCKS a route without a real backend,
 * but every route it lets through still relies on this banner to tell the
 * coach whose data is actually on screen. A logic bug here (the wrong
 * client-source branch, or the banner suppressed on the wrong route) fails
 * exactly the way the risk describes: silently, not loudly.
 */

/**
 * `CoachWorkspaceProvider` populates `clients` (and therefore
 * `selectedClient`, and therefore the banner) via an async `useEffect` —
 * `repository.listClients().then(setClients)` — which resolves AFTER
 * `render()` returns, on the next microtask. Every query below `render()`
 * without waiting for that is querying pre-effect DOM, and a `queryByRole`
 * assertion of ABSENCE would pass for that wrong reason even when the real
 * logic is broken. `act(async () => {})` flushes it before any assertion
 * runs, for both the positive and the negative cases alike.
 */
async function renderFrame(repository: FakeCoachWorkspaceRepository, path = '/coach') {
  const result = renderCoachScreen(
    <DbProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<ArcCoachFrame />}>
            <Route path="/coach" element={<p>Command center content</p>} />
            <Route path="/coach/library" element={<p>Library content</p>} />
            <Route path="/coach/progression" element={<p>Progression content</p>} />
          </Route>
        </Routes>
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

describe('ArcCoachFrame', () => {
  it('shows no disclosure banner for the signed-in athlete (engine-local)', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [rosterClient({ id: 'engine-local', name: 'Alex Morgan', source: 'engine-local' })];
    await renderFrame(repo, '/coach/progression');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('discloses that a roster client\'s DETAIL is not readable, without calling them a fixture', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [rosterClient({ name: 'Riley Roster', source: 'roster-summary' })];
    await renderFrame(repo, '/coach/progression');
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent(/Riley Roster.{0,3}s detailed records are not readable yet/);
    expect(banner).not.toHaveTextContent(/fixture/i);
  });

  it('discloses a synthetic fixture as a fixture — the OTHER, distinct case', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [rosterClient({ name: 'Fixture Fiona', source: 'synthetic-fixture' })];
    await renderFrame(repo, '/coach/progression');
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent(/Fixture Fiona is a synthetic handoff fixture/);
  });

  it('suppresses the banner on the command center route, even for a roster client', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [rosterClient({ source: 'roster-summary' })];
    await renderFrame(repo, '/coach');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('suppresses the banner on the library route, even for a roster client', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [rosterClient({ source: 'roster-summary' })];
    await renderFrame(repo, '/coach/library');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows the pending-proposal count on the Command nav link', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [];
    await renderFrame(repo, '/coach/progression');
    // Two things share the "count" badge: undecided local progression
    // proposals and dropped weekly-plan decisions. With neither seeded, the
    // badge must not render at all rather than show a bare 0.
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('the mobile nav trigger opens the rail drawer, and a nav link closes it', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [rosterClient({ source: 'roster-summary' })];
    await renderFrame(repo, '/coach');
    const trigger = screen.getByRole('button', { name: /open coach navigation/i });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('link', { name: /library/i }));
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});
