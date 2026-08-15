// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { LS_KEY } from '@hybrid/engine';
import { DbProvider } from '../../store/db';
import { Readiness } from './Readiness';
import { CoachWorkspaceProvider } from '../data/CoachWorkspaceContext';
import { FakeCoachWorkspaceRepository } from '../testing/coach-test-harness';

/*
 * Wrapped in `CoachWorkspaceProvider` since 13 August 2026, when the pillar
 * gap was closed: each pillar now branches on `selectedClient.source`, so it
 * needs a workspace to ask. The fake repository's roster is empty, which
 * resolves to no selected client and therefore to the SELF branch — which is
 * exactly what every test below is about, and is now asserted by
 * construction rather than by there being no other branch to take.
 */
function renderPillar() {
  return render(
    <CoachWorkspaceProvider repository={new FakeCoachWorkspaceRepository()}>
      <DbProvider>
        <MemoryRouter><Readiness /></MemoryRouter>
      </DbProvider>,
    </CoachWorkspaceProvider>
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
  it('offers a way back to the Command Center', async () => {
    renderPillar();
    await act(async () => {});
    expect(screen.getByRole('link', { name: /Command Center/ })).toHaveAttribute('href', '/coach');
  });

  /*
   * CLAUDE.md: pain and illness are ONE class of safety flag, and they
   * outrank a readiness score. This screen previously did
   * `constraints.find((c) => c.code === 'pain_hold_active')`, which dropped
   * the illness flag rather than relocating it — and the only two components
   * that still rendered it live at `/coach/legacy`, which had no inbound
   * link. Seeding BOTH is the point: a `find`-shaped read passes a
   * pain-only test.
   */
  function seedSafetyFlags({ pain, illness }: { pain: boolean; illness: boolean }) {
    const safety: Record<string, unknown> = {};
    if (pain) safety.painHold = { active: true, areas: ['knee'], updatedAt: Date.now() };
    if (illness) safety.illness = { status: 'active', updatedAt: Date.now() };
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({ workouts: [], sessions: [], settings: {}, core: { safety } }),
    );
  }

  it('surfaces the illness flag alongside pain, both as hard constraints', async () => {
    seedSafetyFlags({ pain: true, illness: true });
    renderPillar();
    await act(async () => {});

    expect(screen.getByText('Pain flag active')).toBeInTheDocument();
    expect(screen.getByText('Illness flag active')).toBeInTheDocument();
    // The engine's own sentences, not a paraphrase invented on the screen.
    expect(screen.getByText(/Pain hold: knee\. Do not push through the flagged pain/)).toBeInTheDocument();
    expect(
      screen.getByText(/A manual or observed illness flag is active\..*return-to-training process/),
    ).toBeInTheDocument();
    // Two alerts, using the mockup's existing treatment — not one merged banner.
    expect(document.querySelectorAll('.rd-alert')).toHaveLength(2);
  });

  it('surfaces illness on its own, with no pain flag present', async () => {
    seedSafetyFlags({ pain: false, illness: true });
    renderPillar();
    await act(async () => {});

    expect(screen.queryByText('Pain flag active')).not.toBeInTheDocument();
    expect(screen.getByText('Illness flag active')).toBeInTheDocument();
  });

  it('expands each safety alert independently', async () => {
    seedSafetyFlags({ pain: true, illness: true });
    renderPillar();
    await act(async () => {});
    const heads = screen.getAllByRole('button', { name: /flag active/ });
    expect(heads).toHaveLength(2);
    expect(heads[0]).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(heads[0]!);
    expect(heads[0]).toHaveAttribute('aria-expanded', 'true');
    expect(heads[1]).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows no safety alert when neither flag is set', async () => {
    renderPillar();
    await act(async () => {});
    expect(document.querySelectorAll('.rd-alert')).toHaveLength(0);
  });

  it('asks for a WHOOP connection instead of inventing a recovery score', async () => {
    // A fresh DB has no WHOOP data. The mockup shows 87%; showing that
    // number here would be a fabricated vital sign.
    renderPillar();
    await act(async () => {});
    expect(screen.getByRole('link', { name: /Connect WHOOP/i })).toBeInTheDocument();
    expect(screen.queryByText('87')).not.toBeInTheDocument();
  });
});

describe('trend card range toggle', () => {
  it('renders genuinely more points for a longer real range than a shorter one', async () => {
    seedWhoopHrvHistory(40);
    renderPillar();
    await act(async () => {});

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

  it('says so, rather than faking a window, when the real history is shorter than the range', async () => {
    seedWhoopHrvHistory(12);
    renderPillar();
    await act(async () => {});

    fireEvent.click(screen.getByRole('button', { name: 'Expand HRV chart' }));
    fireEvent.click(screen.getByRole('button', { name: '90d' }));

    expect(bigChartPointCount()).toBe(12);
    expect(screen.getByText(/Only 12 days of history on record — showing all of it, not a full 90-day window\./)).toBeInTheDocument();
  });
});
