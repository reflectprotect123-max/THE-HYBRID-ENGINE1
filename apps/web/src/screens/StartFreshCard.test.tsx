// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { LS_KEY } from '@hybrid/engine';
import { DbProvider } from '../store/db';
import { WhoopProvider } from '../cloud/whoop';
import { Concept2Provider } from '../cloud/concept2';
import { Settings } from './Settings';

/* Settings mounts the cloud, WHOOP and Concept2 cards, which poll a Netlify
   function. jsdom has no base URL for a root-relative path, so an unstubbed
   call buries the run in stack traces. Not connected is the honest state. */
vi.mock('../cloud/sync', () => ({
  useSync: () => ({ user: null, authReady: true, signIn: vi.fn(), signOut: vi.fn(), pendingAssignments: [] }),
  supabaseClient: null,
}));
vi.stubGlobal('fetch', async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));

/*
 * The control the owner asked for on 12 August 2026, after finding their live
 * app full of sessions built while the coach builder's Save button was still a
 * stub: a session called "Session", a block called "NEW BLOCK", exercises
 * called "Exercise" with nothing prescribed.
 *
 * It deletes data, so every test here reads the STORE back rather than
 * trusting the screen, and one of them proves the guard by pressing the first
 * button and checking nothing has gone yet.
 */

/*
 * The clock is frozen to the seeded session's date, and the two must stay in
 * step. DbProvider runs expireStaleSessions on every mount, which DROPS an
 * `active` session dated before today that has no logged work (blocks: []) —
 * and immediately rewrites localStorage without it. With the real wall clock,
 * this fixture is deleted during mount from the day after its hardcoded date
 * onwards, before any test clicks anything. Do not "tidy" this back to an
 * unfrozen literal date: it passes on the day it is written and fails forever
 * after. Only Date is faked (toFake: ['Date']) so timers and microtasks —
 * which @testing-library's async act relies on — keep running for real.
 */
const FIXTURE_DAY = new Date('2026-08-12T12:00:00');
vi.useFakeTimers({ now: FIXTURE_DAY, toFake: ['Date'] });
afterAll(() => {
  vi.useRealTimers();
});

function seed() {
  localStorage.setItem(LS_KEY, JSON.stringify({
    workouts: [{ id: 'w1', name: 'Session', blocks: [], updatedAt: 1 }],
    sessions: [{ id: 's1', date: '2026-08-12', status: 'active', blocks: [], updatedAt: 1 }],
    settings: { units: 'lb' },
  }));
}

function stored(): { workouts?: unknown[]; sessions?: unknown[]; settings?: { units?: string; deletedIds?: Record<string, number> } } {
  return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}');
}

function renderSettings() {
  return render(
    <MemoryRouter>
      <DbProvider>
        <WhoopProvider>
          <Concept2Provider>
            <Settings />
          </Concept2Provider>
        </WhoopProvider>
      </DbProvider>
    </MemoryRouter>,
  );
}

describe('Start fresh', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('does not delete anything on the first press — it asks first', async () => {
    seed();
    renderSettings();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /clear all sessions/i }));
    });

    expect(screen.getByRole('alert')).toHaveTextContent(/cannot be\s+undone/i);
    expect(stored().workouts).toHaveLength(1);
    expect(stored().sessions).toHaveLength(1);
  });

  it('says exactly how much will go, rather than a vague warning', async () => {
    seed();
    renderSettings();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /clear all sessions/i }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('1 in the library and 1 logged');
  });

  it('clears the training content on the second, deliberate press', async () => {
    seed();
    renderSettings();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /clear all sessions/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /yes, delete everything/i }));
    });

    expect(stored().workouts).toEqual([]);
    expect(stored().sessions).toEqual([]);
  });

  it('tombstones what it removed, so the cloud cannot put it back', async () => {
    seed();
    renderSettings();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /clear all sessions/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /yes, delete everything/i }));
    });

    expect(Object.keys(stored().settings?.deletedIds ?? {})).toEqual(expect.arrayContaining(['w1', 's1']));
  });

  it('leaves the rest of the settings alone', async () => {
    seed();
    renderSettings();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /clear all sessions/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /yes, delete everything/i }));
    });

    expect(stored().settings?.units).toBe('lb');
  });

  it('backs out without deleting when the athlete changes their mind', async () => {
    seed();
    renderSettings();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /clear all sessions/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /keep it/i }));
    });

    expect(stored().workouts).toHaveLength(1);
    expect(screen.getByRole('button', { name: /clear all sessions/i })).toBeInTheDocument();
  });

  it('offers nothing to press when there is nothing stored', async () => {
    renderSettings();
    expect(screen.queryByRole('button', { name: /clear all sessions/i })).not.toBeInTheDocument();
    expect(screen.getByText(/nothing to clear/i)).toBeInTheDocument();
  });
});
