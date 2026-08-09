// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { LS_KEY } from '@hybrid/engine';
import { DbProvider } from '../store/db';
import { CoachAuthoring } from './CoachAuthoring';
import { FakeCoachWorkspaceRepository, renderCoachScreen, rosterClient } from './coach-test-harness';
import type { AthleteWorkoutDraft } from './contracts';

/*
 * docs/RISK_REGISTER.md R8. `CoachAuthoring`'s roster branch
 * (`RosterAuthoringView`) is where this session's one confirmed shipped bug
 * lived: the weekday picker reused the self-coach-only 1-7 (Mon..Sun)
 * `DAYS` encoding to publish a roster client's draft, when the backend's
 * `preferred_weekdays` CHECK constraint expects 0-6 (Sun..Sat) — so picking
 * Sunday for a real athlete would have failed the write. The fix split off
 * a separate `PUBLISH_WEEKDAYS` constant (0=Sun..6=Sat) used only by this
 * view. The first test below is a direct regression test for that bug: it
 * proves Sunday is sent to `publishWorkoutDraft` as `0`, never `7`.
 */

/**
 * `CoachWorkspaceProvider` resolves `clients`/`selectedClient` via an async
 * `useEffect`; before that settles `selectedClient` is still `null`, so
 * `CoachAuthoring` transiently renders `SelfCoachAuthoringView` (which reads
 * `useDb()` — hence `DbProvider` here even though `RosterAuthoringView`
 * itself never touches it). Once `selectedClient` resolves to the
 * roster-summary client, `RosterAuthoringView` mounts and fires its OWN
 * effect (`repository.listWorkoutDrafts`). `act(async () => {})` flushes
 * the whole cascade before any assertion runs, the same pattern every other
 * roster screen in this batch uses.
 */
async function renderAuthoring(repository: FakeCoachWorkspaceRepository) {
  const result = renderCoachScreen(
    <DbProvider>
      <MemoryRouter initialEntries={['/coach/author']}>
        <Routes>
          <Route path="/coach/author" element={<CoachAuthoring />} />
          <Route path="/coach/roster-plan/:workoutId" element={<RosterPlanRouteEcho />} />
        </Routes>
      </MemoryRouter>
    </DbProvider>,
    { repository },
  );
  await act(async () => {});
  return result;
}

/** Stands in for the real `RosterPlanner` route so the "Edit blocks" test
 *  can assert on the ACTUAL route param real navigation landed on, rather
 *  than inspecting a mocked `navigate` call. */
function RosterPlanRouteEcho() {
  const { workoutId } = useParams();
  return <p>Roster plan editor for {workoutId}</p>;
}

function draftFixture(over: Partial<AthleteWorkoutDraft> = {}): AthleteWorkoutDraft {
  return {
    workoutId: 'w1',
    kind: 'strength',
    body: { id: 'w1', kind: 'strength', name: 'Upper Body A', blocks: [], updatedAt: Date.now() },
    baseVersion: 3,
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

const CLIENT = rosterClient({ id: 'roster-1', name: 'Riley Roster', source: 'roster-summary' });

beforeEach(() => {
  localStorage.clear();
});

describe('CoachAuthoring (roster)', () => {
  it('publishes Sunday as 0 (backend 0-6 encoding), not the self-coach 1-7 convention', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [CLIENT];
    repo.workoutDrafts = [draftFixture()];
    await renderAuthoring(repo);

    const sundayCheckbox = screen.getByRole('checkbox', { name: 'Sunday' });
    await act(async () => {
      fireEvent.click(sundayCheckbox);
    });

    const publishButton = screen.getByRole('button', { name: 'Publish and assign' });
    await act(async () => {
      fireEvent.click(publishButton);
    });

    expect(repo.publishedDrafts).toHaveLength(1);
    expect(repo.publishedDrafts[0].clientId).toBe('roster-1');
    expect(repo.publishedDrafts[0].workoutId).toBe('w1');
    expect(repo.publishedDrafts[0].baseVersion).toBe(3);
    // The bug this regresses: the self-coach `DAYS` list would have sent 7.
    expect(repo.publishedDrafts[0].preferredWeekdays).toEqual([0]);
  });

  it('renders an Edit blocks button per draft that navigates to /coach/roster-plan/<workoutId>', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [CLIENT];
    repo.workoutDrafts = [draftFixture({ workoutId: 'w-edit-me' })];
    await renderAuthoring(repo);

    expect(screen.queryByText(/Roster plan editor for/)).not.toBeInTheDocument();
    const editButton = screen.getByRole('button', { name: 'Edit blocks' });
    await act(async () => {
      fireEvent.click(editButton);
    });

    expect(screen.getByText('Roster plan editor for w-edit-me')).toBeInTheDocument();
  });

  it('blocks publishing with no weekday selected and never calls publishWorkoutDraft', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [CLIENT];
    repo.workoutDrafts = [draftFixture()];
    await renderAuthoring(repo);

    const publishButton = screen.getByRole('button', { name: 'Publish and assign' });
    await act(async () => {
      fireEvent.click(publishButton);
    });

    expect(screen.getByText('Choose at least one preferred weekday before publishing.')).toBeInTheDocument();
    expect(repo.publishedDrafts).toHaveLength(0);
  });

  it('sizes weekday-picker labels to a 44px touch target in the roster view', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [CLIENT];
    repo.workoutDrafts = [draftFixture()];
    const { container } = await renderAuthoring(repo);

    const dayLabels = container.querySelectorAll('fieldset .grid-cols-7 label');
    expect(dayLabels.length).toBeGreaterThan(0);
    dayLabels.forEach((label) => expect(label).toHaveClass('min-h-11'));
  });
});

/**
 * `SelfCoachAuthoringView` derives its `ProposalCard`s from `proposalsFromDB`
 * (packages/coordinator-adapter), which reads `db.workouts` — with the
 * default empty `DbProvider` boot state there are zero workouts, so no
 * `ProposalCard` (and thus no weekday-picker fieldset) ever renders. Seed the
 * exact localStorage blob `DbProvider` boots from, the same way
 * `AthleteStatus.test.tsx`'s `seedRecoveryToday` does, with one minimal
 * strength workout so a `ProposalCard` mounts.
 */
function seedStrengthWorkout() {
  const db = {
    workouts: [{ id: 'w-self-1', kind: 'strength', name: 'Self-coach workout', blocks: [], updatedAt: Date.now() }],
    sessions: [],
    settings: {},
  };
  localStorage.setItem(LS_KEY, JSON.stringify(db));
}

describe('CoachAuthoring (self-coach)', () => {
  it('sizes weekday-picker labels to a 44px touch target', async () => {
    seedStrengthWorkout();
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [];
    const { container } = await renderAuthoring(repo);

    const dayLabels = container.querySelectorAll('fieldset .grid-cols-7 label');
    expect(dayLabels.length).toBeGreaterThan(0);
    dayLabels.forEach((label) => expect(label).toHaveClass('min-h-11'));
  });
});
