// Jest injects describe/it/expect/beforeEach as globals — see the sibling
// tests, none of which import a runner.
import type { ReactElement } from 'react';
import { Alert, type AlertButton } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LS_KEY, cloudFp, emptyDB, ensureSharedCore, loadDB, saveDB, uid, ymd } from '@hybrid/engine';
import {
  emptyNutritionDB,
  quickAddEntry,
  sanitizeNutritionDB,
  type MacroProgram,
  type NutritionDB,
  type WeightEntry,
} from '@hybrid/nutrition-core';
import { addDays } from '@hybrid/nutrition-engine';
import { NUTRITION_LS_KEY, NutritionProvider } from '../src/store/nutrition';
import { DbProvider } from '../src/store/db';
import { storage } from '../src/store/storage';
import { WeightScreen } from '../src/screens/nutrition/Weight';
import { CoachScreen } from '../src/screens/nutrition/Coach';
import { weekStartOf } from '@hybrid/nutrition-adapter';

/*
 * The three screens the adaptive engine finally drives.
 *
 * What is proved here and cannot be proved anywhere else: that a weigh-in the
 * athlete types reaches the ENGINE'S trend rather than a local average; that
 * both answers to a proposal are recorded and produce different programs; that
 * HOLDING arrives on screen as information; and that none of it touches the
 * training blob.
 *
 * The two known engine defects have tests of their own, asserting that the UI
 * SAYS SO rather than that the maths was corrected — the maths is a merged
 * parity contract with the Python reference and is deliberately untouched.
 */

const FRAME = { x: 0, y: 0, width: 390, height: 844 };
const INSETS = { top: 47, left: 0, right: 0, bottom: 34 };

function mount(ui: ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={{ frame: FRAME, insets: INSETS }}>
      <DbProvider>
        <NutritionProvider>{ui}</NutritionProvider>
      </DbProvider>
    </SafeAreaProvider>,
  );
}

const readSlice = (): NutritionDB => sanitizeNutritionDB(JSON.parse(storage.getItem(NUTRITION_LS_KEY) || '{}'));

const seedEngine = () => saveDB(storage, ensureSharedCore(emptyDB(), 1_754_000_000_000), LS_KEY);

const today = () => ymd(new Date());
/** `back` whole days before today, on the same local calendar the screens use. */
const day = (back: number) => addDays(today(), -back);

/**
 * Local noon of a calendar day.
 *
 * Noon, not midnight, and LOCAL, not `${day}T00:00Z`: `weighInDay` reads the
 * timestamp back through `ymd`, so a UTC midnight stamp lands on the previous
 * day for every athlete west of Greenwich — and would do it in CI too.
 */
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

/**
 * `days` days of history ending today: one quick-add per day and a weigh-in
 * every `weighEvery` days, the weight moving `kgPerDay` each day.
 */
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
  storage.setItem(NUTRITION_LS_KEY, JSON.stringify(db));
  return db;
}

/** Run the check-in and answer it. Returns the slice as stored afterwards. */
function decide(answer: 'Accept' | 'Decline'): NutritionDB {
  fireEvent.press(screen.getByText('Open check-in'));
  fireEvent.press(screen.getByText('Run check-in'));
  fireEvent.press(screen.getByText(answer));
  return readSlice();
}

beforeEach(() => {
  storage.removeItem(NUTRITION_LS_KEY);
  storage.removeItem(LS_KEY);
});

