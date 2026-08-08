// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { DbProvider } from '../store/db';
import { LS_KEY } from '@hybrid/engine';
import { AthleteStatus } from './AthleteStatus';

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

vi.mock('../cloud/concept2', () => ({
  useConcept2: () => ({ results: [] }),
}));

vi.mock('../cloud/sync', () => ({
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
