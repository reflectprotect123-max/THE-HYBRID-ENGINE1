// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { LS_KEY } from '@hybrid/engine';
import { CoachLibrary } from './CoachLibrary';
import { FakeCoachWorkspaceRepository, renderCoachScreen, rosterClient } from './coach-test-harness';
import { DbProvider } from '../store/db';

/*
 * The Library is the month calendar and nothing else. The "Programs" tab and
 * its "Prepare an assignment" configurator were deleted by the owner on
 * 11 August 2026 — see CoachLibrary.tsx's header comment for what that cost.
 *
 * The first two tests below are the ones that keep the deletion honest: a
 * partial revert that left any part of the configurator behind would put a
 * dead-end form back in front of the coach, which is the exact bug the old
 * suite existed to cover.
 */

async function renderLibrary(repository: FakeCoachWorkspaceRepository) {
  const result = renderCoachScreen(
    <DbProvider>
      <MemoryRouter initialEntries={['/coach/library']}>
        <CoachLibrary />
      </MemoryRouter>
    </DbProvider>,
    { repository },
  );
  await act(async () => {});
  return result;
}

describe('CoachLibrary', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('opens straight onto the calendar, with no view tabs to choose between', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [rosterClient({ id: 'roster-1', name: 'Riley Roster' })];
    await renderLibrary(repo);

    expect(screen.queryByRole('tablist', { name: 'Library view' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next month' })).toBeInTheDocument();
  });

  it('carries no assignment configurator any more', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    await renderLibrary(repo);

    expect(screen.queryByRole('button', { name: /prepare/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Training system')).not.toBeInTheDocument();
    expect(screen.queryByText(/preferred training days/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('tablist', { name: 'Filter Library by training system' })).not.toBeInTheDocument();
  });

  it('keeps one link to the session builder, which is the only door to the whole builder chain', async () => {
    // /coach/author is the only route linking on to /coach/build/:id,
    // /coach/planner/:id and /coach/roster-plan/:workoutId. Deleting the
    // Programs tab orphaned all four; this link is what un-orphaned them.
    const repo = new FakeCoachWorkspaceRepository();
    await renderLibrary(repo);
    expect(screen.getByRole('link', { name: /session builder/i })).toHaveAttribute('href', '/coach/author');
  });

  it('keeps a client picker, because the calendar needs a client to read', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [rosterClient({ id: 'roster-1', name: 'Riley Roster' }), rosterClient({ id: 'roster-2', name: 'Sam Second' })];
    await renderLibrary(repo);

    const picker = screen.getByLabelText('Athlete') as HTMLSelectElement;
    expect(picker.value).toBe('roster-1');
    await act(async () => {
      fireEvent.change(picker, { target: { value: 'roster-2' } });
    });
    expect((screen.getByLabelText('Athlete') as HTMLSelectElement).value).toBe('roster-2');
  });

  it('renders a scheduled session name on the calendar for the selected client', async () => {
    const now = new Date();
    const midMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15`;
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [rosterClient({ id: 'roster-1', name: 'Riley Roster' })];
    repo.weekSummary = {
      entries: [],
      decisions: [],
      sessions: [{ id: 'session-1', kind: 'strength', date: midMonth, status: 'planned', name: 'Heavy Squat A' }],
    };
    await renderLibrary(repo);

    expect(screen.getAllByText('Heavy Squat A').length).toBeGreaterThan(0);
  });

  it('shows a session the coach built in the day builder, closing the save loop', async () => {
    // The day builder writes an engine Workout into the local store. If the
    // calendar only read the repository, a coach would save a session, come
    // back, and find the day they just filled looking empty — which reads as
    // the save having failed. Regression guard for exactly that.
    const now = new Date();
    const midMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-16`;
    const before = JSON.parse(localStorage.getItem(LS_KEY) ?? '{}') as { workouts?: unknown[] };
    localStorage.setItem(LS_KEY, JSON.stringify({
      ...before,
      workouts: [{ id: 'coach-day-1', name: 'Heavy Pull', blocks: [], dates: [midMonth] }],
    }));

    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [];
    await renderLibrary(repo);

    expect(screen.getAllByText('Heavy Pull').length).toBeGreaterThan(0);
  });

  it('still draws the month with no athlete selected, saying why it is bare', async () => {
    // A bare sentence instead of a grid made the whole Library a dead page
    // for an empty roster. The day builder does not need a client.
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [];
    await renderLibrary(repo);

    expect(screen.getByRole('button', { name: 'Previous month' })).toBeInTheDocument();
    expect(screen.getByText(/no athlete selected/i)).toBeInTheDocument();
  });
});
