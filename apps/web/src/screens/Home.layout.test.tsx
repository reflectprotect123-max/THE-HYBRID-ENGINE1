// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workout } from '@hybrid/engine';
import { Home } from './Home';

/*
 * Home's two layout rules, which are the whole reason the screen is readable.
 *
 * Both had already been lost once by the time these were written, and neither
 * failed anything: the file's own header described "the one dominant tap
 * first", while the week strip and the Coordinator's plan had drifted above
 * the session card — so the answer to "what should I do today" was the third
 * thing on the screen. And two brass buttons were live at once whenever a
 * session was in progress alongside a planned one.
 *
 * A layout rule that is only written in a comment is a rule that drifts, so
 * these assert it. Colocated as a sibling rather than folded into Home.test.tsx
 * because that file is a pure-node test of `plannedForToday` and friends, and
 * this one needs a DOM.
 *
 * The stores and the heavy children are mocked deliberately: this is a test
 * about ORDER and EMPHASIS, and rendering the real check-in, receipt and
 * nutrition cards would make it fail for reasons that have nothing to do with
 * either.
 */

const workouts = [
  { id: 'w-1', name: 'Upper A', kind: 'strength', blocks: [{ id: 'b', exercises: [] }], days: [0, 1, 2, 3, 4, 5, 6] },
  { id: 'w-2', name: 'Zone 2 Run', kind: 'conditioning', blocks: [], days: [0, 1, 2, 3, 4, 5, 6] },
] as unknown as Workout[];

let activeSession: unknown = null;

vi.mock('../store/db', () => ({
  useDb: () => ({
    db: { workouts, sessions: [], settings: {} },
    whoop: null,
    activeSession,
    sessions: [],
    update: vi.fn(),
    athleteState: { readiness: { band: 'moderate', confidence: 'limited' } },
    weeklyPlan: { entries: [], decisions: [] },
  }),
}));

vi.mock('../autocoach/ledger', () => ({ useLedger: () => [] }));
vi.mock('../autocoach/ArcAssignmentCard', () => ({ ArcAssignmentCard: () => null }));
vi.mock('../autocoach/CheckInCard', () => ({ CheckInCard: () => <div>check-in card</div> }));
vi.mock('../autocoach/SessionReceipt', () => ({ SessionReceipt: () => <div>session receipt</div> }));
/* A brass button INSIDE the collapsed disclosure, so the "one dominant tap"
   assertion would catch it if the section were ever left open by default. */
vi.mock('../autocoach/ModeSwitcher', () => ({
  ModeSwitcher: () => <button className="shadow-brass">Turn on Assisted</button>,
}));
vi.mock('./nutrition/NutritionCard', () => ({ NutritionCard: () => <div>nutrition card</div> }));

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/home']}>
      <Home />
    </MemoryRouter>,
  );
}

/* Brass is the design system's one dominant treatment (`Button variant="brass"`
   in ui/index.tsx), and `shadow-brass` is the class only it carries.
 *
 * Buttons inside a CLOSED disclosure do not count, and that is the point rather
 * than a convenience: the rule is about what competes for attention on the
 * screen, not what exists in the document. The mocked ModeSwitcher deliberately
 * renders a brass button so that if a reference section were ever left open by
 * default, these assertions would fail. */
const visibleBrassButtons = () =>
  Array.from(document.querySelectorAll('button')).filter(
    (b) => b.className.includes('shadow-brass') && !b.closest('details:not([open])'),
  );

beforeEach(() => {
  activeSession = null;
});

describe("Home's one dominant tap", () => {
  it('offers exactly one brass button when a session is planned', () => {
    renderHome();

    const brass = visibleBrassButtons();
    expect(brass).toHaveLength(1);
    expect(brass[0]).toHaveTextContent(/Start today/i);
  });

  it('still offers exactly one when a session is already live', () => {
    // The regression: Resume was brass AND the planned row's Start was brass,
    // so the screen asked the same question twice with two different answers.
    activeSession = { id: 's-1', workoutId: 'w-other', name: 'Lower A', status: 'active' };
    renderHome();

    const brass = visibleBrassButtons();
    expect(brass).toHaveLength(1);
    expect(brass[0]).toHaveTextContent(/Resume session/i);
  });

  it('leaves the other planned session startable, just not dominant', () => {
    renderHome();

    // Two sessions are planned; the second still starts, as a ghost.
    const starts = screen.getAllByRole('button', { name: /^Start$/i });
    expect(starts).toHaveLength(1);
    expect(starts[0].className).not.toContain('shadow-brass');
  });
});

describe("Home's order", () => {
  it("puts today's session above the week", () => {
    renderHome();

    const body = document.body.textContent ?? '';
    // The session card names the workout; the week strip is headed "This week".
    expect(body.indexOf('Upper A')).toBeGreaterThan(-1);
    expect(body.indexOf('This week')).toBeGreaterThan(-1);
    expect(body.indexOf('Upper A')).toBeLessThan(body.indexOf('This week'));
  });

  it('does not stack the deleted reference sections back open', () => {
    renderHome();

    /* This asserted a COLLAPSED mode switcher ("Turn on Assisted", present but
       not visible) and, before 14 August 2026, a collapsed "Coordinated week"
       disclosure. Both of the things it watched are now deleted rather than
       collapsed — the Coordinator first, then `@hybrid/auto-coach` with the
       mode switcher inside it.

       The assertions are INVERTED rather than dropped, twice over now, because
       the rule this test protects is about what Home spends a screen on. A
       section that quietly reappears — restored by a revert, or re-added by
       someone who did not know why it went — is exactly the drift it exists to
       catch, and that is a live risk precisely because these were deletions
       rather than design decisions about layout. */
    expect(screen.queryByRole('button', { name: /Turn on Assisted/i })).toBeNull();
    expect(screen.queryByText(/Coordinated week/i)).toBeNull();
    expect(screen.queryByText(/auto-coached mode/i)).toBeNull();
  });
});