describe('Weight', () => {
  it('logs a weigh-in and shows it in history', () => {
    seed();
    mount(<WeightScreen />);

    fireEvent.changeText(screen.getByLabelText('Weight kg'), '82.4');
    fireEvent.press(screen.getByText('Log it'));

    const entries = readSlice().weightEntries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ weightKg: 82.4, source: 'manual', deletedAt: null });
    expect(screen.getByText('82.4 kg')).toBeTruthy();
  });

  it('feeds the new weigh-in into the ENGINE trend, not into a raw average', () => {
    // 84.0 three days ago, then 82.4 today. The EWMA carries 84.0 across the
    // two silent days and moves a fifth of the way to the new point:
    // 0.2 × 82.4 + 0.8 × 84.0 = 83.68. A mean would say 83.2 and the last raw
    // point would say 82.4 — the number below is the engine's and no other.
    seed({ weightEntries: [weighIn(day(3), 84.0)] });
    mount(<WeightScreen />);

    fireEvent.changeText(screen.getByLabelText('Weight kg'), '82.4');
    fireEvent.press(screen.getByText('Log it'));

    expect(screen.getByText('83.7 kg trend')).toBeTruthy();
    expect(screen.getByText(/Down 0.3 kg vs about a week ago/)).toBeTruthy();
  });

  it('refuses a weight the sanitizer would drop rather than silently losing it', () => {
    seed();
    mount(<WeightScreen />);

    fireEvent.changeText(screen.getByLabelText('Weight kg'), '9000');
    fireEvent.press(screen.getByText('Log it'));

    expect(readSlice().weightEntries).toHaveLength(0);
    expect(screen.getByText(/Enter a weight between 20 and 500 kg/)).toBeTruthy();
  });

  it('edits a weigh-in without moving the day it was measured on', () => {
    const entry = weighIn(day(2), 88.8);
    seed({ weightEntries: [entry] });
    mount(<WeightScreen />);

    fireEvent.press(screen.getByLabelText('edit the 88.8 kg weigh-in'));
    fireEvent.changeText(screen.getByLabelText('Weight kg'), '80.8');
    fireEvent.press(screen.getByText('Save'));

    const stored = readSlice().weightEntries[0];
    expect(stored.weightKg).toBe(80.8);
    // The x-axis of every trend fit — correcting the number must not move it.
    expect(stored.measuredAt).toBe(entry.measuredAt);
  });

  it('stamps a deleted weigh-in rather than splicing it out', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    seed({ weightEntries: [weighIn(day(1), 91.2)] });
    mount(<WeightScreen />);

    fireEvent.press(screen.getByLabelText('delete the 91.2 kg weigh-in'));
    const [, , buttons] = alertSpy.mock.calls[0] as [string, string, AlertButton[]];
    expect(buttons.find((b) => b.text === 'Delete')!.style).toBe('destructive');
    act(() => buttons.find((b) => b.text === 'Delete')!.onPress!());

    const entries = readSlice().weightEntries;
    // Stamped, not spliced: mergeNutrition is additive, so a spliced weigh-in
    // returns from the other device and drags the trend back with it.
    expect(entries).toHaveLength(1);
    expect(entries[0].deletedAt).toEqual(expect.any(String));
    expect(screen.getByText('No weigh-ins yet')).toBeTruthy();
  });
});

