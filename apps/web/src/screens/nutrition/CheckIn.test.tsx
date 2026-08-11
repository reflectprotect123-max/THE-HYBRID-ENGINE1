// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
import { CheckInScreen } from './CheckIn';

/*
 * The pane in isolation — `Coach.test.tsx`'s "embedded check-in pane" block
 * covers it wired into the dashboard; this file pins its own rendering of
 * the engine's coverage/overshoot numbers and its write path directly, the
 * same division `Weight.test.tsx`/`FoodLog.test.tsx` already use between a
 * screen's own file and a cross-screen flow test.
 */

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

function readSlice(): NutritionDB {
  return sanitizeNutritionDB(JSON.parse(localStorage.getItem(NUTRITION_LS_KEY) || '{}'));
}

function mount(onBack = () => {}) {
  return render(
    <NutritionProvider>
      <CheckInScreen onBack={onBack} />
    </NutritionProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe('no goal / no weigh-in', () => {
  it('sends the athlete back to Coach when there is no goal yet', () => {
    seed();
    const onBack = vi.fn();
    mount(onBack);

    expect(screen.getByText('No goal yet')).toBeInTheDocument();
    fireEvent.click(screen.getAllByText('Back to Coach')[0] as HTMLElement);
    expect(onBack).toHaveBeenCalled();
  });

  it('asks for a weigh-in before it will propose anything', () => {
    seed({ program: program(-0.25) });
    mount();

    expect(screen.getByText('No weigh-in yet')).toBeInTheDocument();
  });
});

describe('ready week', () => {
  it('running the check-in records a pending proposal with the engine numbers', () => {
    seed({ program: program(-0.25), ...history() });
    mount();

    fireEvent.click(screen.getByText('Run check-in'));

    const row = readSlice().checkIns[0];
    expect(row?.status).toBe('pending');
    expect(row?.proposedCalories).toEqual(expect.any(Number));
    expect(row?.resolvedAt).toBeNull();
    expect(screen.getByText('Accept')).toBeInTheDocument();
    expect(screen.getByText('Decline')).toBeInTheDocument();
  });

  it('accepting writes exactly next week’s seven MacroProgramDay rows, provenanced to the accepted check-in', () => {
    seed({ program: program(-0.25), ...history() });
    mount();

    fireEvent.click(screen.getByText('Run check-in'));
    const proposed = readSlice().checkIns[0];
    fireEvent.click(screen.getByText('Accept'));

    const slice = readSlice();
    expect(slice.checkIns[0]?.status).toBe('accepted');
    const nextWeek = addDays(weekStartOf(today()), 7);
    const days = slice.program?.days ?? [];
    expect(days).toHaveLength(7);
    expect(days[0]?.targetDate).toBe(nextWeek);
    expect(days[6]?.targetDate).toBe(addDays(nextWeek, 6));
    expect(new Set(days.map((d) => d.source))).toEqual(new Set(['accepted_check_in']));
    expect(days[0]?.calories).toBe(proposed?.proposedCalories);
  });

  it('declining writes nothing onto the program', () => {
    seed({ program: program(-0.25), ...history() });
    mount();

    fireEvent.click(screen.getByText('Run check-in'));
    fireEvent.click(screen.getByText('Decline'));

    const slice = readSlice();
    expect(slice.checkIns[0]?.status).toBe('declined');
    expect(slice.program?.days ?? []).toHaveLength(0);
  });
});

describe('held week', () => {
  it('renders holding as information and records a held row with no proposed targets', () => {
    seed({ program: program(-0.25), ...history({ days: 4 }) });
    mount();

    expect(screen.getByText('Holding your current targets')).toBeInTheDocument();
    expect(screen.getByText(/review incomplete nutrition days/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Run check-in'));

    const row = readSlice().checkIns[0];
    expect(row?.status).toBe('held');
    expect(row?.proposedCalories).toBeNull();
    expect(row?.resolvedAt).toBeNull();
  });
});
