// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DbProvider } from '../../store/db';
import { CoachWeekBuilder } from './CoachWeekBuilder';
import { FakeCoachWorkspaceRepository, renderCoachScreen, rosterClient } from '../testing/coach-test-harness';
import { COACH_CLIENT_FIXTURES } from '../testing/mock-fixtures';
import { weekBodyFromDays } from '../data/coach-week';
import type { AthleteWeekSummary, CoachWeekPlan } from '../data/contracts';

/*
 * The week builder — step 3 of the coach-publishes-the-week design.
 *
 * What is worth a render test here is not the layout: it is the three claims a
 * coach would be misled by if they were wrong. Publish sends the WEEK the
 * coach is looking at (and the base version it started from, so a colleague's
 * newer week refuses instead of being overwritten); a refusal is reported as a
 * refusal, in the failure voice; and a non-roster entry cannot publish at all
 * rather than appearing to. (A fourth claim — that a HELD day was never shown
 * as one the athlete ignored — went with the safety stop when
 * `@hybrid/auto-coach` was deleted on 14 August 2026: nothing writes a held
 * receipt any more, and this screen no longer reads them.)
 */

const MONDAY = '2026-08-10';

/** Wrapped exactly as `App.tsx` nests it, for parity with every other coach
 *  screen render helper in this test suite. */
async function renderBuilder(
  repository: FakeCoachWorkspaceRepository,
  athleteId = 'roster-1',
  weekStart = MONDAY,
) {
  const result = renderCoachScreen(
    <DbProvider>
      <MemoryRouter initialEntries={[`/coach/week/${athleteId}/${weekStart}`]}>
        <Routes>
          <Route path="/coach/week/:athleteId/:weekStart" element={<CoachWeekBuilder />} />
        </Routes>
      </MemoryRouter>
    </DbProvider>,
    { repository },
  );
  /* Two settles: the provider's own `listClients()`, then the screen's
     `getCoachWeek` / `getAthleteWeekSummary` pair. */
  await act(async () => {});
  await act(async () => {});
  return result;
}

function rosterRepository(): FakeCoachWorkspaceRepository {
  const repository = new FakeCoachWorkspaceRepository();
  repository.clients = [rosterClient()];
  return repository;
}

/** A week with one authored Monday, as `getCoachWeek` would return it. */
function publishedWeek(version = 1): CoachWeekPlan {
  return {
    weekStart: MONDAY,
    status: 'published',
    version,
    body: weekBodyFromDays(MONDAY, [
      { instructions: 'Steady', blocks: [{ id: 'b1', category: 'Warm-up' }] },
    ]),
    publishedAt: '2026-08-09T10:00:00.000Z',
  };
}

/**
 * Both clicks, with the settle in the right place.
 *
 * The confirm click has to be INSIDE `act` (it awaits a repository call) and
 * the first click has to be OUTSIDE it — a state update made inside an async
 * `act` is not flushed until that act returns, so a single wrapper would look
 * for the confirmation button before the panel holding it had rendered.
 */
async function publishWithConfirmation() {
  fireEvent.click(screen.getByRole('button', { name: 'Publish the week' }));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Yes, publish' }));
  });
}

