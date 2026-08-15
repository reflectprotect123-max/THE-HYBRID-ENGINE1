// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { DbProvider } from '../../store/db';
import { LS_KEY } from '@hybrid/engine';
import { AthleteStatus } from './AthleteStatus';
import { FakeCoachWorkspaceRepository, renderCoachScreen } from '../testing/coach-test-harness';
import type { AthleteTrendSnapshot } from '../data/contracts';

/*
 * docs/RISK_REGISTER.md R8. AthleteStatus is the self-coach "Where they're
 * at" rail card. `capacity.strength`/`capacity.conditioning` come straight
 * from `@hybrid/whole-athlete-state`'s `deriveAthleteState`
 * (packages/whole-athlete-state/src/state.ts), and the `low`-band warning
 * tone `BandChip` paints is the one safety-adjacent signal this specific
 * component renders — this card is a downstream READER of the state
 * package's own banded readiness, never a second place computing pain,
 * illness or a readiness score (CLAUDE.md: recovery/pain/illness logic stays
 * out of the specialist/coach-bench layer). A mapping bug here — say, `low`
 * painted with the same tone as `high` — would silently hide exactly the
 * "athlete is struggling" case a coach glancing at this rail depends on it
 * to surface.
 *
 * `AthleteStatus` is self-coach-only: it reads `useDb()` (for
 * `athleteState`, `sessions`, `workouts`), and `useConcept2()` /
 * `useSync()`+`supabaseClient` directly — never `useCoachWorkspace()`, so
 * this is rendered through `DbProvider` alone (per the FOCUS note), not
 * `renderCoachScreen`/`CoachWorkspaceProvider`. `useConcept2`/`useSync`
 * throw outside their real providers, and the real providers open live
 * network calls that have nothing to do with capacity-band logic —
 * Concept2Provider's status poll, and SyncProvider's Supabase
 * auth/session calls against the project's real, non-test URL baked into
 * `@hybrid/config` (`SUPABASE.url` falls back to a real project when no env
 * var is set, so mounting the real `SyncProvider` in a unit test would
 * actually dial out). Both modules are mocked rather than mounted so this
 * test stays hermetic and fast, leaving `athleteState` driven entirely by a
 * seeded `core.recovery` observation for today.
 */

vi.mock('../../cloud/concept2', () => ({
  useConcept2: () => ({ results: [] }),
}));

vi.mock('../../cloud/sync', () => ({
  useSync: () => ({ user: null }),
  supabaseClient: null,
}));

const TODAY = new Date().toISOString().slice(0, 10);

interface RecoverySignals {
  sleepHours: number;
  sleepQuality: number;
  energy: number;
  soreness: number;
  stress: number;
}

/**
 * Seeds the exact localStorage blob `DbProvider` boots from — `loadDB` reads
 * `LS_KEY` directly (apps/web/src/store/db.tsx) — with one manual recovery
 * observation dated today. Per `readinessSignals()` in
 * packages/whole-athlete-state/src/state.ts, these five fields are averaged
 * into the readiness score that `capacity()` bands at the 70/45 thresholds;
 * no session, workout or life-load data is needed to move it.
 */
function seedRecoveryToday(signals: RecoverySignals) {
  const db = {
    workouts: [],
    sessions: [],
    settings: {},
    core: {
      recovery: [
        {
          id: 'r-today',
          date: TODAY,
          recordedAt: Date.now(),
          ...signals,
        },
      ],
    },
  };
  localStorage.setItem(LS_KEY, JSON.stringify(db));
}

/**
 * `DbProvider` computes `athleteState` synchronously in its render-time
 * `useMemo` (no `.then()` hop like `CoachWorkspaceProvider`'s client list),
 * but `AthleteStatus` still schedules its own best-effort push `useEffect`
 * on mount — `await act(async () => {})` flushes that (and anything else
 * queued) before any assertion runs, matching every other screen in this
 * batch.
 */
async function renderStatus() {
  const result = render(
    <DbProvider>
      <AthleteStatus />
    </DbProvider>,
  );
  await act(async () => {});
  return result;
}

beforeEach(() => {
  localStorage.clear();
});

describe('AthleteStatus', () => {
  it('paints a low capacity band with the warning tone when recovery signals are poor', async () => {
    seedRecoveryToday({ sleepHours: 3, sleepQuality: 1, energy: 1, soreness: 10, stress: 10 });
    await renderStatus();

    const strength = screen.getByText('str low');
    expect(strength).toHaveClass('text-bad');
    const conditioning = screen.getByText('cond low');
    expect(conditioning).toHaveClass('text-bad');
  });

  it('does not paint the warning tone on a high capacity band from strong recovery signals', async () => {
    seedRecoveryToday({ sleepHours: 8, sleepQuality: 9, energy: 9, soreness: 1, stress: 1 });
    await renderStatus();

    const strength = screen.getByText('str high');
    expect(strength).toHaveClass('text-ok');
    expect(strength).not.toHaveClass('text-bad');
    const conditioning = screen.getByText('cond high');
    expect(conditioning).toHaveClass('text-ok');
    expect(conditioning).not.toHaveClass('text-bad');
  });
});

