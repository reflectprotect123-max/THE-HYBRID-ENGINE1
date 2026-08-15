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
vi.mock('./coach/access/guard', () => ({ coachAllowed: () => mockAllowed }));

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
   * REWRITTEN 13 August 2026, when the athlete web app was parked.
   *
   * This asserted that `/` lands on the athlete Home. That was right while
   * the athlete app was the front page; the owner has since asked for it to
   * stop being reachable in a browser at all. Web is the coach workspace now.
   *
   * What the test still guards is the part that was never about which app
   * won: `/` must RESOLVE, and it must not loop. A redirect to somewhere that
   * redirects back is exactly what this file exists to catch, and parking one
   * side of the fork is when that is most likely to happen.
   */
  it('lands on the coach bench from `/`, without a navigation loop', async () => {
    mockAllowed = false;
    window.history.pushState({}, '', '/');

    render(<App />);
    await screen.findByText(/coach/i, undefined, { timeout: 5000 });
    // Redirected once, to the one surface the browser still serves, and
    // stayed there.
    expect(window.location.pathname).toBe('/coach');
  });

  it('still lets the coach bench be reached directly, and does not gate it behind the athlete', async () => {
    mockAllowed = false;
    window.history.pushState({}, '', '/coach');

    render(<App />);

    /* 5s, not the 1s default: `/coach` is a `React.lazy` chunk (App.tsx), so
       this waits on a real dynamic import — it pays for pulling and evaluating
       the whole coach bundle before the gate can render. Alone it resolves in
       well under a second; cold it lands around 950ms, and in the full parallel
       suite it intermittently did not, failing on machine load rather than on
       anything about the app. Two sessions found this independently and landed
       the same number. The wait is legitimate, so the budget says so rather
       than the assertion being lucky. */
    expect(
      await screen.findByRole('button', { name: /sign in/i }, { timeout: 5000 }),
    ).toBeInTheDocument();

    expect(window.location.pathname).toBe('/coach');
    // The sign-in screen sits outside the Shell on purpose.
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
  });
});

/*
 * A PARKED app must not 404.
 *
 * This case used to assert the opposite destination — that an unmatched
 * address goes to the athlete Home rather than the bench — because at the
 * time the athlete app was the front page and the catch-all wrongly pointed
 * at the bench. Parking the athlete app inverts which answer is correct
 * without changing what is being protected: an address someone has
 * BOOKMARKED must land somewhere real.
 *
 * `/nutrition/settings` is deliberately the address used. It belongs to the
 * nutrition world, which was parked alongside the training screens, and it is
 * the kind of URL a person actually has saved. It resolving to the bench is
 * the difference between "that moved" and a dead link.
 */
/*
 * THE OAUTH RETURN. This is the case parking the athlete app nearly broke.
 *
 * `whoop-callback.mjs` and `concept2-callback.mjs` both hand the browser back
 * to `/?integration=…&status=…`, and `Concept2Provider` reads that outcome
 * from `window.location.search` in a mount effect. The provider sits above
 * the router, so the router's redirect — its child — runs first: a plain
 * `<Navigate to="/coach">` wipes the params before the provider ever looks,
 * and a cancelled authorization becomes indistinguishable from "never
 * connected".
 *
 * So the redirect has to CARRY the query, and that is what this pins.
 */
describe('the OAuth callback return', () => {
  /*
   * A NEUTRAL param, deliberately, not `integration=concept2`. The provider
   * STRIPS its own params once it has read them, so asserting on those can
   * never fail: gone-because-consumed and gone-because-the-redirect-ate-them
   * look identical. A param nothing consumes distinguishes the two, and it is
   * the same mechanism either way — if `keepme` survives, so does the OAuth
   * outcome.
   */
  it('keeps the query when it redirects to the bench', async () => {
    mockAllowed = false;
    window.history.pushState({}, '', '/?keepme=1');

    render(<App />);

    await screen.findByText(/coach/i, undefined, { timeout: 5000 });
    expect(window.location.pathname).toBe('/coach');
    expect(window.location.search).toContain('keepme=1');
  });
});

describe('a parked athlete address', () => {
  it('lands on the coach bench rather than dying', async () => {
    mockAllowed = false;
    window.history.pushState({}, '', '/nutrition/settings');

    render(<App />);

    await screen.findByText(/coach/i, undefined, { timeout: 5000 });
    expect(window.location.pathname).toBe('/coach');
  });
});
