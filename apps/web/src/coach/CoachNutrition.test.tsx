// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { NutritionProvider } from '../store/nutrition';
import { CoachNutrition } from './CoachNutrition';
import { FakeCoachWorkspaceRepository, renderCoachScreen, rosterClient } from './coach-test-harness';
import type { AthleteNutritionSummary, AthleteNutritionWindow } from './contracts';

/*
 * docs/RISK_REGISTER.md R8. CoachNutrition's roster branch (`RosterNutritionView`)
 * is the two-tier consent boundary docs/ARC_LAYER3_DESIGN.md sign-off 2 and
 * finding 6 exist to protect: the SUMMARY tier (adherence %, trend direction,
 * estimate confidence — no raw values) needs only `coaches_athlete`, exactly
 * like every other roster counts screen, but the raw-detail tier (macros,
 * weight, the check-in) needs the athlete's OWN revocable
 * `nutrition_read_grants` consent on top of that. `getNutritionWindow` and
 * `hasNutritionGrant` are two independent repository calls — a gate-inversion
 * bug (rendering the window whenever it happens to be non-null, instead of
 * only when consent is ALSO granted) would leak raw athlete data to a coach
 * who was never granted it, silently, exactly the way the design review
 * finding describes.
 */

/**
 * `CoachWorkspaceProvider` resolves `clients`/`selectedClient` via an async
 * `useEffect`. Before that settles, `selectedClient` is still `null`, so
 * `CoachNutrition` transiently renders `SelfCoachNutritionView` (the
 * self-coach branch), which reads `useNutrition()` — hence wrapping in
 * `NutritionProvider` even though `RosterNutritionView` itself never touches
 * it. Once `selectedClient` resolves to the roster-summary client,
 * `RosterNutritionView` mounts and fires its OWN three async effects
 * (`getNutritionSummary`, `hasNutritionGrant`, `getNutritionWindow`).
 * `act(async () => {})` flushes the whole cascade before any assertion runs,
 * the same pattern every other roster screen in this batch uses.
 */
async function renderNutrition(repository: FakeCoachWorkspaceRepository) {
  const result = renderCoachScreen(
    <NutritionProvider>
      <CoachNutrition />
    </NutritionProvider>,
    { repository },
  );
  await act(async () => {});
  return result;
}

/**
 * Renders the self-coach branch: no roster client is selected, so
 * `selectedClient` stays `null` and `CoachNutrition` falls into
 * `SelfCoachNutritionView`, same pattern as `CoachCommandCenter.test.tsx`'s
 * `renderCommandCenter`.
 */
async function renderSelfNutrition() {
  const repository = new FakeCoachWorkspaceRepository();
  const result = renderCoachScreen(
    <NutritionProvider>
      <CoachNutrition />
    </NutritionProvider>,
    { repository },
  );
  await act(async () => {});
  return result;
}

function nutritionSummaryFixture(over: Partial<AthleteNutritionSummary> = {}): AthleteNutritionSummary {
  return {
    loggedDays: 5,
    windowDays: 7,
    trendDirection: 'losing',
    estimateConfidence: 'medium',
    ...over,
  };
}

/** A distinctive, identifiable value in every field the raw-detail tier can
 *  possibly surface, so a leak of ANY of them is independently detectable. */