describe('holding is information, not a failure', () => {
  const holdingSlice = () =>
    seed({ program: program(-0.25), ...history({ days: 4 }) });

  it('renders the engine’s own explanation of what is missing, calmly', () => {
    holdingSlice();
    mount(<CoachScreen />);

    expect(screen.getByText(/Holding/)).toBeTruthy();
    // Verbatim from `coverageExplanation` — not paraphrased by the screen.
    expect(screen.getByText('More history is required before updating expenditure.')).toBeTruthy();
    expect(screen.getByText('No estimate yet')).toBeTruthy();
    // Nothing on this screen calls it an error, a failure or a problem.
    expect(screen.queryByText(/error|failed|couldn’t|couldn't/i)).toBeNull();
  });

  it('still lets the athlete check in, and records the held week as a real outcome', () => {
    holdingSlice();
    mount(<CoachScreen />);

    fireEvent.press(screen.getByText('Open check-in'));
    expect(screen.getByText('Holding your current targets')).toBeTruthy();
    // The contract's own module set, rendered as actions rather than errors.
    expect(screen.getByText(/review incomplete nutrition days/)).toBeTruthy();
    expect(screen.getByText(/carry forward the last high-confidence estimate/)).toBeTruthy();
    fireEvent.press(screen.getByText('Run check-in'));

    const row = readSlice().checkIns[0];
    expect(row.status).toBe('held');
    expect(row.explanation).toBe('More history is required before updating expenditure.');
    // A held week proposes nothing — and stores nothing rather than last week's
    // numbers sitting next to a held status.
    expect(row.proposedCalories).toBeNull();
    expect(row.resolvedAt).toBeNull();
  });
});

describe('accept and decline', () => {
  const readySlice = () => seed({ program: program(-0.25), ...history() });
  const nextWeek = () => addDays(weekStartOf(today()), 7);

  it('offers a proposal once the coverage gate is cleared', () => {
    readySlice();
    mount(<CoachScreen />);

    expect(screen.getByText('Expenditure updated from logged intake and smoothed weight trend.')).toBeTruthy();
    fireEvent.press(screen.getByText('Open check-in'));
    fireEvent.press(screen.getByText('Run check-in'));

    const row = readSlice().checkIns[0];
    expect(row.status).toBe('pending');
    expect(row.proposedCalories).toEqual(expect.any(Number));
    expect(row.resolvedAt).toBeNull();
    expect(screen.getByText('Accept')).toBeTruthy();
    expect(screen.getByText('Decline')).toBeTruthy();
  });

  it('accepting records the decision AND writes the next program week', () => {
    readySlice();
    mount(<CoachScreen />);
    const slice = decide('Accept');

    const row = slice.checkIns[0];
    expect(row.status).toBe('accepted');
    expect(row.resolvedAt).toEqual(expect.any(String));

    const days = slice.program!.days;
    expect(days).toHaveLength(7);
    expect(days.map((d) => d.targetDate)).toEqual(Array.from({ length: 7 }, (_u, i) => addDays(nextWeek(), i)));
    // Provenance: every written day says which decision produced it.
    expect(new Set(days.map((d) => d.source))).toEqual(new Set(['accepted_check_in']));
    expect(days[0]).toMatchObject({
      calories: row.proposedCalories,
      proteinG: row.proposedProteinG,
      carbsG: row.proposedCarbsG,
      fatG: row.proposedFatG,
    });
  });

  it('declining records the decision AND leaves the program untouched', () => {
    const before = readySlice();
    mount(<CoachScreen />);
    const slice = decide('Decline');

    const row = slice.checkIns[0];
    expect(row.status).toBe('declined');
    expect(row.resolvedAt).toEqual(expect.any(String));
    // A decline is not "nothing happened": the proposal it turned down is kept.
    expect(row.proposedCalories).toEqual(expect.any(Number));
    // "preserve current program" — the whole of the declined branch.
    expect(slice.program).toEqual(before.program);
  });

  it('produces two different worlds from the two answers', () => {
    readySlice();
    mount(<CoachScreen />);
    const accepted = decide('Accept');

    screen.unmount();
    readySlice();
    mount(<CoachScreen />);
    const declined = decide('Decline');

    expect(accepted.checkIns[0].status).not.toBe(declined.checkIns[0].status);
    expect(accepted.program!.days).toHaveLength(7);
    expect(declined.program!.days).toHaveLength(0);
    // Both weeks are on the record; neither answer is an absence.
    expect(accepted.checkIns[0].resolvedAt).toEqual(expect.any(String));
    expect(declined.checkIns[0].resolvedAt).toEqual(expect.any(String));
  });

  it('will not re-open a week the athlete has already settled', () => {
    readySlice();
    mount(<CoachScreen />);
    decide('Decline');

    // The re-run control is gone, and the recorded decision is what shows.
    expect(screen.queryByText('Run check-in')).toBeNull();
    expect(screen.queryByText('Run check-in again')).toBeNull();
    expect(screen.getByText('You declined this week')).toBeTruthy();
  });
});

/*
 * The two defects the Phase 1 port carried forward on purpose. Neither test
 * asserts a corrected number — the engine is a merged parity contract with the
 * Python reference. Both assert that the athlete is TOLD.
 */
describe('the engine defects this UI is forbidden to hide', () => {
  it('says when the trend is reading a thin weight signal, and which way it biases the target', () => {
    // Weigh-ins every fifth day. The EWMA repeats the last weight across the
    // four days between and the least-squares fit reads those flat runs as
    // data, so the reported drift is several times flatter than the real one —
    // which understates expenditure and hands back a LOWER target.
    seed({ program: program(-0.25), ...history({ weighEvery: 5 }) });
    mount(<CoachScreen />);

    expect(screen.getByText(/3 weigh-ins in 14 days/)).toBeTruthy();
    expect(screen.getByText(/reads flatter than your real change/)).toBeTruthy();
    expect(screen.getByText(/LOWER than it should be/)).toBeTruthy();
  });

  it('does not say the same thing when the athlete weighs in daily', () => {
    seed({ program: program(-0.25), ...history() });
    mount(<CoachScreen />);

    expect(screen.queryByText(/reads flatter than your real change/)).toBeNull();
  });

  it('surfaces macros that overshoot the calorie target instead of printing both as if they agreed', () => {
    /* 130 kg at a flat weight on 2,400 kcal gives an observed expenditure of
       2,400; a −1 kg/week goal takes the target to 1,300. Protein at 1.8 g/kg
       and fat at 0.8 g/kg are 1,872 kcal on their own, so `macroTargets` floors
       carbohydrate at zero and returns macros totalling 572 kcal MORE than the
       target printed above them, with no flag of its own. */
    seed({ program: program(-1), ...history({ kcal: 2400, startKg: 130, kgPerDay: 0 }) });
    mount(<CoachScreen />);

    fireEvent.press(screen.getByText('Open check-in'));
    fireEvent.press(screen.getByText('Run check-in'));

    const row = readSlice().checkIns[0];
    expect(row.proposedCalories).toBe(1300);
    expect(row.proposedCarbsG).toBe(0);
    expect(screen.getByText(/1872 kcal — 572 more than the 1300 kcal target/)).toBeTruthy();
    // Still acceptable: the athlete is informed, not blocked. The engine's
    // answer is the engine's answer.
    expect(screen.getByText('Accept')).toBeTruthy();
  });
});

describe('nutrition writes and the EngineDB', () => {
  /*
   * The Phase 0 isolation, re-asserted through the three new screens. If this
   * fails, weighing in has started arming a training push.
   */
  it('leaves the training blob byte-identical through a weigh-in, a goal and a check-in', () => {
    seedEngine();
    const rawBefore = storage.getItem(LS_KEY);
    const fpBefore = cloudFp(loadDB(storage, LS_KEY).db);

    seed({ ...history() });
    mount(<WeightScreen />);
    fireEvent.changeText(screen.getByLabelText('Weight kg'), '89.4');
    fireEvent.press(screen.getByText('Log it'));
    screen.unmount();

    mount(<CoachScreen />);
    fireEvent.press(screen.getByLabelText('lose 0.25 kilograms per week'));
    fireEvent.press(screen.getByText('Save goal'));
    decide('Accept');
    // DbProvider coalesces its writes; flush the window so a stray training
    // write would actually have landed by the time this is read back.
    act(() => jest.advanceTimersByTime(500));

    expect(storage.getItem(LS_KEY)).toBe(rawBefore);
    expect(cloudFp(loadDB(storage, LS_KEY).db)).toBe(fpBefore);
    // ...and all of it really happened, so this is not passing by doing nothing.
    const slice = readSlice();
    expect(slice.program!.targetRateKgPerWeek).toBe(-0.25);
    expect(slice.checkIns[0].status).toBe('accepted');
    expect(slice.program!.days).toHaveLength(7);
  });
});
