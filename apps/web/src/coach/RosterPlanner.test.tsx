// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { act, screen } from '@testing-library/react';
import type { Workout } from '@hybrid/engine';
import { DbProvider } from '../store/db';
import { RosterPlanner } from './RosterPlanner';
import { FakeCoachWorkspaceRepository, renderCoachScreen, rosterClient } from './coach-test-harness';

/*
 * docs/RISK_REGISTER.md R8. RosterPlanner is the newest screen in the coach
 * bench — the block/set editor for a ROSTER CLIENT's draft, wired to
 * `useParams().workoutId` and `repository.listWorkoutDrafts` rather than the
 * local `EngineDB` the self-coach `Planner` normally reads. The two facts
 * worth a real render test: it must find and hand off the right draft to
 * `Planner` when one matches the route param, and it must show a distinct
 * error state — not a blank screen, not the self-coach "session is gone"
 * copy — when none does.
 */

/**
 * Same two-hop async shape as `CoachWorkspaceContext`'s other consumers, plus
 * one more hop of its own: `CoachWorkspaceProvider` populates `selectedClient`
 * via `repository.listClients().then(setClients)` (an async effect, resolved
 * on a microtask after `render()` returns), and only once `selectedClient` is
 * non-null does RosterPlanner's OWN effect (`clientId` in its dependency
 * array) fire `repository.listWorkoutDrafts(...)`. A query run right after
 * `render()` would see neither hop settled — `await act(async () => {})`
 * flushes both, the same pattern `ArcCoachFrame.test.tsx`'s `renderFrame()`
 * uses for the first hop alone.
 */
async function renderPlanner(repository: FakeCoachWorkspaceRepository, workoutId: string) {
  const result = renderCoachScreen(
    <DbProvider>
      <MemoryRouter initialEntries={[`/coach/roster-plan/${workoutId}`]}>
        <Routes>
          <Route path="/coach/roster-plan/:workoutId" element={<RosterPlanner />} />
        </Routes>
      </MemoryRouter>
    </DbProvider>,
    { repository },
  );
  await act(async () => {});
  return result;
}

function draftWorkout(over: Partial<Workout> = {}): Workout {
  return { id: 'w1', kind: 'strength', name: 'Upper Body A', blocks: [], ...over };
}

beforeEach(() => {
  localStorage.clear();
});

describe('RosterPlanner', () => {
  it('loads the draft matching the route workoutId and hands it to Planner, addressed to the selected client', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [rosterClient({ id: 'roster-1', name: 'Riley Roster' })];
    repo.workoutDrafts = [
      { workoutId: 'w1', kind: 'strength', body: draftWorkout(), baseVersion: 3, updatedAt: new Date().toISOString() },
    ];

    await renderPlanner(repo, 'w1');

    // Planner renders the workout name as the session-name input's value.
    expect(screen.getByDisplayValue('Upper Body A')).toBeInTheDocument();
    // headerNote proves RosterPlanner (not the self-coach Planner route) is
    // the one that mounted, and that it read the real selected client's name.
    expect(screen.getByText('Editing for Riley Roster · saves automatically')).toBeInTheDocument();
    expect(screen.queryByText('That draft could not be found.')).not.toBeInTheDocument();
  });

  it('shows the not-found error state, not a blank screen, when no draft matches the workoutId', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [rosterClient({ id: 'roster-1', name: 'Riley Roster' })];
    repo.workoutDrafts = [
      { workoutId: 'some-other-workout', kind: 'strength', body: draftWorkout({ id: 'w2' }), baseVersion: 1, updatedAt: new Date().toISOString() },
    ];

    await renderPlanner(repo, 'w1');

    expect(screen.getByText('That draft could not be found.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
    // The Planner editor itself must not have mounted underneath the error.
    expect(screen.queryByLabelText('session name')).not.toBeInTheDocument();
  });
});
