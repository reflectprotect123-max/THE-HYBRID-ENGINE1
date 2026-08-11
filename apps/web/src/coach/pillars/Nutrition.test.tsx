// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useEffect } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  currentEstimate,
  latestWeighIn,
  weighInCoverage,
  weightTrendSummary,
} from '@hybrid/nutrition-adapter';
import {
  emptyNutritionDB,
  type FoodLogEntry,
  type MacroProgram,
  type NutritionDB,
  type WeightEntry,
} from '@hybrid/nutrition-core';
import { DbProvider } from '../../store/db';
import { NutritionProvider, useNutrition } from '../../store/nutrition';
import { Nutrition } from './Nutrition';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * `getByText`'s default matcher only looks at an element's OWN direct
 * text-node children, never a nested element's — so a value split across a
 * `<p>` and a child `<span>` (e.g. `Metric`'s `rm-value`/`rm-unit`) is
 * invisible to a plain string or RegExp query even though it reads as one
 * line on screen. This checks the element's full, whitespace-collapsed
 * `textContent` instead — the documented escape hatch for exactly that
 * "text is broken up by multiple elements" case.
 */
function byFullText(expected: string, tag = 'p') {
  return (_content: string, element: Element | null) =>
    element !== null &&
    element.tagName.toLowerCase() === tag &&
    (element.textContent ?? '').replace(/\s+/g, ' ').trim() === expected;
}

function isoDate(base: string, offsetDays: number): string {
  const d = new Date(`${base}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

let seq = 0;

function foodEntry(logDate: string, meal: string, calories: number, proteinG: number, carbsG: number, fatG: number): FoodLogEntry {
  seq += 1;
  const stamp = `${logDate}T12:00:00.000Z`;
  return {
    id: `entry-${seq}`,
    userId: '',
    logDate,
    meal,
    entryKind: 'food',
    quantity: 1,
    unit: 'serving',
    calories,
    proteinG,
    carbsG,
    fatG,
    displayName: meal,
    nutrients: {},
    sourceSnapshot: {},
    createdAt: stamp,
    updatedAt: stamp,
  };
}

/** Noon UTC, so a test sandbox running in any reasonable local timezone still
 *  buckets to the same calendar day `weighInDay`'s local `ymd` would read. */
function weightEntry(date: string, weightKg: number): WeightEntry {
  seq += 1;
  const stamp = `${date}T12:00:00.000Z`;
  return { id: `weight-${seq}`, userId: '', measuredAt: stamp, weightKg, source: 'manual', createdAt: stamp, updatedAt: stamp };
}

function programWithTodayTarget(
  day: string,
  target: { calories: number; proteinG: number; carbsG: number; fatG: number },
): MacroProgram {
  return {
    id: 'program-1',
    userId: '',
    name: 'Test program',
    mode: 'manual',
    goal: 'lose',
    targetRateKgPerWeek: -0.3,
    startDate: isoDate(day, -30),
    status: 'active',
    days: [{ programId: 'program-1', targetDate: day, ...target, source: 'engine', createdAt: `${day}T00:00:00.000Z` }],
    createdAt: `${day}T00:00:00.000Z`,
    updatedAt: `${day}T00:00:00.000Z`,
  };
}

/** Seeds `NutritionProvider` through its real `update()` path — the same
 *  write every other caller uses — rather than hand-writing localStorage and
 *  routing it through `sanitizeNutritionDB`'s field-by-field cleaners, which
 *  this fixture has no need to exercise. */
function Seed({ db }: { db: NutritionDB }) {
  const { update } = useNutrition();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    update((draft) => {
      Object.assign(draft, db);
    });
  }, []);
  return null;
}

function renderPillar(db?: NutritionDB) {
  return render(
    <DbProvider>
      <NutritionProvider>
        {db && <Seed db={db} />}
        <MemoryRouter><Nutrition /></MemoryRouter>
      </NutritionProvider>
    </DbProvider>,
  );
}

beforeEach(() => localStorage.clear());

describe('Nutrition pillar', () => {
  it('offers a way back to the Command Center', () => {
    renderPillar();
    expect(screen.getByRole('link', { name: /Command Center/ })).toHaveAttribute('href', '/coach');
  });

  it('reports unlogged days as unlogged, not as zero-calorie days', () => {
    renderPillar();
    expect(screen.getByText(/0 of 7|unlogged|no days logged/i)).toBeInTheDocument();
  });

  it('states absent weigh-in data rather than a fake trend', () => {
    renderPillar();
    expect(screen.getByText(/no weigh-ins recorded/i)).toBeInTheDocument();
  });

  it('states an absent macro target rather than a fabricated 0g bar', () => {
    renderPillar();
    expect(screen.getAllByText(/no target set/i).length).toBe(3);
  });

  it('states a real target as not logged today, rather than a fabricated actual', async () => {
    const day = today();
    const db = emptyNutritionDB();
    db.program = programWithTodayTarget(day, { calories: 2000, proteinG: 150, carbsG: 180, fatG: 55 });
    // Deliberately no log entries today: a real target exists, but nothing
    // has been logged against it yet.
    renderPillar(db);
    expect(await screen.findAllByText(/not logged yet today/i)).toHaveLength(3);
  });

  it('renders real macro actual-vs-target numbers, weigh-ins and weight trend from logged data', async () => {
    const day = today();
    const db = emptyNutritionDB();
    db.program = programWithTodayTarget(day, { calories: 2200, proteinG: 170, carbsG: 200, fatG: 60 });
    db.logEntries = [
      foodEntry(day, 'breakfast', 900, 80, 90, 25),
      foodEntry(day, 'lunch', 900, 70, 90, 30),
    ];
    db.weightEntries = [
      weightEntry(isoDate(day, -6), 79.5),
      weightEntry(isoDate(day, -3), 79.0),
      weightEntry(day, 78.4),
    ];
    renderPillar(db);

    // Actual totals are the plain sum of the two entries above: 150g
    // protein, 180g carbs, 55g fat — real numbers, not derived from the
    // component under test.
    expect(await screen.findByText('150 of 170 g')).toBeInTheDocument();
    expect(screen.getByText('180 of 200 g')).toBeInTheDocument();
    expect(screen.getByText('55 of 60 g')).toBeInTheDocument();

    // Weigh-ins and weight trend are computed here from the same real
    // `@hybrid/nutrition-adapter` functions the component calls, over the
    // identical fixture db — this pins the component's WIRING and
    // formatting to real output, without re-deriving the engine's own EWMA
    // math (nutrition-review.test.ts and the engine's own suite already
    // cover that). The value and its unit render as two DOM text nodes
    // split across a nested `<span>` (visually one line via CSS margin, per
    // the mockup's own markup), so `getByText`'s default per-node text
    // match — direct text-node children only, never a descendant's — can't
    // see the combined string; `byFullText` reads the element's whole
    // `textContent` instead.
    const estimate = currentEstimate(db, day);
    const coverage = weighInCoverage(estimate);
    expect(screen.getByText(byFullText(`${coverage.weightDays} of ${coverage.windowDays}`))).toBeInTheDocument();

    const latest = latestWeighIn(db);
    expect(latest).not.toBeNull();
    expect(screen.getByText(byFullText(`${latest!.weightKg.toFixed(1)} kg latest`))).toBeInTheDocument();

    const trend = weightTrendSummary(estimate);
    if (trend.slopeKgPerWeek != null) {
      const sign = trend.slopeKgPerWeek > 0 ? '\\+' : '';
      expect(screen.getByText(new RegExp(`${sign}${trend.slopeKgPerWeek.toFixed(1)} kg/week · ${trend.direction}`))).toBeInTheDocument();
    }
  });

  it('renders a real exception that is not about unlogged days, badging what CoachCommandCenter counts', async () => {
    const day = today();
    const db = emptyNutritionDB();
    // 80g protein + 90g carbs + 70g fat = 1310 macro kcal against a 900 kcal
    // target — a real macro-overshoot contradiction, independent of any
    // unlogged day.
    db.program = programWithTodayTarget(day, { calories: 900, proteinG: 80, carbsG: 90, fatG: 70 });
    renderPillar(db);
    expect(await screen.findByText(/macro target exceeds calorie target/i)).toBeInTheDocument();
    expect(screen.getByText(/1310 kcal, 410 kcal above the target/i)).toBeInTheDocument();
    // The `next` half of the exception is not dropped.
    expect(screen.getByText(/do not silently rebalance the engine output/i)).toBeInTheDocument();
  });

  it('orders exceptions with attention priority before information', async () => {
    const day = today();
    const db = emptyNutritionDB();
    // 'attention' (macro-overshoot) plus 'information' (logging-coverage,
    // since nothing this week is logged) in the same fixture.
    db.program = programWithTodayTarget(day, { calories: 900, proteinG: 80, carbsG: 90, fatG: 70 });
    const { container } = renderPillar(db);
    await screen.findByText(/macro target exceeds calorie target/i);
    const titles = Array.from(container.querySelectorAll('.alert-title')).map((el) => el.textContent ?? '');
    const overshootIndex = titles.findIndex((t) => /macro target exceeds/i.test(t));
    const coverageIndex = titles.findIndex((t) => /incomplete evidence/i.test(t));
    expect(overshootIndex).toBeGreaterThanOrEqual(0);
    expect(coverageIndex).toBeGreaterThanOrEqual(0);
    expect(overshootIndex).toBeLessThan(coverageIndex);
  });
});
