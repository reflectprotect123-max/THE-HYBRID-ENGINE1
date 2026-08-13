// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CommandWeek } from './CommandWeek';
import { localWeek, rosterWeek } from './command-week';

const MONDAY = '2026-08-10';
const THURSDAY = '2026-08-13';

function renderWeek(over: Partial<React.ComponentProps<typeof CommandWeek>> = {}) {
  const props = {
    days: localWeek(MONDAY, [], []),
    today: THURSDAY,
    readable: true,
    athleteName: 'Alex Morgan',
    ...over,
  };
  render(<MemoryRouter><CommandWeek {...props} /></MemoryRouter>);
  return props;
}

describe('CommandWeek', () => {
  /*
   * This panel exists to show the PLAN. The tiles above it already show
   * counts, and a second copy of a number the screen has shown is clutter —
   * which is the one thing the owner ruled out when choosing what fills this
   * space.
   */
  it('shows each day its sessions and what happened to them', () => {
    const days = localWeek(
      MONDAY,
      [{ id: 's1', date: MONDAY, status: 'done', name: 'Lower A', workoutId: 'w1', blocks: [] }] as never,
      [{ id: 'w2', name: 'Upper A', days: [4], updatedAt: 1, blocks: [] }] as never,
    );
    renderWeek({ days });

    expect(screen.getByText('Lower A')).toBeInTheDocument();
    expect(screen.getByText('logged')).toBeInTheDocument();
    expect(screen.getByText('Upper A')).toBeInTheDocument();
    expect(screen.getByText('scheduled')).toBeInTheDocument();
  });

  /*
   * Status is said in WORDS, not carried by colour alone. A coach with any
   * degree of colour-blindness reads the same week as everyone else, and the
   * glyph beside each entry is `aria-hidden` precisely because it is
   * decoration on top of the word rather than a substitute for it.
   */
  it('says a status rather than only colouring it', () => {
    const days = localWeek(
      MONDAY,
      [{ id: 's1', date: MONDAY, status: 'active', name: 'Lower A', blocks: [] }] as never,
      [],
    );
    renderWeek({ days });
    expect(screen.getByText('in progress')).toBeInTheDocument();
  });

  it('marks today so the coach can find their place', () => {
    renderWeek({
      days: localWeek(MONDAY, [], [{ id: 'w1', name: 'Lower A', days: [1], updatedAt: 1, blocks: [] }] as never),
    });
    expect(screen.getByText(/Thu 13 · today/i)).toBeInTheDocument();
    expect(screen.queryByText(/Mon 10 · today/i)).not.toBeInTheDocument();
  });

  it('counts the tally rather than stating one', () => {
    const days = localWeek(
      MONDAY,
      [{ id: 's1', date: MONDAY, status: 'done', name: 'Lower A', workoutId: 'w1', blocks: [] }] as never,
      [{ id: 'w1', name: 'Lower A', days: [1], updatedAt: 1, blocks: [] },
       { id: 'w2', name: 'Upper A', days: [4], updatedAt: 1, blocks: [] }] as never,
    );
    renderWeek({ days });
    expect(screen.getByText('1 of 2 logged')).toBeInTheDocument();
  });

  /*
   * An empty state that only apologises leaves the coach with nowhere to go.
   * Both of these carry a way forward, and neither invents a week.
   */
  it('offers a way forward when the week is genuinely empty', () => {
    renderWeek();
    expect(screen.getByText(/nothing scheduled or logged this week/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open the library/i })).toHaveAttribute('href', '/coach/library');
  });

  /*
   * Not readable is a FACT on the contract — a roster-summary client has an
   * authorised summary and no readable detail — so it is stated as one, and
   * NOT as an empty week. Rendering seven blank days here would tell the
   * coach this athlete trained nothing, which is a different claim entirely
   * and a false one.
   */
  it('distinguishes an unreadable athlete from an empty week', () => {
    renderWeek({ readable: false, days: rosterWeek(MONDAY, null) });
    expect(screen.getByText(/is not readable from here yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/nothing scheduled or logged/i)).not.toBeInTheDocument();
    /*
     * And NO link out. `/coach/progression` is deliberately unlinked from the
     * chrome — `coach-routes.test.tsx` fails the build if anything re-links
     * it, and it failed on this panel's first draft. The state names where
     * the athlete can be read; it does not quietly reverse that decision.
     */
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders a roster athlete week from the summary', () => {
    const days = rosterWeek(MONDAY, {
      entries: [],
      decisions: [],
      sessions: [{ id: 'a', kind: 'strength', date: THURSDAY, status: 'completed', name: 'Upper A' }],
    } as never);
    renderWeek({ days });

    const heading = screen.getByText(/Thu 13 · today/i);
    expect(within(heading.parentElement as HTMLElement).getByText('Upper A')).toBeInTheDocument();
  });
});
