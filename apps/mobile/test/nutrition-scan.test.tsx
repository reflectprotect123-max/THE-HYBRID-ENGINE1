// Jest injects describe/it/expect/beforeEach as globals — see the sibling
// tests, none of which import a runner.
import type { ReactElement } from 'react';
import { Linking } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LS_KEY, cloudFp, emptyDB, ensureSharedCore, loadDB, saveDB } from '@hybrid/engine';
import { sanitizeNutritionDB, type CachedFood, type NutritionDB } from '@hybrid/nutrition-core';
import { NUTRITION_LS_KEY, NutritionProvider } from '../src/store/nutrition';
import { DbProvider } from '../src/store/db';
import { storage } from '../src/store/storage';
import { FoodScreen } from '../src/screens/nutrition/Food';

/*
 * The two camera-adjacent screens.
 *
 * What is proved here is everything around the camera, because the camera
 * itself is a native surface that does not exist in node. That is not a gap —
 * every decision this slice makes is on this side of it: one lookup per code,
 * a miss routed to a pre-filled Create-a-food instead of a dead end, an
 * unreachable catalogue told apart from an absent product, and a denied
 * permission that still leads somewhere. The parse itself is proved in
 * `@hybrid/nutrition-core`'s own suite, against 34 label fixtures.
 *
 * What a human still has to do on a real device is listed in the Phase 3d
 * handoff; nothing in this file can stand in for pointing a phone at a packet.
 */

const camera = jest.requireMock('expo-camera') as {
  __setPermission: (p: { granted: boolean; canAskAgain: boolean; status: string } | null) => void;
  __resetPermission: () => void;
};

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

/** A catalogue row carrying a barcode, as the Supabase read would shape it. */
const BARS: CachedFood = {
  id: 'food-bar',
  name: 'Protein bar',
  brand: 'Catalogue brand',
  barcode: '9310072011691',
  servingQty: 60,
  servingUnit: 'g',
  calories: 240,
  proteinG: 20,
  carbsG: 22,
  fatG: 8,
  source: 'off',
  externalId: '9310072011691',
  nutritionBasisQty: 100,
  nutritionBasisUnit: 'g',
  servingSizeText: '60 g bar',
  nutrients: {},
  servings: [],
  cachedAt: '2026-08-07T00:00:00.000Z',
};

/** Fire the camera's barcode callback the way a frame would. */
const scan = (data: string) =>
  act(() => {
    screen.getByLabelText('Barcode camera').props.onBarcodeScanned({ data, type: 'ean13' });
  });

const openScanner = () => fireEvent.press(screen.getByText('Scan barcode'));

const settle = async () => {
  await act(async () => {
    jest.advanceTimersByTime(400);
  });
};

beforeEach(() => {
  storage.removeItem(NUTRITION_LS_KEY);
  storage.removeItem(LS_KEY);
  camera.__resetPermission();
  seedEngine();
});

