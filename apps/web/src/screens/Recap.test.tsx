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

function seedSession(id: string) {
  const db: EngineDB = {
    workouts: [],
    sessions: [
      {
        id,
        date: '2026-08-01',
        status: 'completed',
        blocks: [],
        startedAt: 1000,
        completedAt: 2000,
      },
    ],
    settings: {},
  };
  localStorage.setItem(LS_KEY, JSON.stringify(db));
}

function DestinationEcho({ label }: { label: string }) {
  return <p>{label}</p>;
}

async function renderRecap(id: string) {
  seedSession(id);
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
});