function nutritionWindowFixture(over: Partial<AthleteNutritionWindow> = {}): AthleteNutritionWindow {
  return {
    dailyStatus: [{ date: '2026-08-03', status: 'complete', note: null }],
    weightEntries: [{ measuredAt: '2026-08-03', weightKg: 123.4 }],
    macroTargets: [{ date: '2026-08-03', calories: 2500, proteinG: 190, carbsG: 260, fatG: 80 }],
    latestCheckIn: {
      status: 'holding',
      explanation: 'DISTINCT_CHECKIN_EXPLANATION_TOKEN',
      proposedCalories: 1999,
      proposedProteinG: 111,
      proposedCarbsG: 222,
      proposedFatG: 33,
    },
    ...over,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('CoachNutrition (roster)', () => {
  it('shows the nutrition summary tier even when the coach holds no raw-detail consent grant', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [rosterClient()];
    repo.nutritionGrant = false;
    repo.nutritionSummary = nutritionSummaryFixture();
    await renderNutrition(repo);

    expect(screen.getByText('5/7')).toBeInTheDocument();
    expect(screen.getByText('losing')).toBeInTheDocument();
    expect(screen.getByText('medium')).toBeInTheDocument();
  });

  it('shows a consent-required message and never renders the populated window when hasNutritionGrant resolves false', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [rosterClient({ name: 'Riley Roster' })];
    repo.nutritionGrant = false;
    // The repository itself does NOT enforce consent (a real backend gates
    // this in SQL — see finding 6) — it hands back whatever is set here.
    // Only the screen's own `granted && window_ &&` check may keep this out
    // of the document. That is the exact gate this test exists to prove.
    repo.nutritionWindow = nutritionWindowFixture();
    await renderNutrition(repo);

    expect(
      screen.getByText(/Riley Roster has not granted raw nutrition access to your account/),
    ).toBeInTheDocument();

    expect(screen.queryByText('2026-08-03')).not.toBeInTheDocument();
    expect(screen.queryByText('complete')).not.toBeInTheDocument();
    expect(screen.queryByText('DISTINCT_CHECKIN_EXPLANATION_TOKEN')).not.toBeInTheDocument();
    expect(screen.queryByText('holding')).not.toBeInTheDocument();
    expect(screen.queryByText('123.4')).not.toBeInTheDocument();
    expect(screen.queryByText(/unlogged this week/)).not.toBeInTheDocument();
    expect(screen.queryByText(/kg latest/)).not.toBeInTheDocument();
    expect(screen.queryByText(/g protein/)).not.toBeInTheDocument();
    expect(screen.queryByText(/logged to Riley Roster/)).not.toBeInTheDocument();
  });

  it('renders the raw nutrition window once hasNutritionGrant resolves true', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [rosterClient({ name: 'Riley Roster' })];
    repo.nutritionGrant = true;
    repo.nutritionWindow = nutritionWindowFixture();
    await renderNutrition(repo);

    expect(screen.queryByText(/has not granted raw nutrition access/)).not.toBeInTheDocument();
    expect(screen.getByText('2026-08-03')).toBeInTheDocument();
    expect(screen.getByText('complete')).toBeInTheDocument();
    expect(screen.getByText('DISTINCT_CHECKIN_EXPLANATION_TOKEN')).toBeInTheDocument();
    expect(screen.getByText('holding')).toBeInTheDocument();
    expect(screen.getByText(/logged to Riley Roster.s receipt trail/)).toBeInTheDocument();
  });

  it('renders the unlogged callout, latest macro targets and weight trend inside the granted window', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [rosterClient({ name: 'Riley Roster' })];
    repo.nutritionGrant = true;
    repo.nutritionWindow = nutritionWindowFixture({
      dailyStatus: [
        { date: '2026-08-03', status: 'complete', note: null },
        { date: '2026-08-04', status: 'unlogged', note: null },
        { date: '2026-08-05', status: 'unlogged', note: null },
      ],
      weightEntries: [
        { measuredAt: '2026-08-03', weightKg: 78.7 },
        { measuredAt: '2026-08-08', weightKg: 78.4 },
      ],
      macroTargets: [
        { date: '2026-08-03', calories: 2400, proteinG: 180, carbsG: 260, fatG: 70 },
        { date: '2026-08-05', calories: 2500, proteinG: 190, carbsG: 270, fatG: 75 },
      ],
    });
    await renderNutrition(repo);

    expect(screen.getByText('2 days unlogged this week.')).toBeInTheDocument();
    // No date matches today, so the LATEST target by date is shown — targets
    // only, never an actual-vs-target bar (no actuals exist at this tier).
    expect(screen.getByText('2500 kcal · 190g protein · 270g carbs · 75g fat')).toBeInTheDocument();
    expect(screen.getByText('78.4kg latest · -0.3kg this week')).toBeInTheDocument();
  });

  it('renders muted empty states when the granted window has no targets and no weigh-ins', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [rosterClient()];
    repo.nutritionGrant = true;
    repo.nutritionWindow = nutritionWindowFixture({ weightEntries: [], macroTargets: [] });
    await renderNutrition(repo);

    expect(screen.getByText('No targets set.')).toBeInTheDocument();
    expect(screen.getByText('No weigh-ins this week.')).toBeInTheDocument();
    expect(screen.queryByText(/unlogged this week/)).not.toBeInTheDocument();
  });
});

describe('CoachNutrition (self-coach)', () => {
  it('renders Actionable exceptions first in DOM order, ahead of the collapsed reference sections, on the self-coach nutrition screen', async () => {
    const { container } = await renderSelfNutrition();
    const exceptionsSection = container.querySelector('section[aria-labelledby="exceptions-title"]');
    const firstDetails = container.querySelector('details');
    expect(exceptionsSection).toBeInTheDocument();
    expect(firstDetails).toBeInTheDocument();
    expect(exceptionsSection!.compareDocumentPosition(firstDetails!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('collapses the Data state and Current program sections by default', async () => {
    const { container } = await renderSelfNutrition();
    const dataStateSummary = screen.getByText(/days declared/);
    const dataStateDetails = dataStateSummary.closest('details');
    expect(dataStateDetails).not.toHaveAttribute('open');
    expect(within(dataStateDetails as HTMLElement).getByText(/Unlogged means unknown/)).not.toBeVisible();

    const programSummary = screen.getByText('No program established');
    const programDetails = programSummary.closest('details');
    expect(programDetails).not.toHaveAttribute('open');

    expect(container.querySelector('section[aria-labelledby="exceptions-title"]')?.tagName).not.toBe('DETAILS');
  });
});