describe('barcode scanner', () => {
  it('looks a scanned barcode up and lands in the log sheet, not a second one', async () => {
    const lookup = jest.fn(async () => BARS);
    mount(<FoodScreen lookupBarcode={lookup} />);
    openScanner();
    scan('9310072011691');
    await settle();

    // The raw value, untouched: no padded zero, no widened UPC.
    expect(lookup).toHaveBeenCalledWith('9310072011691');
    // The existing AddLogEntry sheet, with the food's own serving pre-filled.
    expect(screen.getByText('Add to log')).toBeTruthy();
    expect(screen.getByLabelText('Quantity').props.value).toBe('60');

    fireEvent.press(screen.getByText('Add to log'));
    const entries = readSlice().logEntries;
    expect(entries).toHaveLength(1);
    expect(entries[0].foodId).toBe('food-bar');
    expect(entries[0].calories).toBeCloseTo(240, 3);
  });

  it('caches the scanned food so the same product logs again with no connection', async () => {
    mount(<FoodScreen lookupBarcode={jest.fn(async () => BARS)} />);
    openScanner();
    scan('9310072011691');
    await settle();
    fireEvent.press(screen.getByText('Add to log'));

    expect(readSlice().foodCache.map((f) => f.id)).toContain('food-bar');
  });

  it('reads one barcode per scan even though the camera fires every frame', async () => {
    // `onBarcodeScanned` is a per-frame callback: a code held in view for a
    // second is dozens of calls. Without the guard this is dozens of lookups
    // and, worse, dozens of chances to open a draft over an edited one.
    const lookup = jest.fn(async () => BARS);
    mount(<FoodScreen lookupBarcode={lookup} />);
    openScanner();
    /* Called three times against ONE render, which is the real shape of the
       hazard: the frames arrive before React has moved the screen off
       'scanning'. Going through `scan()` three times would instead prove that
       the camera unmounts, which is a different (also true) thing. */
    const frame = screen.getByLabelText('Barcode camera').props.onBarcodeScanned;
    act(() => {
      frame({ data: '9310072011691', type: 'ean13' });
      frame({ data: '9310072011691', type: 'ean13' });
      frame({ data: '9310072011691', type: 'ean13' });
    });
    await settle();

    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('offers a pre-filled Create-a-food when the barcode is not in the catalogue', async () => {
    // The common case, not an error: 5,000 seeded rows against a supermarket.
    const lookup = jest.fn(async () => null);
    mount(<FoodScreen lookupBarcode={lookup} />);
    openScanner();
    scan('0000000000000');
    await settle();

    expect(screen.getByText('Not in the catalogue')).toBeTruthy();
    fireEvent.press(screen.getByText('Create this food'));

    expect(screen.getByText('New food')).toBeTruthy();
    expect(screen.getByText('Barcode 0000000000000')).toBeTruthy();
    // Nothing else is pre-filled: the catalogue had nothing to fill it with.
    expect(screen.getByLabelText('kcal').props.value).toBe('');
    expect(screen.getByLabelText('Protein g').props.value).toBe('');
  });

  it('keeps the barcode on the food it creates, so the next scan finds it', async () => {
    mount(<FoodScreen lookupBarcode={jest.fn(async () => null)} />);
    openScanner();
    scan('0000000000000');
    await settle();
    fireEvent.press(screen.getByText('Create this food'));

    fireEvent.changeText(screen.getByLabelText('Food name'), 'Shop bar');
    fireEvent.changeText(screen.getByLabelText('Serving size'), '60');
    fireEvent.changeText(screen.getByLabelText('kcal'), '240');
    fireEvent.press(screen.getByText('Save food'));

    const created = readSlice().customFoods;
    expect(created).toHaveLength(1);
    expect(created[0].barcode).toBe('0000000000000');
  });

  it('tells an unreachable catalogue apart from a product that does not exist', async () => {
    // These are different answers and only one of them means "not a food".
    const lookup = jest.fn(async () => {
      throw new Error('Network request failed');
    });
    mount(<FoodScreen lookupBarcode={lookup} />);
    openScanner();
    scan('9310072011691');
    await settle();

    expect(screen.getByText('Could not check that barcode')).toBeTruthy();
    expect(screen.queryByText('Not in the catalogue')).toBeNull();
    // Creating the food is local, so it is still offered here.
    expect(screen.getByText('Create this food')).toBeTruthy();
  });

  it('scans again after a miss', async () => {
    const lookup = jest
      .fn<Promise<CachedFood | null>, [string]>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(BARS);
    mount(<FoodScreen lookupBarcode={lookup} />);
    openScanner();
    scan('0000000000000');
    await settle();
    fireEvent.press(screen.getByText('Scan again'));
    scan('9310072011691');
    await settle();

    expect(lookup).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Add to log')).toBeTruthy();
  });

  it('unmounts the camera while a result is on screen', async () => {
    mount(<FoodScreen lookupBarcode={jest.fn(async () => null)} />);
    openScanner();
    expect(screen.queryByLabelText('Barcode camera')).toBeTruthy();
    scan('0000000000000');
    await settle();
    // A live preview behind a result card is a hot camera nobody is using.
    expect(screen.queryByLabelText('Barcode camera')).toBeNull();
  });
});

describe('barcode scanner camera permission', () => {
  it('asks, rather than showing a dead screen, when permission has not been granted', () => {
    camera.__setPermission({ granted: false, canAskAgain: true, status: 'undetermined' });
    mount(<FoodScreen />);
    openScanner();

    expect(screen.getByText('Camera access is off')).toBeTruthy();
    expect(screen.getByText('Allow camera')).toBeTruthy();
    expect(screen.queryByText('Open settings')).toBeNull();
    // The way out is always offered.
    expect(screen.getByText('Search instead')).toBeTruthy();
  });

  it('routes to system settings once Android will not ask again', () => {
    // `requestPermission` is a silent no-op at this point, so offering it
    // would be a button that visibly does nothing.
    camera.__setPermission({ granted: false, canAskAgain: false, status: 'denied' });
    const open = jest.spyOn(Linking, 'openSettings').mockImplementation(async () => {});
    mount(<FoodScreen />);
    openScanner();

    expect(screen.queryByText('Allow camera')).toBeNull();
    fireEvent.press(screen.getByText('Open settings'));
    expect(open).toHaveBeenCalled();
  });

  it('shows neither state while the permission is still being read back', () => {
    camera.__setPermission(null);
    mount(<FoodScreen />);
    openScanner();

    expect(screen.getByText('Checking camera access…')).toBeTruthy();
    expect(screen.queryByText('Camera access is off')).toBeNull();
  });

  it('gets back to search from the permission screen', () => {
    camera.__setPermission({ granted: false, canAskAgain: true, status: 'undetermined' });
    mount(<FoodScreen />);
    openScanner();
    fireEvent.press(screen.getByText('Search instead'));

    expect(screen.getByText('Quick add')).toBeTruthy();
  });
});

describe('label reader', () => {
  const open = () => fireEvent.press(screen.getByText('Read a label'));
  const type = (text: string) => fireEvent.changeText(screen.getByLabelText('Nutrition panel text'), text);

  /* The camera half of this screen is proved in `nutrition-label-ocr.test.tsx`.
     What matters here is that adding it did not demote typing to a curiosity:
     both doors are on the first screen, and the typed one still reaches the
     same reader. */
  it('offers the camera and the text box on the same screen', () => {
    mount(<FoodScreen />);
    open();
    expect(screen.getByText('Scan the panel')).toBeTruthy();
    expect(screen.getByLabelText('Nutrition panel text')).toBeTruthy();
  });

  it('reads a typed Australian panel and carries it into Create-a-food', () => {
    mount(<FoodScreen />);
    open();
    type('Serving size: 30g\nEnergy 520kJ\nProtein 3.2g\nFat, total 2.1g\nCarbohydrate 15.6g');
    fireEvent.press(screen.getByText('Use these numbers'));

    expect(screen.getByText('New food')).toBeTruthy();
    // 520 kJ / 4.184 = 124.28, shown to one decimal.
    expect(screen.getByLabelText('kcal').props.value).toBe('124.3');
    expect(screen.getByLabelText('Protein g').props.value).toBe('3.2');
    expect(screen.getByLabelText('Carbs g').props.value).toBe('15.6');
    expect(screen.getByLabelText('Fat g').props.value).toBe('2.1');
    expect(screen.getByLabelText('Serving size').props.value).toBe('30');
  });

  it('leaves a macro the panel did not state blank rather than zero', () => {
    // A blank gets typed in. A zero gets eaten.
    mount(<FoodScreen />);
    open();
    type('Serving size: 30g\nEnergy 520kJ\nProtein 3.2g\nCarbohydrate 15.6g');
    fireEvent.press(screen.getByText('Use these numbers'));

    expect(screen.getByLabelText('Fat g').props.value).toBe('');
  });

  it('sets the serving to 100 g on a per-100g-only panel and says why', () => {
    // Read as one serving, these numbers would be wrong by however large the
    // serving is, and nothing on screen would show it.
    mount(<FoodScreen />);
    open();
    type('Per 100g\nEnergy 1733kJ\nProtein 10.7g\nFat, total 7g\nCarbohydrate 52.1g');
    expect(screen.getByText(/per 100 g/i)).toBeTruthy();
    fireEvent.press(screen.getByText('Use these numbers'));

    expect(screen.getByLabelText('Serving size').props.value).toBe('100');
    expect(screen.getByText(/only prints a per-100 column/i)).toBeTruthy();
  });

  it('says when a row read "less than 1 g" and was taken as zero', () => {
    mount(<FoodScreen />);
    open();
    type('Protein 3.2g\nFat, total Less than 1g');
    expect(screen.getByText(/less than 1 g/i)).toBeTruthy();
  });

  it('will not hand nothing forward', () => {
    mount(<FoodScreen />);
    open();
    type('Ingredients: wheat flour, sugar.');
    fireEvent.press(screen.getByText('Use these numbers'));

    // Still on the reader; the button is disabled with nothing recognised.
    expect(screen.getByLabelText('Nutrition panel text')).toBeTruthy();
    expect(screen.queryByText('New food')).toBeNull();
  });

  it('saves what was read as an ordinary custom food', () => {
    mount(<FoodScreen />);
    open();
    type('Serving size: 30g\nEnergy 520kJ\nProtein 3.2g\nFat, total 2.1g\nCarbohydrate 15.6g');
    fireEvent.press(screen.getByText('Use these numbers'));
    fireEvent.changeText(screen.getByLabelText('Food name'), 'Muesli');
    fireEvent.press(screen.getByText('Save food'));

    const saved = readSlice().customFoods;
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe('Muesli');
    expect(saved[0].servingQty).toBe(30);
    expect(saved[0].proteinG).toBeCloseTo(3.2, 3);
    // Nothing was scanned, so nothing invented a barcode.
    expect(saved[0].barcode).toBeNull();
  });
});

describe('the scan and read paths and the EngineDB', () => {
  it('leaves the training blob byte-identical through a scan, a log and a label read', async () => {
    // The Phase 0 isolation, re-asserted through the two new panes.
    const rawBefore = storage.getItem(LS_KEY);
    const fpBefore = cloudFp(loadDB(storage, LS_KEY).db);

    mount(<FoodScreen lookupBarcode={jest.fn(async () => BARS)} />);
    openScanner();
    scan('9310072011691');
    await settle();
    fireEvent.press(screen.getByText('Add to log'));
    fireEvent.press(screen.getByText('Read a label'));
    fireEvent.changeText(screen.getByLabelText('Nutrition panel text'), 'Serving size: 30g\nEnergy 520kJ\nProtein 3.2g');
    fireEvent.press(screen.getByText('Use these numbers'));
    fireEvent.changeText(screen.getByLabelText('Food name'), 'Muesli');
    fireEvent.press(screen.getByText('Save food'));
    // DbProvider coalesces its writes; flush the window so a stray training
    // write would actually have landed by the time this is read back.
    act(() => jest.advanceTimersByTime(500));

    expect(storage.getItem(LS_KEY)).toBe(rawBefore);
    expect(cloudFp(loadDB(storage, LS_KEY).db)).toBe(fpBefore);
    // ...and all of it really happened, so this is not passing by doing nothing.
    expect(readSlice().logEntries).toHaveLength(1);
    expect(readSlice().customFoods).toHaveLength(1);
    expect(storage.getItem(LS_KEY)).not.toContain('Protein bar');
  });
});
