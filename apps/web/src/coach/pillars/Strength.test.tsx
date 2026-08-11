// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { LS_KEY, type Session } from '@hybrid/engine';
import { DbProvider } from '../../store/db';
import { Strength } from './Strength';

function renderPillar() {
  return render(
    <DbProvider>
      <MemoryRouter><Strength /></MemoryRouter>
    </DbProvider>,
  );
}

function liftSession(date: string, name: string, kg: number, reps: number): Session {
  return {
    id: `s-${date}-${name}`,
    date,
    status: 'completed',
    blocks: [
      {
        id: 'b1',
        exercises: [
          {
            id: 'e1',
            name,
            mode: 'reps_kg',
            sets: [{ t: String(reps), rpe: '8', aVal: String(kg), aVal2: String(reps), done: true }],
          },
        ],
      },
    ],
  } as Session;
}

/**
 * Seeds `weeks` consecutive weekly sessions of a single lift, one exposure
 * per calendar week, ending on the current week — so an 8-week window and a
 * 13-week window are never accidentally identical.
 */
function seedLiftHistory(weeks: number) {
  const sessions = Array.from({ length: weeks }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (weeks - 1 - i) * 7);
    return liftSession(d.toISOString().slice(0, 10), 'Back Squat', 100 + i, 5);
  });
  const db = { workouts: [], sessions, settings: {}, core: {} };
  localStorage.setItem(LS_KEY, JSON.stringify(db));
}

function bigChartPointCount(): number {
  const polyline = document.querySelector('.rd-big-chart polyline');
  expect(polyline).toBeTruthy();
  return polyline!.getAttribute('points')!.trim().split(/\s+/).length;
}

beforeEach(() => localStorage.clear());

describe('Strength pillar', () => {
  it('offers a way back to the Command Center', () => {
    renderPillar();
    expect(screen.getByRole('link', { name: /Command Center/ })).toHaveAttribute('href', '/coach');
  });

  it('says the queue is empty rather than showing the mockup lifts', () => {
    // A fresh DB has no proposals. "Back squat 100 → 102.5" is mockup
    // furniture; shipping it would invent a decision the coach never made.
    renderPillar();
    expect(screen.queryByText(/Back squat/)).not.toBeInTheDocument();
    expect(screen.getByText(/no .*(proposal|decision)/i)).toBeInTheDocument();
  });
});

describe('lift trend card range toggle', () => {
  it('renders genuinely more points for a longer real range than a shorter one', () => {
    seedLiftHistory(13);
    renderPillar();

    fireEvent.click(screen.getByRole('button', { name: 'Expand Back Squat chart' }));
    // 8w is the default range on open.
    expect(bigChartPointCount()).toBe(8);

    fireEvent.click(screen.getByRole('button', { name: '13w' }));
    // All 13 real weekly sessions are within a 13-week window — no padding
    // or jittering, just the same real series shown wider.
    expect(bigChartPointCount()).toBe(13);
  });

  it('says so, rather than faking a window, when real session history is shorter than the range', () => {
    seedLiftHistory(10);
    renderPillar();

    fireEvent.click(screen.getByRole('button', { name: 'Expand Back Squat chart' }));
    fireEvent.click(screen.getByRole('button', { name: '13w' }));

    // Only 10 real weeks exist — a 13-week window must show what's really
    // there, never pad or interpolate up to 13.
    expect(bigChartPointCount()).toBe(10);
    expect(
      screen.getByText(/Only 10 weeks of session history on record — showing all of it, not a full 13-week window\./),
    ).toBeInTheDocument();
  });
});
