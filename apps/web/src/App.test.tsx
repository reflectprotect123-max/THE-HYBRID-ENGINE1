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
    //
    // `pendingAssignments` is the empty array a normal account has: only an
    // account enrolled in a real ARC organisation ever gets one
    // (ArcAssignmentCard). It has to be present rather than merely falsy — the
    // card reads `.length` unconditionally, so leaving it off throws the moment
    // any test here renders the athlete Home rather than the coach bench.
    useSync: () => ({
      user: null,
      authReady: true,
      signIn: vi.fn(),
      signOut: vi.fn(),
      pendingAssignments: [],
      acceptAssignment: vi.fn(),
      declineAssignment: vi.fn(),
    }),
  };
});

describe('the unscoped dashboard root', () => {
  it('lands on the coach sign-in screen from `/`, without a navigation loop', async () => {
    mockAllowed = false;
    render(<App />);
    /* 5s, not the 1s default: `/coach` is a `React.lazy` chunk (App.tsx), so
       this waits on a real dynamic import. Alone it resolves in well under a
       second; in the full parallel suite it intermittently did not, and the
       test failed on machine load rather than on anything about the app. */
    expect(await screen.findByRole('button', { name: /sign in/i }, { timeout: 5000 })).toBeInTheDocument();
    // Arrived at the bench's address, and stayed there.
    expect(window.location.pathname).toBe('/coach');
    // The athlete chrome must NOT be underneath it — the sign-in screen sits
    // outside the Shell on purpose.
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
  });
});

/*
 * The other half of the coach-first root, and the half that was wrong: `/` is
 * the bench BY DESIGN, but the training tree's catch-all also pointed at `/`,
 * so every unmatched athlete address chained through it into the coach
 * workspace. The most visible victim was the way back from the nutrition world,
 * whose addresses no training route matches — the one door out of that world
 * put the athlete in the coach bench.
 *
 * Composition again, for the same reason as above: `athleteHomePath` has its own
 * assertions and so does the Home tab, and both pass while the catch-all quietly
 * disagrees with them.
 */
describe('an unmatched athlete address on the unscoped build', () => {
  it('goes to the athlete Home, not the coach bench', async () => {
    mockAllowed = false;
    window.history.pushState({}, '', '/nutrition/settings');

    render(<App />);

    expect(await screen.findByText(/Train today/i)).toBeInTheDocument();
    expect(window.location.pathname).toBe('/home');
    // The athlete kept their own chrome rather than being handed the bench's.
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });
});
