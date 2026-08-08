// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { act, screen } from '@testing-library/react';
import { DbProvider } from '../store/db';
import { NutritionProvider } from '../store/nutrition';
import { WeekReview } from './WeekReview';
import type { AthleteWeekSummary } from './contracts';
import { FakeCoachWorkspaceRepository, renderCoachScreen, rosterClient } from './coach-test-harness';

/*
 * docs/RISK_REGISTER.md R8. For a `roster-summary` client, `WeekReview`
 * branches into `RosterWeekReview`, which reads `AthleteWeekSummary` from
 * `repository.getAthleteWeekSummary` — a DELIBERATELY thinner shape than the
 * self-coach `buildWeekReview` ledger (see contracts.ts's `AthleteWeekSummary`
 * doc comment): entries, decisions and session SUMMARIES only, never
 * block/set detail, and never a reconciled planned-vs-actual match (no
 * `workoutId` round-trips through this tier). The two facts worth a real
 * render test: the roster view must show exactly what the summary carries
 * (nothing fabricated, nothing reconciled), and it must have a distinct,
 * honest empty state rather than a blank screen when the summary isn't
 * readable.
 */

/**
 * Same shape as `ArcCoachFrame.test.tsx`'s `renderFrame()`, plus one more
 * hop: `CoachWorkspaceProvider` resolves `selectedClient` via
 * `repository.listClients().then(setClients)` first, and only once that
 * settles does `RosterWeekReview`'s own effect (`repository.getAthleteWeekSummary`)
 * fire. `await act(async () => {})` after `render()` flushes both microtask
 * hops before any assertion runs.
 *
 * Before `selectedClient` resolves it is transiently `null`, so `WeekReview`
 * falls into the self-coach branch (`SelfCoachWeekReview`) for that first
 * render, which reads `useDb()`/`useNutrition()`/the auto-coach ledger — the
 * same transient-branch shape `CoachNutrition.test.tsx` documents. Wrapping
 * in `DbProvider`/`NutritionProvider` (App.tsx's real nesting) is required
 * even though the roster fixture never intends to exercise that branch.
 */
async function renderWeekReview(repository: FakeCoachWorkspaceRepository, weekStart = '2026-08-03') {
  const result = renderCoachScreen(
    <DbProvider>
      <NutritionProvider>
        <MemoryRouter initialEntries={[`/coach/review/${weekStart}`]}>
          <Routes>
            <Route path="/coach/review/:weekStart" element={<WeekReview />} />
          </Routes>
        </MemoryRouter>
      </NutritionProvider>
    </DbProvider>,
    { repository },
  );
  await act(async () => {});
  return result;
}

function weekSummary(over: Partial<AthleteWeekSummary> = {}): AthleteWeekSummary {
  return {
    entries: [],
    decisions: [],
    sessions: [],
    ...over,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('WeekReview (roster tier)', () => {
  it('renders entries, decisions and session summaries from AthleteWeekSummary, and excludes scheduled decisions from "what competed and lost"', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [rosterClient({ id: 'roster-1', name: 'Riley Roster' })];
    repo.weekSummary = weekSummary({
      entries: [
        { proposalId: 'p1', domain: 'strength', date: '2026-08-04', status: 'scheduled', title: 'Heavy squat day' },
      ],
      decisions: [
        { proposalId: 'p1', action: 'scheduled', reasonCode: 'accepted', explanation: 'Placed on Tuesday without conflict.' },
        { proposalId: 'p2', action: 'dropped', reasonCode: 'dropped_pain_safety', explanation: 'Held for a reported pain flag.' },
      ],
      sessions: [
        { id: 's1', kind: 'strength', date: '2026-08-05', status: 'completed', name: 'Morning lift' },
      ],
    });

    await renderWeekReview(repo);

    // Heading identifies the roster client, proving RosterWeekReview (not the
    // self-coach screen) mounted.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Riley Roster.{0,3}s week of/);

    // Planned entry: title and the domain/status line, not fabricated detail.
    expect(screen.getByText('Heavy squat day')).toBeInTheDocument();
    expect(screen.getByText('strength · scheduled')).toBeInTheDocument();

    // Recorded session: name and the kind/status line.
    expect(screen.getByText('Morning lift')).toBeInTheDocument();
    expect(screen.getByText('strength · completed')).toBeInTheDocument();

    // Dropped decision surfaces its reasonCode (underscores replaced with
    // spaces) and explanation under "What competed and lost".
    expect(screen.getByText('dropped pain safety')).toBeInTheDocument();
    expect(screen.getByText('Held for a reported pain flag.')).toBeInTheDocument();

    // The SCHEDULED decision must not appear in that section — only
    // action === 'dropped' decisions do.
    expect(screen.queryByText('accepted')).not.toBeInTheDocument();
    expect(screen.queryByText('Placed on Tuesday without conflict.')).not.toBeInTheDocument();

    // Exactly one card per list item — nothing fabricated beyond what the
    // summary carries (one planned entry + one recorded session + one
    // dropped decision, not the two decisions or any synthesized row).
    expect(screen.getAllByRole('article')).toHaveLength(3);
  });

  it('shows a distinct "not readable" empty state, not a crash or blank screen, when the summary is null', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [rosterClient({ id: 'roster-1', name: 'Riley Roster' })];
    repo.weekSummary = null;

    await renderWeekReview(repo);

    expect(screen.getByText('Not readable for this week.')).toBeInTheDocument();
    // Distinct from the loading state and from a populated one: no section
    // headings, no article cards render at all.
    expect(screen.queryByText('Planned')).not.toBeInTheDocument();
    expect(screen.queryByText('Recorded')).not.toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
});
