// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App';

/*
 * The COMPOSITION test. Each half of the coach-first root has its own unit
 * test — App's `/` element, CoachAccess's gate — and both pass in isolation
 * even if the two never meet: `/` redirecting into a chunk whose gate then
 * redirects back to `/` is a loop that neither test can see. This mounts the
 * real router and follows the whole path.
 *
 * jsdom's document starts at `/`, which is the entry this exercises; the
 * BrowserRouter App builds for itself reads it directly.
 */

/* Vitest runs with DEV true, and the guard lets every account through in dev —
   so the denied path has to be asked for explicitly here. */
let mockAllowed = false;
vi.mock('./coach/guard', () => ({ coachAllowed: () => mockAllowed }));

vi.mock('./cloud/sync', async () => {
  const actual = await vi.importActual<typeof import('./cloud/sync')>('./cloud/sync');
  return {
    ...actual,
    SyncProvider: ({ children }: { children: React.ReactNode }) => children,
    // Nobody signed in, restore already finished — the plain cold load of the
    // dashboard deploy by someone who is not the coach.
    useSync: () => ({ user: null, authReady: true, signIn: vi.fn(), signOut: vi.fn() }),
  };
});

describe('the unscoped dashboard root', () => {
  it('lands on the coach sign-in screen from `/`, without a navigation loop', async () => {
    mockAllowed = false;
    render(<App />);
    expect(await screen.findByRole('button', { name: /sign in/i })).toBeInTheDocument();
    // Arrived at the bench's address, and stayed there.
    expect(window.location.pathname).toBe('/coach');
    // The athlete chrome must NOT be underneath it — the sign-in screen sits
    // outside the Shell on purpose.
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
  });
});
