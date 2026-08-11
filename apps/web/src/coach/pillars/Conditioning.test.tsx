// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
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
vi.mock('../../cloud/concept2', () => ({
  useConcept2: () => ({ results: [] }),
}));

function renderPillar() {
  return render(
    <DbProvider>
      <MemoryRouter><Conditioning /></MemoryRouter>
    </DbProvider>,
  );
}

beforeEach(() => localStorage.clear());

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

  it('names how many sessions the HR donut had to exclude', () => {
    // The five-zone breakdown only covers efforts that stored a trace.
    // An effort without one is unknown, not zero, and the screen must say
    // so rather than quietly charting a smaller week.
    renderPillar();
    expect(screen.getByText(/recorded heart rate|no heart-rate|excluded/i)).toBeInTheDocument();
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
