// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LS_KEY, type CondResult, type Session } from '@hybrid/engine';
import { DbProvider } from '../../store/db';
import { Conditioning } from './Conditioning';

/*
 * `Conditioning` calls `useConcept2()` unconditionally, matching its real
 * production wiring — `/coach/*` mounts inside `<Concept2Provider>` in
 * App.tsx. Mounting the real provider here would open a live status poll
 * against a real, non-test URL for no reason this suite needs, so the
 * module is mocked instead, exactly like `AthleteStatus.test.tsx` does for
 * the same hook.
 */
let concept2Results: unknown[] = [];
vi.mock('../../cloud/concept2', () => ({
  useConcept2: () => ({ results: concept2Results }),
}));

function renderPillar() {
  return render(
    <DbProvider>
      <MemoryRouter><Conditioning /></MemoryRouter>
    </DbProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  concept2Results = [];
});

describe('Conditioning pillar', () => {
  it('offers a way back to the Command Center', () => {
    renderPillar();
    expect(screen.getByRole('link', { name: /Command Center/ })).toHaveAttribute('href', '/coach');
  });

  it('shows no zone minutes at all when nothing has been logged', () => {
    // A fresh DB has no sessions. The mockup's 62m/40m/18m split is
    // furniture; rendering it would invent training that never happened.
    renderPillar();
    expect(screen.queryByText('62m')).not.toBeInTheDocument();
    expect(screen.queryByText('40m')).not.toBeInTheDocument();
    expect(screen.queryByText('18m')).not.toBeInTheDocument();
  });

  /*
   * REWRITTEN 11 August 2026 (Stage-1 final review). This used to render an
   * EMPTY database and assert
   * `/recorded heart rate|no heart-rate|excluded/i` — every one of which
   * appears in the donut note's unconditional opening sentence. It passed
   * with the entire `excludedCount` derivation deleted, which is the only
   * thing it was there to protect. It now asserts the COUNT, in both
   * directions: silent when nothing was excluded, exact when something was.
   */
  it('names how many efforts the HR donut had to exclude — and stays silent when none were', () => {
    const monday = mondayOfThisWeek();
    const traced = condSession('cond-traced', monday, {
      id: 'r-traced',
      fmt: 'steady',
      dur: 600,
      zsec: { low: 300, mod: 200, high: 100 },
      startedAt: Date.now(),
      trace: { every: 10, pts: Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? 150 : 120)) },
    });
    const untraced = condSession('cond-untraced', monday, {
      id: 'r-untraced',
      fmt: 'steady',
      dur: 300,
      zsec: { low: 300, mod: 0, high: 0 },
      startedAt: Date.now(),
    });
    const settings = { profile: { age: '30' } };

    localStorage.setItem(
      LS_KEY,
      JSON.stringify({ workouts: [], sessions: [traced], settings, core: {} }),
    );
    const allTraced = renderPillar();
    expect(screen.queryByText(/excluded from the donut\./)).not.toBeInTheDocument();
    allTraced.unmount();

    localStorage.setItem(
      LS_KEY,
      JSON.stringify({ workouts: [], sessions: [traced, untraced], settings, core: {} }),
    );
    renderPillar();
    expect(
      screen.getByText(
        /1 of 2 conditioning efforts logged this week had no recorded heart rate and is excluded from the donut\./,
      ),
    ).toBeInTheDocument();
  });
});

/*
 * Additional coverage below, exercising the real-data derivation this
 * screen depends on: the three-band zone bar sums `condResult.zsec`, the
 * five-zone donut sums `hrMaxBandSeconds` over stored traces only, a
 * completed effort with no heart-rate trace is counted as excluded rather
 * than folded in as zero, and — the regression a literal reading of
 * `session.condResult` alone would silently reintroduce — a STANDALONE
 * effort (started from Home with no session context, banked into
 * `settings.conditioning` by `screens/Conditioning.tsx`'s
 * `submitMechanical`) counts in the weekly total exactly like a
 * session-block one does, via `condEfforts()`.
 */

function condSession(id: string, date: string, result: CondResult): Session {
  return {
    id,
    date,
    kind: 'conditioning',
    status: 'completed',
    blocks: [{ id: `${id}-b1`, kind: 'conditioning', condFmt: 'steady', condResult: result }],
  } as Session;
}

function mondayOfThisWeek(): string {
  const d = new Date();
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d.toISOString().slice(0, 10);
}

