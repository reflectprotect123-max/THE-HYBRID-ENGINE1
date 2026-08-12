// Jest injects describe/it/expect/beforeEach as globals — see the sibling
// tests, none of which import a runner.
import type { ReactElement } from 'react';
import { Alert, type AlertButton } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LS_KEY, cloudFp, emptyDB, ensureSharedCore, loadDB, saveDB, ymd } from '@hybrid/engine';
import { emptyNutritionDB, sanitizeNutritionDB, type NutritionDB } from '@hybrid/nutrition-core';
import { NUTRITION_LS_KEY, NutritionProvider } from './store/nutrition';
import { DbProvider } from './store/db';
import { storage } from './store/storage';
import { DailyLogScreen } from './screens/nutrition/DailyLog';
import { NutritionSettingsScreen } from './screens/nutrition/NutritionSettings';
import { WorldSwitch } from './ui/WorldSwitch';
import { __resetDisciplineForTest, currentDiscipline, trainingScope } from './discipline';

/*
 * The nutrition world, mounted the way the app mounts it.
 *
 * Three things are proved here, and the third is the one Phase 0 was built
 * for: the world switch reaches nutrition and comes back, a meal logged
 * through the provider is on disk in the nutrition slice, and the EngineDB is
 * byte-identical either side of that write. If the last one ever fails, a
 * logged meal has started pushing training snapshots (or worse).
 */

const FRAME = { x: 0, y: 0, width: 390, height: 844 };
const INSETS = { top: 47, left: 0, right: 0, bottom: 34 };

/** DailyLog reads NutritionProvider and nothing else; DbProvider is here so a
 *  test can assert the engine slice DIDN'T move underneath it. */
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

/* Stamped so `loadDB` does not mint a fresh shared core on every read — an
   unstamped fixture changes its own fingerprint each time and the isolation
   assertion below would be measuring the clock, not the write. */
const seedEngine = () => saveDB(storage, ensureSharedCore(emptyDB(), 1_754_000_000_000), LS_KEY);

beforeEach(() => {
  storage.removeItem(NUTRITION_LS_KEY);
  storage.removeItem(LS_KEY);
  __resetDisciplineForTest();
});

/** Log one quick-add entry through the screen's own form. */
function logFood(name: string, kcal: string, p = '0', c = '0', f = '0') {
  fireEvent.press(screen.getByText('Add food'));
  fireEvent.changeText(screen.getByLabelText('Food name'), name);
  fireEvent.changeText(screen.getByLabelText('kcal'), kcal);
  fireEvent.changeText(screen.getByLabelText('Protein g'), p);
  fireEvent.changeText(screen.getByLabelText('Carbs g'), c);
  fireEvent.changeText(screen.getByLabelText('Fat g'), f);
  fireEvent.press(screen.getByText('Log it'));
}

describe('the world switch, with three worlds', () => {
  it('reaches nutrition from a training world and comes back', () => {
    mount(<WorldSwitch />);
    expect(currentDiscipline()).toBe('strength');

    act(() => fireEvent.press(screen.getByLabelText('Switch to Nutrition')));
    expect(currentDiscipline()).toBe('nutrition');

    // The way back has to exist from INSIDE the nutrition world, or the seal
    // is a trap. Its own Settings carries the same chooser.
    screen.unmount();
    mount(<NutritionSettingsScreen />);
    act(() => fireEvent.press(screen.getByLabelText('Switch to Strength')));
    expect(currentDiscipline()).toBe('strength');
  });

  it('shows the world you are in as current rather than offering it as a move', () => {
    mount(<WorldSwitch />);
    expect(screen.getByLabelText('Strength, current world')).toBeTruthy();
    expect(screen.queryByLabelText('Switch to Strength')).toBeNull();
  });

  it('keeps training reads scoped to the training world a nutrition detour came from', () => {
    // Nutrition is not a training identity, so `restrictToProduct` has no
    // answer for it. A conditioning athlete stepping into Nutrition must not
    // come back to strength-scoped reads.
    mount(<WorldSwitch />);
    act(() => fireEvent.press(screen.getByLabelText('Switch to Conditioning')));
    act(() => fireEvent.press(screen.getByLabelText('Switch to Nutrition')));
    expect(trainingScope(currentDiscipline())).toBe('conditioning');
  });
});