beforeEach(() => {
  localStorage.clear();
  /*
   * The day states are relative to TODAY — "not done" is only true once a day
   * is over — so a test that let the real clock through would pass this week
   * and fail next week. Only `Date` is faked; the timers React and
   * @testing-library rely on stay real.
   */
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${MONDAY}T09:00:00Z`));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('CoachWeekBuilder', () => {
  it('renders seven day columns for the week in the address', async () => {
    await renderBuilder(rosterRepository());

    expect(screen.getByRole('heading', { level: 1, name: /Riley Roster’s week/ })).toBeInTheDocument();
    for (const label of ['Mon 10', 'Tue 11', 'Wed 12', 'Thu 13', 'Fri 14', 'Sat 15', 'Sun 16']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getAllByRole('button', { name: /^Edit / })).toHaveLength(7);
  });

  it('refuses a week that does not start on a Monday, before any call is made', async () => {
    const repository = rosterRepository();
    await renderBuilder(repository, 'roster-1', '2026-08-11');

    expect(screen.getByText(/has to start on a Monday/)).toBeInTheDocument();
    expect(repository.publishedWeeks).toHaveLength(0);
  });

  it('seeds the columns from the week already published', async () => {
    const repository = rosterRepository();
    repository.coachWeek = publishedWeek();
    await renderBuilder(repository);

    /* One authored block on Monday, and the state that says the athlete has
       it — the day's own record, not a claim about the week as a whole. */
    expect(screen.getByText('1 block')).toBeInTheDocument();
    expect(screen.getAllByText('Published').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Rest')).toHaveLength(6);
  });

  it('publishes what is on screen, with the version it started from', async () => {
    const repository = rosterRepository();
    repository.coachWeek = publishedWeek(3);
    await renderBuilder(repository);

    fireEvent.click(screen.getByRole('button', { name: 'Publish the week' }));
    /* The confirmation names the athlete and both ends of the week — the
       design's requirement, and the difference between confirming a week and
       confirming "this week". */
    const confirmation = screen.getByText(/Riley Roster will see these seven days/);
    expect(confirmation).toHaveTextContent('Monday, 10 August 2026 to Sunday, 16 August 2026');
    expect(confirmation).toHaveTextContent('replaces version 3');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Yes, publish' }));
    });

    expect(repository.publishedWeeks).toHaveLength(1);
    const sent = repository.publishedWeeks[0];
    expect(sent.clientId).toBe('roster-1');
    expect(sent.weekStart).toBe(MONDAY);
    expect(sent.baseVersion).toBe(3);
    expect(sent.body.days).toHaveLength(7);
    expect(sent.body.days[0].sessions).toHaveLength(1);
    expect(sent.idempotencyKey).toContain(`${MONDAY}:3:`);
    expect(screen.getByText(/Published to Riley Roster/)).toBeInTheDocument();
  });

  it('sends a null base version on a first publish and a real one after', async () => {
    const repository = rosterRepository();
    await renderBuilder(repository);

    await publishWithConfirmation();
    expect(repository.publishedWeeks[0].baseVersion).toBeNull();

    await publishWithConfirmation();
    /* The screen adopted the version the publish returned, so the second one
       carries the lock rather than forcing again. */
    expect(repository.publishedWeeks[1].baseVersion).toBe(1);
  });

  it('reports a refusal in the failure voice, never in the success one', async () => {
    const repository = rosterRepository();
    repository.publishError = new Error('week was modified by someone else');
    await renderBuilder(repository);

    await publishWithConfirmation();

    const note = screen.getByText(/changed while you were editing it/);
    /* `.st-save-note` is `--color-ok` and is declared AFTER `.st-warning`, so
       a failure wearing both classes ships in green. Separate elements. */
    expect(note).toHaveClass('st-warning');
    expect(note).not.toHaveClass('st-save-note');
    expect(screen.queryByText(/Published to/)).not.toBeInTheDocument();
  });

  it('cannot publish for a client with no coaching relationship, and says why', async () => {
    const repository = new FakeCoachWorkspaceRepository();
    repository.clients = COACH_CLIENT_FIXTURES.filter((c) => c.source === 'engine-local');
    await renderBuilder(repository, 'engine-local');

    expect(screen.getByRole('button', { name: 'Publish the week' })).toBeDisabled();
    expect(screen.getByText(/not an athlete on your roster/)).toBeInTheDocument();
    /* The columns still render — the refusal is about publishing, not about
       the screen. */
    expect(screen.getAllByRole('button', { name: /^Edit / })).toHaveLength(7);
  });

  it('shows a published day the athlete completed as completed', async () => {
    const repository = rosterRepository();
    repository.coachWeek = publishedWeek();
    repository.weekSummary = {
      entries: [],
      decisions: [],
      sessions: [{ id: 's1', kind: 'strength', date: MONDAY, status: 'completed', name: 'Squats' }],
    } satisfies AthleteWeekSummary;
    await renderBuilder(repository);

    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('leaves the week readable when the published week cannot be read, and warns', async () => {
    const repository = rosterRepository();
    repository.coachWeekError = new Error('boom');
    await renderBuilder(repository);

    expect(screen.getByText(/could not be read/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Edit / })).toHaveLength(7);
  });

  it('REFUSES to publish while the week is unread — the empty screen is not the week', async () => {
    /* A failed read leaves seven empty editors AND makes `base` 0, which sends
       a null base version and switches the optimistic lock off. So the state
       that most needs the lock is the one that had none: publish here and a
       real week is replaced by an empty one, reported as a success. */
    const repository = rosterRepository();
    repository.coachWeekError = new Error('boom');
    const publish = vi.spyOn(repository, 'publishCoachWeek');
    await renderBuilder(repository);

    const button = screen.getByRole('button', { name: /Publish/ });
    expect(button).toBeDisabled();
    /* Clicking a disabled button is a no-op in the DOM, which is the point:
       this asserts the guard is on the BUTTON and not only in the copy. */
    fireEvent.click(button);
    expect(publish).not.toHaveBeenCalled();
  });

  it('publishes normally once the week reads — the refusal above is about the failure, not the screen', async () => {
    const repository = rosterRepository();
    repository.coachWeek = publishedWeek();
    await renderBuilder(repository);

    expect(screen.getByRole('button', { name: /Publish/ })).not.toBeDisabled();
  });

  it('never claims a day was held — nothing writes a held receipt any more', async () => {
    /* The safety stop was deleted with `@hybrid/auto-coach` on 14 August
       2026. A past day with no logged session reads "Not done" — the system
       no longer knows injury from indifference, and must not pretend to. */
    const repository = rosterRepository();
    repository.coachWeek = publishedWeek();
    vi.setSystemTime(new Date('2026-08-12T09:00:00Z'));
    await renderBuilder(repository);

    expect(screen.getByText('Not done')).toBeInTheDocument();
    expect(screen.queryByText(/^Held · /)).not.toBeInTheDocument();
    expect(screen.queryByText(/was stopped by/)).not.toBeInTheDocument();
  });

  /*
   * A COACH WHO IS THEIR OWN ATHLETE (14 August 2026).
   *
   * `20260814_arc_self_coaching.sql` lets the owner redeem their own invite,
   * and `listClients` folds that roster row into the `engine-local` entry
   * rather than appending a second one. The fold is only worth anything if the
   * folded entry can actually publish — otherwise the owner is told, about
   * their own account, that they are "not an athlete on your roster", which is
   * now false.
   *
   * The trap this covers is the id. The folded entry keeps `id:
   * 'engine-local'` because that is the bench's selection key; the id the
   * commands are keyed on is the real user id inside `selfCoaching`. Sending
   * the wrong one fails every call with "not on your roster" while the
   * relationship really exists — and it would look exactly like the refusal
   * below, which is correct for a client that has no relationship at all.
   */
  const SELF_USER = 'aaaaaaaa-0000-0000-0000-000000000000';

  function selfCoachedRepository(): FakeCoachWorkspaceRepository {
    const repository = new FakeCoachWorkspaceRepository();
    repository.clients = COACH_CLIENT_FIXTURES
      .filter((c) => c.source === 'engine-local')
      .map((c) => ({ ...c, selfCoaching: { organizationId: 'org-9', athleteUserId: SELF_USER } }));
    return repository;
  }

  it('publishes for a self-coached engine-local entry, addressed by the REAL user id', async () => {
    const repository = selfCoachedRepository();
    await renderBuilder(repository, 'engine-local');

    expect(screen.getByRole('button', { name: 'Publish the week' })).toBeEnabled();
    expect(screen.queryByText(/not an athlete on your roster/)).not.toBeInTheDocument();

    await publishWithConfirmation();

    expect(repository.publishedWeeks).toHaveLength(1);
    /* The user id, never the selection key. `engine-local` matches no
       `athlete_user_id` and the server would refuse it. */
    expect(repository.publishedWeeks[0].clientId).toBe(SELF_USER);
    expect(repository.publishedWeeks[0].clientId).not.toBe('engine-local');
    expect(repository.publishedWeeks[0].weekStart).toBe(MONDAY);
  });

  it('reads the self-coached week with the same real id', async () => {
    const repository = selfCoachedRepository();
    const week = vi.spyOn(repository, 'getCoachWeek');
    await renderBuilder(repository, 'engine-local');

    expect(week).toHaveBeenCalledWith(SELF_USER, MONDAY);
  });

  it('says the week is the coach’s own, rather than talking about someone else’s phone', async () => {
    await renderBuilder(selfCoachedRepository(), 'engine-local');

    expect(screen.getByRole('heading', { level: 1, name: 'Your week' })).toBeInTheDocument();
    expect(screen.getByText(/becomes your own week on your phone/)).toBeInTheDocument();
    /* A real publish into a real record, said plainly — and NOT in the
       failure voice, because nothing here is refused or degraded. */
    const note = screen.getByText(/takes this week off the Coordinator/);
    expect(note).not.toHaveClass('st-warning');
  });

  it('opens the day builder for one day and takes its edit back into the week', async () => {
    const repository = rosterRepository();
    await renderBuilder(repository);

    fireEvent.click(screen.getByRole('button', { name: 'Edit Tue' }));
    /* The `week` mode, not the calendar's `dated` one: the day IS the
       placement here, so the Coordinator note must not appear. */
    expect(screen.getByText(/lands on/)).toBeInTheDocument();
    expect(screen.queryByText(/preferred day/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '+ Add block' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save this day' }));

    await publishWithConfirmation();

    const sent = repository.publishedWeeks[0];
    expect(sent.body.days[1].sessions).toHaveLength(1);
    expect(sent.body.days[0].sessions).toHaveLength(0);
  });
});
