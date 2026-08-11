// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { uid, ymd } from '@hybrid/engine';
import {
  emptyNutritionDB,
  quickAddEntry,
  sanitizeNutritionDB,
  type MacroProgram,
  type NutritionDB,
  type WeightEntry,
} from '@hybrid/nutrition-core';
import { addDays } from '@hybrid/nutrition-engine';
import { weekStartOf } from '@hybrid/nutrition-adapter';
import { NUTRITION_LS_KEY, NutritionProvider } from '../../store/nutrition';
import { Coach } from './Coach';

/*
 * The dashboard and its embedded weekly check-in — ported from mobile's
 * `nutrition-coach.test.tsx`, same fixtures, same behaviour asserted: a
 * proposal is offered once the coverage gate clears, a HELD week is
 * information rather than a failure, and the two decisions (accept/decline)
 * produce two different worlds — an accept writes the next program week, a
 * decline preserves the current one, and both are recorded either way.
 */

function readSlice(): NutritionDB {
  return sanitizeNutritionDB(JSON.parse(localStorage.getItem(NUTRITION_LS_KEY) || '{}'));
}

const today = () => ymd(new Date());
const day = (back: number) => addDays(today(), -back);

function atNoon(dayIso: string): string {
  const [y, m, d] = dayIso.split('-').map(Number);
  return new Date(y as number, (m as number) - 1, d, 12).toISOString();
}

function weighIn(dayIso: string, kg: number): WeightEntry {
  const at = atNoon(dayIso);
  return { id: uid(), userId: '', measuredAt: at, weightKg: kg, source: 'manual', note: null, createdAt: at, updatedAt: at, deletedAt: null };
}

function program(rate: number): MacroProgram {
  const at = atNoon(day(20));
  return {
    id: 'program-1',
    userId: '',
    name: 'My macro goal',
    mode: 'manual',
    goal: rate < 0 ? 'lose' : rate > 0 ? 'gain' : 'maintain',
    targetRateKgPerWeek: rate,
    startDate: day(20),
    endDate: null,
    weeklyCalorieBudget: null,
    proteinPreference: null,
    fatPreference: null,
    status: 'active',
    days: [],
    createdAt: at,
    updatedAt: at,
  };
}

function history({
  days = 14,
  kcal = 2800,
  startKg = 90,
  kgPerDay = -0.04,
  weighEvery = 1,
}: { days?: number; kcal?: number; startKg?: number; kgPerDay?: number; weighEvery?: number } = {}) {
  const logEntries = [];
  const weightEntries = [];
  for (let j = 0; j < days; j += 1) {
    const d = day(days - 1 - j);
    logEntries.push(
      quickAddEntry(
        { id: uid(), logDate: d, meal: 'other', at: atNoon(d) },
        { displayName: 'Day total', calories: kcal, proteinG: 0, carbsG: 0, fatG: 0 },
      ),
    );
    if (j % weighEvery === 0) weightEntries.push(weighIn(d, startKg + j * kgPerDay));
  }
  return { logEntries, weightEntries };
}

function seed(over: Partial<NutritionDB> = {}): NutritionDB {
  const db = { ...emptyNutritionDB(), ...over };
  localStorage.setItem(NUTRITION_LS_KEY, JSON.stringify(db));
  return db;
}

function mount() {
  return render(
    <NutritionProvider>
      <Coach />
    </NutritionProvider>,
  );
}

/** Run the check-in and answer it. Returns the slice as stored afterwards. */
function decide(answer: 'Accept' | 'Decline'): NutritionDB {
  fireEvent.click(screen.getByText('Open check-in'));
  fireEvent.click(screen.getByText('Run check-in'));
  fireEvent.click(screen.getByText(answer));
  return readSlice();
}

beforeEach(() => {
  localStorage.clear();
});

describe('the dashboard', () => {
  it('shows the goal, the target, the estimate and confidence from the engine', () => {
    seed({ program: program(-0.25), ...history() });
    mount();

    expect(screen.getByText('Nutrition')).toBeInTheDocument();
    expect(screen.getByText('Coach')).toBeInTheDocument();
    expect(screen.getByText(/Losing/)).toBeInTheDocument();
    expect(screen.getByText('Expenditure updated from logged intake and smoothed weight trend.')).toBeInTheDocument();
  });

  it('renders holding as information, never as an error', () => {
    seed({ program: program(-0.25), ...history({ days: 4 }) });
    mount();

    expect(screen.getByText(/Holding/)).toBeInTheDocument();
    // Verbatim from `coverageExplanation` — not paraphrased by the screen.
    expect(screen.getByText('More history is required before updating expenditure.')).toBeInTheDocument();
    expect(screen.getByText('No estimate yet')).toBeInTheDocument();
    expect(screen.queryByText(/error|failed|couldn.t/i)).toBeNull();
  });

  it('picking and saving a goal rate writes a MacroProgram', () => {
    seed();
    mount();

    fireEvent.click(screen.getByText('-0.5'));
    fireEvent.click(screen.getByText('Save goal'));

    const stored = readSlice().program;
    expect(stored?.targetRateKgPerWeek).toBe(-0.5);
    expect(stored?.goal).toBe('lose');
    expect(stored?.mode).toBe('manual');
  });
});

describe('the embedded check-in pane', () => {
  const readySlice = () => seed({ program: program(-0.25), ...history() });
  const nextWeek = () => addDays(weekStartOf(today()), 7);

  it('opens as a pane of Coach, not a route', () => {
    readySlice();
    mount();

    fireEvent.click(screen.getByText('Open check-in'));
    expect(screen.getByText('Check-in')).toBeInTheDocument();
    expect(screen.getByText('Back to Coach')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Back to Coach'));
    expect(screen.getByText('Coach')).toBeInTheDocument();
  });

  it('accepting records the decision AND writes the next program week', () => {
    readySlice();
    mount();
    const slice = decide('Accept');

    const row = slice.checkIns[0];
    expect(row?.status).toBe('accepted');
    expect(row?.resolvedAt).toEqual(expect.any(String));

    const days = slice.program?.days ?? [];
    expect(days).toHaveLength(7);
    expect(days.map((d) => d.targetDate)).toEqual(Array.from({ length: 7 }, (_u, i) => addDays(nextWeek(), i)));
    expect(new Set(days.map((d) => d.source))).toEqual(new Set(['accepted_check_in']));
    expect(days[0]).toMatchObject({
      calories: row?.proposedCalories,
      proteinG: row?.proposedProteinG,
      carbsG: row?.proposedCarbsG,
      fatG: row?.proposedFatG,
    });
  });

  it('declining records the decision AND leaves the program untouched', () => {
    const before = readySlice();
    mount();
    const slice = decide('Decline');

    const row = slice.checkIns[0];
    expect(row?.status).toBe('declined');
    expect(row?.resolvedAt).toEqual(expect.any(String));
    expect(row?.proposedCalories).toEqual(expect.any(Number));
    expect(slice.program).toEqual(before.program);
  });

  it('will not re-open a week the athlete has already settled', () => {
    readySlice();
    mount();
    decide('Decline');

    expect(screen.queryByText('Run check-in')).toBeNull();
    expect(screen.queryByText('Run check-in again')).toBeNull();
    expect(screen.getByText('You declined this week')).toBeInTheDocument();
  });
});
