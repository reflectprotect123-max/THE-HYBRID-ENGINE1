// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { LS_KEY, type EngineDB } from '@hybrid/engine';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DbProvider } from '../store/db';
import { Recap } from './Recap';

/*
 * Regression: the "Done" button used to `nav('/')` unconditionally. On the
 * unscoped dashboard build `/` now redirects to `/coach` (this session's
 * coach-first-root work), so finishing a session ejected a self-coached
 * athlete straight into the coach bench instead of Home. `IS_SCOPED_BUILD`
 * is a build-time constant (default `false` in this test environment, same
 * as the unscoped dashboard build it protects), so the fix is verified by
 * asserting the actual destination this environment resolves to: `/home`.
 */

function seedSession(id: string, blocks: EngineDB['sessions'][number]['blocks'] = []) {
  const db: EngineDB = {
    workouts: [],
    sessions: [
      {
        id,
        date: '2026-08-01',
        status: 'completed',
        blocks,
        startedAt: 1000,
        completedAt: 2000,
      },
    ],
    settings: {},
  };
  localStorage.setItem(LS_KEY, JSON.stringify(db));
}

/** One lift, RAMPED: 100 → 110 → 120, every set 5 reps rated at its target. */
const rampedBlocks = (): EngineDB['sessions'][number]['blocks'] => [{
  id: 'b1',
  heading: 'Main',
  exercises: [{
    id: 'e1',
    name: 'Back squat',
    mode: 'reps_kg',
    sets: [
      { t: '5', rpe: '8', aVal: '100', aVal2: '5', felt: '8', done: true },
      { t: '5', rpe: '8', aVal: '110', aVal2: '5', felt: '8', done: true },
      { t: '5', rpe: '8', aVal: '120', aVal2: '5', felt: '8', done: true },
    ],
  }],
}];

function DestinationEcho({ label }: { label: string }) {
  return <p>{label}</p>;
}

async function renderRecap(id: string, blocks?: EngineDB['sessions'][number]['blocks']) {
  seedSession(id, blocks);
  return render(
    <DbProvider>
      <MemoryRouter initialEntries={[`/recap/${id}`]}>
        <Routes>
          <Route path="/recap/:id" element={<Recap />} />
          <Route path="/home" element={<DestinationEcho label="Landed on Home" />} />
          <Route path="/" element={<DestinationEcho label="Landed on coach-bench root" />} />
        </Routes>
      </MemoryRouter>
    </DbProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe('Recap', () => {
  it('the Done button navigates to /home, not the unscoped build\'s coach-bench root', async () => {
    await renderRecap('s1');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(await screen.findByText('Landed on Home')).toBeInTheDocument();
    expect(screen.queryByText('Landed on coach-bench root')).not.toBeInTheDocument();
  });

  /*
   * The "Next session" line, on a RAMPED lift.
   *
   * It renders `${m.from} →` beside `${m.to}kg`, so the two have to be
   * answers to the same question. They were not: `from` was the last working
   * set (120) and `to` the fold's next-session opener (100), and this session
   * — three sets, all rated exactly as asked, nothing wrong with any of them —
   * printed "120 → 100" in red under the word hold.
   *
   * By hand: dev = 8 − 8 = 0 on every set, inside the ±1 dead band, so the
   * multiplier stays 1 and 100 × 1 rounds to 100. Opener in, same opener out.
   */
  it('pairs the opener with next session\'s opener, not the top of the ramp', async () => {
    await renderRecap('s2', rampedBlocks());
    expect(await screen.findByText('100 →')).toBeInTheDocument();
    expect(screen.getByText('100kg')).toBeInTheDocument();
    expect(screen.queryByText('120 →')).not.toBeInTheDocument();
  });
});