describe('Daily Log', () => {
  it('opens on today with nothing logged', () => {
    mount(<DailyLogScreen />);
    // Already on today, so the jump has nowhere to go.
    expect(screen.getByLabelText('Jump to today').props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText('Nothing logged yet')).toBeTruthy();
    expect(screen.getByText('0 kcal')).toBeTruthy();
  });

  it('logs a meal that survives being written to the slice', () => {
    mount(<DailyLogScreen />);
    logFood('Oats', '400', '30', '40', '10');

    expect(screen.getByText('Oats')).toBeTruthy();
    const stored = readSlice().logEntries;
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      displayName: 'Oats',
      logDate: ymd(new Date()),
      meal: 'breakfast',
      // A quick add carries NO provenance id — the numbers came from the
      // athlete, so there is nothing they could ever be re-derived from.
      entryKind: 'quick_add',
      foodId: null,
      calories: 400,
      proteinG: 30,
      deletedAt: null,
    });
  });

  it('sums the day across meals and shows the running totals', () => {
    mount(<DailyLogScreen />);
    logFood('Oats', '400', '30', '40', '10');
    fireEvent.press(screen.getByText('Add food'));
    fireEvent.changeText(screen.getByLabelText('Food name'), 'Chicken and rice');
    fireEvent.changeText(screen.getByLabelText('kcal'), '655');
    fireEvent.changeText(screen.getByLabelText('Protein g'), '50');
    fireEvent.changeText(screen.getByLabelText('Carbs g'), '80');
    fireEvent.changeText(screen.getByLabelText('Fat g'), '12');
    fireEvent.press(screen.getByLabelText('lunch'));
    fireEvent.press(screen.getByText('Log it'));

    expect(screen.getByText('1055 kcal')).toBeTruthy();
    // Grouped by meal, and each meal carries its own subtotal.
    expect(screen.getByText('Breakfast')).toBeTruthy();
    expect(screen.getByText('Lunch')).toBeTruthy();
    expect(screen.getByText('400 kcal')).toBeTruthy();
    expect(screen.getByText('655 kcal')).toBeTruthy();
  });

  it('edits an entry in place, without touching the rest of the day', () => {
    mount(<DailyLogScreen />);
    logFood('Oats', '400');
    logFood('Banana', '90');

    fireEvent.press(screen.getByLabelText('edit Oats'));
    fireEvent.changeText(screen.getByLabelText('kcal'), '450');
    fireEvent.press(screen.getByText('Save'));

    const stored = readSlice().logEntries;
    expect(stored).toHaveLength(2);
    expect(stored.find((e) => e.displayName === 'Oats')!.calories).toBe(450);
    expect(stored.find((e) => e.displayName === 'Banana')!.calories).toBe(90);
  });

  it('confirms a delete, then STAMPS it rather than removing the record', () => {
    // mergeNutrition is additive: an entry spliced out of the array comes
    // straight back from the other device on the next sync. `deletedAt` is
    // the only deletion that travels.
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mount(<DailyLogScreen />);
    logFood('Oats', '400');

    fireEvent.press(screen.getByLabelText('delete Oats'));
    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [title, , buttons] = alertSpy.mock.calls[0] as [string, string, AlertButton[]];
    expect(title).toBe('Delete "Oats"?');
    const del = buttons.find((b) => b.text === 'Delete')!;
    expect(del.style).toBe('destructive');
    act(() => del.onPress!());

    expect(screen.queryByText('Oats')).toBeNull();
    expect(screen.getByText('0 kcal')).toBeTruthy();
    const stored = readSlice().logEntries;
    expect(stored).toHaveLength(1);
    expect(stored[0].deletedAt).toEqual(expect.any(String));
  });

  it('navigates back a day and forward again, and refuses to go past today', () => {
    mount(<DailyLogScreen />);
    logFood('Oats', '400');

    fireEvent.press(screen.getByLabelText('Previous day'));
    // Yesterday is a different day: today's food is not on it.
    expect(screen.queryByText('Oats')).toBeNull();
    expect(screen.getByText('Nothing logged yet')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Next day'));
    expect(screen.getByText('Oats')).toBeTruthy();

    // Forward stops here — the adaptive engine only ever looks BACK from
    // today, so a day past it could hold food nothing would ever read.
    const next = screen.getByLabelText('Next day');
    expect(next.props.accessibilityState.disabled).toBe(true);
    fireEvent.press(next);
    expect(screen.getByText('Oats')).toBeTruthy();
    expect(screen.getByLabelText('Jump to today').props.accessibilityState.disabled).toBe(true);
  });

  it('says there is no target rather than showing a zero one', () => {
    mount(<DailyLogScreen />);
    expect(screen.getByText(/No target for this day yet/)).toBeTruthy();
    expect(screen.queryByText(/of 0/)).toBeNull();
  });
});

describe('nutrition writes and the EngineDB', () => {
  /*
   * THE isolation Phase 0 exists for, asserted through the UI rather than
   * through the storage functions (which nutrition-store.test.ts already
   * covers). A meal logged on a real screen must leave the training blob
   * untouched — same bytes, same `cloudFp`, so it cannot arm a training push.
   */
  it('logging a meal on the Daily Log leaves the training blob byte-identical', () => {
    seedEngine();
    const rawBefore = storage.getItem(LS_KEY);
    const fpBefore = cloudFp(loadDB(storage, LS_KEY).db);

    mount(<DailyLogScreen />);
    logFood('Oats', '400', '30', '40', '10');
    // DbProvider coalesces its writes; flush the window so a stray training
    // write would actually have landed by the time this is read back.
    act(() => jest.advanceTimersByTime(500));

    expect(storage.getItem(LS_KEY)).toBe(rawBefore);
    expect(cloudFp(loadDB(storage, LS_KEY).db)).toBe(fpBefore);
    // ...and the meal really was written, so this is not passing by doing
    // nothing at all.
    expect(readSlice().logEntries).toHaveLength(1);
  });

  it('never writes the nutrition slice into the engine blob', () => {
    seedEngine();
    mount(<DailyLogScreen />);
    logFood('Oats', '400');
    act(() => jest.advanceTimersByTime(500));

    expect(storage.getItem(LS_KEY)).not.toContain('Oats');
    expect(storage.getItem(LS_KEY)).not.toContain('logEntries');
    expect(NUTRITION_LS_KEY).not.toBe(LS_KEY);
  });

  it('starts from an empty slice when nothing has ever been logged', () => {
    mount(<DailyLogScreen />);
    expect(screen.getByText('Nothing logged yet')).toBeTruthy();
    expect(emptyNutritionDB().logEntries).toEqual([]);
  });
});
