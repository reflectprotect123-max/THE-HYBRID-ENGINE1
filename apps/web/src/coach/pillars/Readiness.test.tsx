// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { LS_KEY } from '@hybrid/engine';
import { DbProvider } from '../../store/db';
import { Readiness } from './Readiness';

function renderPillar() {
  return render(
    <DbProvider>
      <MemoryRouter><Readiness /></MemoryRouter>
    </DbProvider>,
  );
}

/**
 * Seeds `days` consecutive days of real, distinct HRV readings (and nothing
 * for resting HR / sleep, so those three cards stay in their "not enough
 * history yet" state and can't be confused with the one under test). Values
 * climb by 1ms/day so a 7-point window and a 30-point window are never
 * accidentally identical.
 */
function seedWhoopHrvHistory(days: number) {
  const rows = Array.from({ length: days }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (days - 1 - i));
    return {
      date: d.toISOString().slice(0, 10),
      recovery: 60,
      strain: null,
      hrvMs: 40 + i,
      restingHr: null,
      sleepPerformance: null,
    };
  });
  const db = { workouts: [], sessions: [], settings: { whoopDaily: rows }, core: {} };
  localStorage.setItem(LS_KEY, JSON.stringify(db));
}

function bigChartPointCount(): number {
  const polyline = document.querySelector('.rd-big-chart polyline');
  expect(polyline).toBeTruthy();
  return polyline!.getAttribute('points')!.trim().split(/\s+/).length;
}

beforeEach(() => localStorage.clear());

describe('Readiness pillar', () => {
  it('offers a way back to the Command Center', () => {
    renderPillar();
    expect(screen.getByRole('link', { name: /Command Center/ })).toHaveAttribute('href', '/coach');
  });

  it('asks for a WHOOP connection instead of inventing a recovery score', () => {
    // A fresh DB has no WHOOP data. The mockup shows 87%; showing that
    // number here would be a fabricated vital sign.
    renderPillar();
    expect(screen.getByRole('link', { name: /Connect WHOOP/i })).toBeInTheDocument();
    expect(screen.queryByText('87')).not.toBeInTheDocument();
  });
});

describe('trend card range toggle', () => {
  it('renders genuinely more points for a longer real range than a shorter one', () => {
    seedWhoopHrvHistory(40);
    renderPillar();

    fireEvent.click(screen.getByRole('button', { name: 'Expand HRV chart' }));
    // 7d is the default range on open.
    expect(bigChartPointCount()).toBe(7);

    fireEvent.click(screen.getByRole('button', { name: '30d' }));
    expect(bigChartPointCount()).toBe(30);

    fireEvent.click(screen.getByRole('button', { name: '90d' }));
    // Only 40 real days exist — a 90d window must show what's really there,
    // never pad or interpolate up to 90.
    expect(bigChartPointCount()).toBe(40);
    expect(screen.getByText(/Only 40 days of history on record/)).toBeInTheDocument();
  });

  it('says so, rather than faking a window, when the real history is shorter than the range', () => {
    seedWhoopHrvHistory(12);
    renderPillar();

    fireEvent.click(screen.getByRole('button', { name: 'Expand HRV chart' }));
    fireEvent.click(screen.getByRole('button', { name: '90d' }));

    expect(bigChartPointCount()).toBe(12);
    expect(screen.getByText(/Only 12 days of history on record — showing all of it, not a full 90-day window\./)).toBeInTheDocument();
  });
});
