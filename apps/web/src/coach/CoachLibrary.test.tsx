// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { LS_KEY } from '@hybrid/engine';
import { CoachLibrary } from './CoachLibrary';
import { FakeCoachWorkspaceRepository, renderCoachScreen, rosterClient } from './coach-test-harness';
import type { ProgramTemplate } from './contracts';
import { DbProvider } from '../store/db';

/*
 * The Library is the month calendar first, with Programs beside it.
 *
 * This header read "the month calendar and nothing else" between 11 and 13
 * August, when the owner had deleted the Programs tab and its "Prepare an
 * assignment" configurator. Stage 3b brought Programs back — as a table and a
 * per-program detail view, not as the sidebar — so the wording moves with it.
 *
 * What the tests below still protect is the part that was never about the
 * tab: the calendar is what opens, the sidebar configurator does not come
 * back, and `saveAssignmentDraft` has a reachable caller. That last one is
 * not hypothetical — it had none at all for two days.
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

  /*
   * This read "with no view tabs to choose between" until stage 3b (13 August
   * 2026) brought Programs back. What that test was really protecting is the
   * DEFAULT, not the absence: the Library is the calendar day to day, and a
   * coach who opens it must land on the month grid rather than on a tab they
   * did not ask for. That is asserted here, and the tab pair is now asserted
   * as present rather than as missing.
   */
  it('opens straight onto the calendar, with Programs available but unselected', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [rosterClient({ id: 'roster-1', name: 'Riley Roster' })];
    await renderLibrary(repo);

    expect(screen.getByRole('button', { name: 'Previous month' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next month' })).toBeInTheDocument();

    const tabs = screen.getByRole('tablist', { name: 'Library view' });
    expect(within(tabs).getByRole('tab', { name: 'Calendar' })).toHaveAttribute('aria-selected', 'true');
    expect(within(tabs).getByRole('tab', { name: 'Programs' })).toHaveAttribute('aria-selected', 'false');
  });

  /*
   * The SIDEBAR configurator stays deleted. Stage 3b put the assign action
   * back, but on the program's own detail view — not as a permanent panel
   * sitting beside the calendar asking for a training system, an experience
   * level and a sessions-per-week before it will show you anything.
   */
  it('carries no assignment configurator beside the calendar', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    await renderLibrary(repo);

    expect(screen.queryByRole('button', { name: /prepare/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Training system')).not.toBeInTheDocument();
    expect(screen.queryByText(/preferred training days/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('tablist', { name: 'Filter Library by training system' })).not.toBeInTheDocument();
  });

  /*
   * THE assignment path, end to end.
   *
   * `saveAssignmentDraft` is the only way this app assigns a program to an
   * athlete. It was deleted with the sidebar on 11 August and sat with zero
   * callers for two days — the exact defect the stage 3b plan names as its
   * reason to verify rather than trust. This test is that verification: it
   * drives the real screen and asserts the real write, including the state
   * that keeps assignment a PROPOSAL rather than a placement.
   */
  it('assigns a program through the only assignment path there is', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [rosterClient({ id: 'roster-1', name: 'Riley Roster' })];
    repo.templates = [{
      id: 'p1',
      domain: 'strength',
      name: 'Build · Full Body',
      category: 'Full body',
      level: 'developing',
      sessionsPerWeek: 3,
      weeks: 8,
      summary: 'Three balanced sessions.',
      progression: { kind: 'strength', stages: ['Volume base'], increaseAuthority: 'coach-approval-only' },
      status: 'published',
      source: 'coach-template',
      sessions: [],
    } as unknown as ProgramTemplate];
    await renderLibrary(repo);

    fireEvent.click(screen.getByRole('tab', { name: 'Programs' }));
    fireEvent.click(screen.getByRole('button', { name: /Build · Full Body/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Mon$/ }));
    fireEvent.click(screen.getByRole('button', { name: /prepare assignment/i }));
    await act(async () => {});

    expect(repo.assignmentDrafts).toHaveLength(1);
    expect(repo.assignmentDrafts[0]).toMatchObject({
      clientId: 'roster-1',
      programTemplateId: 'p1',
      preferredWeekdays: [1],
      // Assignment PROPOSES. The Coordinator resolves the week; this draft is
      // an input to that, and a screen that wrote anything else here would be
      // claiming an authority the coach bench does not have.
      state: 'ready-for-coordinator',
    });
    expect(screen.getByRole('status')).toHaveTextContent(/the Coordinator still resolves the week/i);
  });

  it('no longer links to the deleted session builder', async () => {
    // The inverse of the test that stood here until 14 August 2026, and it is
    // kept rather than deleted for a reason. That test asserted this link was
    // present BECAUSE /coach/author was the only door to /coach/build/:id,
    // /coach/planner/:id and /coach/roster-plan/:workoutId — deleting the link
    // orphaned four routes. All four routes and the screens behind them are
    // now gone, so the link would lead to the catch-all redirect instead.
    // Asserting its ABSENCE stops it being reinstated by muscle memory.
    const repo = new FakeCoachWorkspaceRepository();
    await renderLibrary(repo);
    expect(screen.queryByRole('link', { name: /session builder/i })).toBeNull();
    for (const dead of ['/coach/author', '/coach/build/', '/coach/planner/', '/coach/roster-plan/']) {
      expect(document.body.innerHTML).not.toContain(dead);
    }
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
