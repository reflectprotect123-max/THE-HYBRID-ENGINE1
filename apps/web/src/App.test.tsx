// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App';

/*
 * The COMPOSITION test. Each half of the root has its own unit test — App's
 * `/` element, the training tree's catch-all — and both pass in isolation even
 * if the two never meet: `/` redirecting somewhere that redirects back to `/`
 * is a loop that neither test can see. This mounts the real router and follows
 * the whole path.
 *
 * Every case below sets its own starting address explicitly. jsdom's document
 * starts at `/`, which used to be left implicit here — but `window.history` is
 * shared across the cases in this file, so the first one only saw `/` by virtue
 * of running first. That is an ordering dependency, and it showed up as a flake
 * the moment a second case was added above it.
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
  /*
   * `/` is the ATHLETE's. It used to redirect to the coach bench, so someone
   * typing the bare domain landed in a workspace they had no account for and
   * met a sign-in screen. The bench is still one tap away at `/coach`; it is
   * just no longer what the product opens on.
   */
  it('lands on the athlete Home from `/`, without a navigation loop', async () => {
    mockAllowed = false;
    window.history.pushState({}, '', '/');

    render(<App />);

    expect(await screen.findByText(/Train today/i)).toBeInTheDocument();
    // Redirected to the athlete's one canonical address, and stayed there.
    expect(window.location.pathname).toBe('/home');
    // And arrived inside the athlete's own chrome, not the bench's.
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });

  it('still lets the coach bench be reached directly, and does not gate it behind the athlete', async () => {
    mockAllowed = false;
    window.history.pushState({}, '', '/coach');

    render(<App />);

    /* An explicit timeout because this one is waiting on a DYNAMIC IMPORT: the
       bench is `lazy(() => import('./coach'))`, so this case pays for pulling
       and evaluating the whole coach chunk before the gate can render. It lands
       around 950ms against testing-library's 1000ms default, which is a flake
       waiting to happen on any loaded machine — and it flaked twice while this
       was being written. The wait is legitimate, so the budget should say so
       rather than the assertion being lucky. */
    expect(
      await screen.findByRole('button', { name: /sign in/i }, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe('/coach');
    // The sign-in screen sits outside the Shell on purpose.
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
