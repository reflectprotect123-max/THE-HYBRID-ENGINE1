// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LS_KEY } from '@hybrid/engine';
import { DbProvider } from '../../store/db';
import { NutritionProvider } from '../../store/nutrition';
import { CoachCommandCenter } from './CoachCommandCenter';
import { resetProgressionLedgerForTests } from '../../store/progression';
import { FakeCoachWorkspaceRepository, renderCoachScreen, rosterClient } from '../testing/coach-test-harness';
import type { AthleteProgressionProposal } from '../data/contracts';

/*
 * docs/RISK_REGISTER.md R8. CoachCommandCenter is the one coach-bench screen
 * that is NOT fully behind `ClientDetailGate` — its client-overview reads
 * (the readiness band, the nutrition exception count) gate themselves
 * individually on `isLocalClient` (checks/coach-contract.mjs's static check
 * "CoachCommandCenter's local-only sections stay behind isLocalClient").
 * That check only proves the `isLocalClient` token appears near the risky
 * read in source — it cannot prove the branch actually renders correctly for
 * both a real roster client and the signed-in athlete. A gate-inversion bug
 * here is exactly the failure named in the component's own comment: "renders
 * the coach's own records under a client's name."
 *
 * `AthleteStatus` pulls in `useConcept2()`/`useSync()`, which need
 * `Concept2Provider` and `SyncProvider` — real network/Supabase wiring that
 * has nothing to do with this screen. It is mocked here to a plain marker so
 * a future edit that reintroduces it here does not drag that wiring into
 * this test file's setup.
 */
vi.mock('./AthleteStatus', () => ({
  AthleteStatus: () => <div>MOCKED_ATHLETE_STATUS</div>,
}));

const ENGINE_LOCAL_CLIENT = rosterClient({
  id: 'engine-local',
  name: 'Alex Morgan',
  initials: 'AM',
  source: 'engine-local',
  completion: {
    strength: { completed: 3, planned: 4 },
    conditioning: { completed: 2, planned: 3 },
    nutritionDays: 5,
    checkInDays: 6,
  },
});

const ROSTER_CLIENT = rosterClient({
  id: 'roster-9',
  name: 'Riley Roster',
  initials: 'RR',
  source: 'roster-summary',
  completion: {
    strength: { completed: 1, planned: 2 },
    conditioning: { completed: 0, planned: 2 },
    nutritionDays: 3,
    checkInDays: 4,
  },
});

const TODAY = new Date().toISOString().slice(0, 10);

/**
 * Seeds the exact localStorage blob `DbProvider` boots from (`loadDB` reads
 * `LS_KEY` directly — apps/web/src/store/db.tsx) with one manual recovery
 * observation dated today, strong enough that `deriveAthleteState`'s
 * readiness score clears the 'high' band threshold (score >= 70 — see
 * `band()` in packages/whole-athlete-state/src/state.ts). Same five fields,
 * same 'high' outcome, as `AthleteStatus.test.tsx`'s `seedRecoveryToday`.
 *
 * Finding 2 (fix-round 1): a FRESH, unseeded DB's real readiness band is
 * already 'unknown' — textually IDENTICAL to the roster fallback string this
 * file hardcodes for a non-local client (`isLocalClient ? … : 'unknown'`).
 * A test built on an unseeded DB cannot distinguish "the gate held" from
 * "the gate was removed and both branches happen to read the same word" —
 * that was exactly the blind spot the reviewer's adversarial edit exposed:
 * vitest stayed green with the gate deleted. Seeding a real, non-'unknown'
 * band makes the two cases textually different, so a removed gate now shows
 * up as a real assertion failure below, not a coincidence.
 */
function seedHighReadinessToday() {
  const db = {
    workouts: [],
    sessions: [],
    settings: {},
    core: {
      recovery: [
        { id: 'r-today', date: TODAY, recordedAt: Date.now(), sleepHours: 8, sleepQuality: 9, energy: 9, soreness: 1, stress: 1 },
      ],
    },
  };
  localStorage.setItem(LS_KEY, JSON.stringify(db));
}

function rosterProposal(over: Partial<AthleteProgressionProposal> = {}): AthleteProgressionProposal {
  return {
    id: 'prop-1',
    domain: 'strength',
    subject: 'Back squat',
    clientKey: 'back_squat',
    before: { kg: 100, reps: 5 },
    after: { kg: 102.5, reps: 5 },
    confidence: 'high',
    hard: false,
    direction: 'increase',
    createdAt: '2026-08-01T00:00:00.000Z',
    ...over,
  };
}

/**
 * `CoachWorkspaceProvider` resolves `clients`/`selectedClient` via an async
 * `useEffect`, same as every other roster screen in this batch — see
 * ArcCoachFrame.test.tsx's `renderFrame()` for why `act(async () => {})`
 * after `render()` is required before any assertion.
 *
 * `CoachCommandCenter` also reads `useDb()` (readiness band) and
 * `useNutrition()` (the nutrition tile) directly, for every client — not
 * just `engine-local` — so both providers are always required, not only for
 * the local-athlete branch.
 */