/*
 * Roster branch (`RosterReadinessView`) — the same two-tier consent boundary
 * `CoachNutrition.test.tsx` proves for nutrition. `getTrendSnapshot` and
 * `hasReadinessGrant` are two independent repository calls; only the screen's
 * own `granted &&` gate keeps a returned snapshot out of the document when
 * the athlete never granted the raw-readiness read.
 */

function readinessSnapshot(points: Record<string, unknown>[]): AthleteTrendSnapshot {
  return { kind: 'readiness_trend', points, generatedAt: '2026-08-10T00:00:00Z' };
}

async function renderRoster(repo: FakeCoachWorkspaceRepository) {
  const result = renderCoachScreen(
    <AthleteStatus clientId="roster-1" clientName="Riley Roster" />,
    { repository: repo },
  );
  await act(async () => {});
  return result;
}

describe('AthleteStatus (roster)', () => {
  it('shows the consent-refusal message and never renders readiness rows when hasReadinessGrant resolves false', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.readinessGrant = false;
    // The repository does NOT enforce consent — it hands back whatever is
    // set here. Only the screen's own `granted &&` gate may keep it out.
    repo.trendSnapshots['readiness_trend'] = readinessSnapshot([
      { date: '2026-08-09', recovery: 72, strain: 14.2, hrvMs: 62, restingHr: 48, sleepPerformance: 91 },
    ]);
    await renderRoster(repo);

    expect(
      screen.getByText(/Riley Roster has not granted raw readiness access to your account/),
    ).toBeInTheDocument();
    expect(screen.queryByText('2026-08-09')).not.toBeInTheDocument();
    expect(screen.queryByText(/ms HRV/)).not.toBeInTheDocument();
    expect(screen.queryByText(/logged to Riley Roster/)).not.toBeInTheDocument();
  });

  it('renders newest-first readiness rows, skipping null fields, capped at seven, once granted', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.readinessGrant = true;
    repo.trendSnapshots['readiness_trend'] = readinessSnapshot([
      // Deliberately oldest-first with one extra point beyond the 7-row cap,
      // so the assertions below prove the sort AND the cap.
      { date: '2026-08-02', recovery: 50, strain: 10.1, hrvMs: 55, restingHr: 50, sleepPerformance: 80 },
      { date: '2026-08-03', recovery: 55, strain: 11.0, hrvMs: 56, restingHr: 50, sleepPerformance: 82 },
      { date: '2026-08-04', recovery: 60, strain: 12.0, hrvMs: 57, restingHr: 49, sleepPerformance: 84 },
      { date: '2026-08-05', recovery: 61, strain: 12.5, hrvMs: 58, restingHr: 49, sleepPerformance: 85 },
      { date: '2026-08-06', recovery: 63, strain: 13.0, hrvMs: 59, restingHr: 49, sleepPerformance: 86 },
      { date: '2026-08-07', recovery: 65, strain: 13.5, hrvMs: 60, restingHr: 48, sleepPerformance: 88 },
      { date: '2026-08-08', recovery: 70, strain: null, hrvMs: null, restingHr: null, sleepPerformance: null },
      { date: '2026-08-09', recovery: 72, strain: 14.2, hrvMs: 62, restingHr: 48, sleepPerformance: 91 },
    ]);
    await renderRoster(repo);

    expect(screen.queryByText(/has not granted raw readiness access/)).not.toBeInTheDocument();
    // Fully populated newest point, every field labelled in order.
    expect(screen.getByText('62ms HRV · 48bpm RHR · 91% sleep · 14.2 strain · 72% recovery')).toBeInTheDocument();
    // Null fields are skipped, not printed as "null".
    expect(screen.getByText('70% recovery')).toBeInTheDocument();
    expect(screen.queryByText(/null/)).not.toBeInTheDocument();
    // Capped at the most recent 7 — the oldest (8th) point falls off.
    expect(screen.getByText('2026-08-03')).toBeInTheDocument();
    expect(screen.queryByText('2026-08-02')).not.toBeInTheDocument();
    expect(screen.getByText(/logged to Riley Roster.s receipt trail/)).toBeInTheDocument();
  });

  it('renders the muted empty state when granted but no readiness history exists', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.readinessGrant = true;
    repo.trendSnapshots['readiness_trend'] = readinessSnapshot([]);
    await renderRoster(repo);

    expect(screen.getByText('No readiness history yet.')).toBeInTheDocument();
    expect(screen.queryByText(/logged to Riley Roster/)).not.toBeInTheDocument();
  });
});
