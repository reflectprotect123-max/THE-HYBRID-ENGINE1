// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { DbProvider } from '../../store/db';
import { NutritionProvider } from '../../store/nutrition';
import { FakeCoachWorkspaceRepository, renderCoachScreen, rosterClient } from '../testing/coach-test-harness';
import { Conditioning } from './Conditioning';
import { Nutrition } from './Nutrition';

/**
 * The pillar gap, closed 13 August 2026.
 *
 * Between 11 and 13 August the four pillar screens were gated WITHOUT
 * `layer3Ready`, so selecting any athlete but yourself turned the four main
 * tiles of the coach dashboard into refusals — while the backend they needed
 * (`lift_trend`, `hard_budget`, `erg_trend`, `readiness_trend`, the nutrition
 * summary/window pair and their two consent grants) was already built and
 * already being pushed by athletes' own devices.
 *
 * These tests hold the two halves of the fix that matter, and they are
 * different halves:
 *
 *  1. A roster athlete's OWN data reaches the screen — the reason the gap was
 *     worth closing.
 *  2. What is NOT shared is stated rather than rendered as a zero. A blank
 *     zone chart, an empty macro table or a missing pain flag are claims
 *     about a person, and the roster tier does not carry the data to make
 *     any of them.
 */

function renderRoster(ui: ReactElement, repo: FakeCoachWorkspaceRepository) {
  repo.clients = [rosterClient({ id: 'roster-1', name: 'Riley Roster', source: 'roster-summary' })];
  return renderCoachScreen(
    <DbProvider><NutritionProvider><MemoryRouter>{ui}</MemoryRouter></NutritionProvider></DbProvider>,
    { repository: repo },
  );
}

beforeEach(() => localStorage.clear());

describe('Conditioning pillar — roster athlete', () => {
  it('shows the shared erg trend and states that time-in-zone is not shared', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.trendSnapshots = {
      erg_trend: {
        kind: 'erg_trend',
        generatedAt: '2026-08-12T09:00:00.000Z',
        points: [{ label: 'RowErg 2000m', sub: '4 tests', points: [210, 205, 200], latest: 200, delta: -10 }],
      },
    };
    renderRoster(<Conditioning />, repo);
    await act(async () => {});

    expect(screen.getByText('RowErg 2000m')).toBeInTheDocument();
    /*
     * The zone breakdown is derived from raw HR traces held on the athlete's
     * own device. Rendering an empty zone chart here would say they trained
     * in no zones at all, which is a false statement about a person rather
     * than an absent feature.
     */
    expect(screen.getByText(/Time-in-zone is not shared/i)).toBeInTheDocument();
  });
});

describe('Nutrition pillar — roster athlete', () => {
  it('shows the summary tier without a grant, and refuses the daily tier', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.nutritionSummary = { loggedDays: 5, windowDays: 7, trendDirection: 'losing', estimateConfidence: 'medium' };
    repo.nutritionGrant = false;
    renderRoster(<Nutrition />, repo);
    await act(async () => {});

    expect(screen.getByText('5 / 7')).toBeInTheDocument();
    expect(screen.getByText('losing')).toBeInTheDocument();
    // The refusal is stated as a refusal, never as an athlete who logged
    // nothing — and it names the fact that consent is theirs to give and to
    // take back.
    expect(screen.getByText(/has not granted daily nutrition access/i)).toBeInTheDocument();
    expect(screen.getByText(/revoke it at any time/i)).toBeInTheDocument();
  });

  it('shows the daily tier once the athlete has granted it, and says the read was logged', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.nutritionSummary = { loggedDays: 5, windowDays: 7, trendDirection: 'stable', estimateConfidence: 'high' };
    repo.nutritionGrant = true;
    repo.nutritionWindow = {
      dailyStatus: [{ date: '2026-08-10', status: 'logged', note: null }],
      weightEntries: [],
      macroTargets: [],
      latestCheckIn: null,
    };
    renderRoster(<Nutrition />, repo);
    await act(async () => {});

    expect(screen.getByText('logged')).toBeInTheDocument();
    expect(screen.getByText(/logged to Riley Roster&rsquo;s receipt trail|logged to Riley Roster’s receipt trail/i)).toBeInTheDocument();
  });

  /*
   * `null` from the engine is a real answer — it declined to call a
   * direction it could not support — and "unknown" is the honest render of
   * that. Picking "stable" instead would be the bench inventing a claim the
   * engine refused to make.
   */
  it('renders an undecided trend as unknown rather than picking one', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.nutritionSummary = { loggedDays: 1, windowDays: 7, trendDirection: null, estimateConfidence: null };
    renderRoster(<Nutrition />, repo);
    await act(async () => {});

    expect(screen.getAllByText('unknown')).toHaveLength(2);
    expect(screen.getByText(/engine declined to call it/i)).toBeInTheDocument();
  });
});