async function renderCommandCenter(repository: FakeCoachWorkspaceRepository) {
  const result = renderCoachScreen(
    <DbProvider>
      <NutritionProvider>
        <MemoryRouter initialEntries={['/coach']}>
          <CoachCommandCenter />
        </MemoryRouter>
      </NutritionProvider>
    </DbProvider>,
    { repository },
  );
  await act(async () => {});
  return result;
}

beforeEach(() => {
  localStorage.clear();
  resetProgressionLedgerForTests();
});

describe('CoachCommandCenter', () => {
  it('renders a tile per pillar, each linking to its own screen', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [ENGINE_LOCAL_CLIENT];
    await renderCommandCenter(repo);

    expect(screen.getByRole('link', { name: /Readiness/ })).toHaveAttribute('href', '/coach/readiness');
    expect(screen.getByRole('link', { name: /Strength/ })).toHaveAttribute('href', '/coach/strength');
    expect(screen.getByRole('link', { name: /Conditioning/ })).toHaveAttribute('href', '/coach/conditioning');
    expect(screen.getByRole('link', { name: /Nutrition/ })).toHaveAttribute('href', '/coach/nutrition');
  });

  it('shows the signed-in athlete a real readiness band, not the mockup placeholder', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [ENGINE_LOCAL_CLIENT];
    await renderCommandCenter(repo);

    const tile = screen.getByRole('link', { name: /Readiness/ });
    // A fresh DB has no WHOOP data, so the band is the engine's own
    // unknown state — never the mockup's hardcoded "Primed".
    expect(tile).not.toHaveTextContent('Primed');
  });

  it('switching clients swaps the tiles to that client to their own counts', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [ENGINE_LOCAL_CLIENT, ROSTER_CLIENT];
    repo.progressionProposals = [
      rosterProposal({ id: 'p1', domain: 'strength' }),
      rosterProposal({ id: 'p2', domain: 'conditioning', clientKey: 'row_erg', subject: 'Row erg' }),
    ];
    await renderCommandCenter(repo);

    // The mockup replaces the old chip strip with a <select>, so selection
    // is driven by changing it — not by clicking a chip that no longer
    // exists. Same behaviour asserted, new control.
    await act(async () => {
      fireEvent.change(screen.getByRole('combobox', { name: /client/i }), {
        target: { value: ROSTER_CLIENT.id },
      });
    });

    expect(screen.getByRole('link', { name: /Strength/ })).toHaveTextContent('1');
    expect(screen.getByRole('link', { name: /Conditioning/ })).toHaveTextContent('1');
  });

  /*
   * Adapted from the pre-redesign suite's "hides the local-only ... sections
   * for a roster-summary client" test. The old markup had a resolved-week
   * list and an operating-context section to hide; the new tile launcher has
   * none of that below the tiles, so the equivalent claim is narrower and
   * sharper: the Nutrition tile must show ROSTER data (their own days-logged
   * count from the repository), never the signed-in athlete's own
   * `nutritionReview.exceptions` count — the one nutrition read this file
   * still makes directly from local stores.
   */
  it('shows a roster client their own nutrition summary, never the local athlete\'s exception count', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [ROSTER_CLIENT];
    repo.nutritionSummary = { loggedDays: 4, windowDays: 7, trendDirection: 'stable', estimateConfidence: 'medium' };
    await renderCommandCenter(repo);

    const nutritionTile = screen.getByRole('link', { name: /Nutrition/ });
    expect(nutritionTile).toHaveTextContent('4/7 days logged');
    expect(nutritionTile).not.toHaveTextContent('exception');

    // The readiness tile must not claim a band for a client this file has no
    // authorised way to read a band for.
    const readinessTile = screen.getByRole('link', { name: /Readiness/ });
    expect(readinessTile).toHaveTextContent('unknown');
  });

  /*
   * Finding 2 (fix-round 1): the earlier readiness tests only ever exercised
   * an unseeded DB, whose real band ('unknown') is textually identical to
   * the roster fallback — so they could not have caught a leak. This test
   * seeds a real, non-'unknown' band for the signed-in athlete, confirms the
   * seed actually took effect on their own tile, then switches to a roster
   * client and asserts that value is nowhere on screen. Deleting the
   * `isLocalClient` guard on `readinessBand` (CoachCommandCenter.tsx:115)
   * makes this test fail — adversarially verified, see task-2-report.md.
   */
  it('never shows a roster client the signed-in athlete\'s real (non-placeholder) readiness band', async () => {
    seedHighReadinessToday();
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [ENGINE_LOCAL_CLIENT, ROSTER_CLIENT];
    await renderCommandCenter(repo);

    // Confirms the seed worked: the signed-in athlete's own tile carries the
    // real, seeded band, not a fixture default that never leaves 'unknown'.
    expect(screen.getByRole('link', { name: /Readiness/ })).toHaveTextContent('high');

    await act(async () => {
      fireEvent.change(screen.getByRole('combobox', { name: /client/i }), {
        target: { value: ROSTER_CLIENT.id },
      });
    });

    const readinessTile = screen.getByRole('link', { name: /Readiness/ });
    expect(readinessTile).not.toHaveTextContent('high');
    expect(readinessTile).toHaveTextContent('unknown');
  });
});