describe('Conditioning pillar — real data derivation', () => {
  it('sums the three-band zone bar and the five-zone HR donut from stored sessions, and flags the untraced one', () => {
    const monday = mondayOfThisWeek();
    // Session A: a full HR trace, evenly split across the run — real seconds
    // banked by both the three-band model and the five-zone %HRmax model.
    const tracedSamples = Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? 150 : 120));
    const sessionA = condSession('cond-a', monday, {
      id: 'r-a',
      fmt: 'steady',
      dur: 600,
      zsec: { low: 300, mod: 200, high: 100 },
      startedAt: Date.now(),
      trace: { every: 10, pts: tracedSamples },
    });
    // Session B: completed, but no heart-rate trace at all — must be
    // excluded from the donut, never charted as a zero contribution.
    const sessionB = condSession('cond-b', monday, {
      id: 'r-b',
      fmt: 'steady',
      dur: 300,
      zsec: { low: 300, mod: 0, high: 0 },
      startedAt: Date.now(),
    });
    const db = {
      workouts: [],
      sessions: [sessionA, sessionB],
      settings: { profile: { age: '30' } },
      core: {},
    };
    localStorage.setItem(LS_KEY, JSON.stringify(db));

    const { container } = renderPillar();

    // Total logged minutes: (600 + 300) / 60 = 15.
    expect(container.querySelector('.rd-cond-total .rv')?.textContent).toBe('15min');
    // Three-band bar: 600s low, 200s mod, 100s high across both sessions.
    expect(screen.getByText('10m')).toBeInTheDocument(); // low: (300+300)/60
    expect(screen.getByText('3m')).toBeInTheDocument(); // mod: 200/60 rounds to 3
    expect(screen.getByText('2m')).toBeInTheDocument(); // high: 100/60 rounds to 2

    // Exactly one of the two efforts is excluded from the donut.
    expect(screen.getByText(/1 of 2 conditioning efforts logged this week/)).toBeInTheDocument();
  });

  it('counts a standalone conditioning effort (no session, no block) in the weekly total', () => {
    // Home's "Start conditioning" with no session context banks straight
    // into `settings.conditioning` — `screens/Conditioning.tsx:441-447`.
    // No `Session` exists for this effort at all.
    const monday = mondayOfThisWeek();
    const standalone: CondResult = {
      id: 'r-standalone',
      fmt: 'steady',
      dur: 480,
      zsec: { low: 480, mod: 0, high: 0 },
      startedAt: Date.parse(`${monday}T09:00:00Z`),
    };
    const db = {
      workouts: [],
      sessions: [],
      settings: { profile: { age: '30' }, conditioning: [standalone] },
      core: {},
    };
    localStorage.setItem(LS_KEY, JSON.stringify(db));

    const { container } = renderPillar();

    // 480s / 60 = 8 minutes — invisible to this screen if only
    // `session.condResult` were read, since no session exists.
    expect(container.querySelector('.rd-cond-total .rv')?.textContent).toBe('8min');
    expect(screen.getByText('8m')).toBeInTheDocument(); // all of it in the Easy bucket
  });
});

/*
 * The erg card's range toggle. Added 11 August 2026 by the Stage-1 final
 * review, which found the card had none: its expanded view drew
 * `ergSparkPath` from the same `points` array as the collapsed sparkline, so
 * expanding it enlarged eight identical points, while the mockup emits
 * `.rd-range-toggle` for every card including `#conditioning-cards`.
 *
 * The omission rested on `ergTrend(results, maxPoints = 8)`'s default being
 * read as a limit on the DATA — the third time on this branch a helper's
 * default argument was mistaken for the ceiling. It is not one:
 * `concept2-sync.mjs` retains up to `MAX_STORED_RESULTS = 500` results and
 * trims by count, never by date, so these fixtures (30 tests) are well
 * inside what a real Logbook connection carries.
 */
function ergResult(index: number, distance: number, durationTenths: number) {
  return {
    externalId: `erg-${distance}-${index}`,
    modality: 'rower',
    distanceRaw: distance,
    durationRaw: durationTenths,
    startedAt: `2026-0${1 + Math.floor(index / 28)}-${String((index % 28) + 1).padStart(2, '0')} 07:00:00`,
  };
}

function bigChartPointCount(): number {
  const polyline = document.querySelector('.rd-big-chart polyline');
  expect(polyline).toBeTruthy();
  return polyline!.getAttribute('points')!.trim().split(/\s+/).length;
}

describe('erg card range toggle', () => {
  it('draws genuinely more real tests for a wider range, and never pads up to it', () => {
    // 30 real 2000m rows, each a second faster than the last, so an 8-point
    // window and a 20-point window can never be accidentally identical.
    concept2Results = Array.from({ length: 30 }, (_, i) => ergResult(i, 2000, 4400 - i * 10));
    renderPillar();

    fireEvent.click(screen.getByRole('button', { name: /Expand .* chart/ }));
    expect(bigChartPointCount()).toBe(8); // 8 is the default on open

    fireEvent.click(screen.getByRole('button', { name: '20' }));
    expect(bigChartPointCount()).toBe(20);

    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(bigChartPointCount()).toBe(30);
    // "All" is all there really is — no padding to some rounder number.
    expect(screen.queryByText(/not a full/)).not.toBeInTheDocument();
  });

  it('says how little history there really is rather than faking the window', () => {
    concept2Results = Array.from({ length: 12 }, (_, i) => ergResult(i, 2000, 4400 - i * 10));
    renderPillar();

    fireEvent.click(screen.getByRole('button', { name: /Expand .* chart/ }));
    fireEvent.click(screen.getByRole('button', { name: '20' }));

    expect(bigChartPointCount()).toBe(12);
    expect(
      screen.getByText(/Only 12 tests on record for this format — showing all of them, not a full 20-test window\./),
    ).toBeInTheDocument();
  });

  it('cannot swap which test the card is showing when the range widens', () => {
    // 20 x 2000m and 6 x 500m: the 2000m group is the largest, and
    // `ergTrend` picks the group BEFORE applying `maxPoints`, so widening
    // the range must never re-point the card at the 500m series.
    concept2Results = [
      ...Array.from({ length: 20 }, (_, i) => ergResult(i, 2000, 4400 - i * 10)),
      ...Array.from({ length: 6 }, (_, i) => ergResult(i, 500, 1000 - i * 10)),
    ];
    renderPillar();

    const label = screen.getByText(/2000m rower/);
    fireEvent.click(screen.getByRole('button', { name: /Expand .* chart/ }));
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(label).toBeInTheDocument();
    expect(screen.queryByText(/500m rower/)).not.toBeInTheDocument();
  });
});
