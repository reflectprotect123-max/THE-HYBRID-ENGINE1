// Jest injects describe/it/expect/beforeEach as globals — see the sibling
// tests, none of which import a runner.
import type { ReactElement } from 'react';
import { Alert, type AlertButton } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LS_KEY, cloudFp, emptyDB, ensureSharedCore, loadDB, saveDB, ymd } from '@hybrid/engine';
import { sanitizeNutritionDB, type CachedFood, type NutritionDB } from '@hybrid/nutrition-core';
import { NUTRITION_LS_KEY, NutritionProvider } from '../../store/nutrition';
import { DbProvider } from '../../store/db';
import { storage } from '../../store/storage';
import { FoodScreen } from './Food';
import { DailyLogScreen } from './DailyLog';

/*
 * The four food-entry screens, mounted the way the app mounts them.
 *
 * Two things are proved here that no unit test can: that the snapshot invariant
 * survives a real edit made on a real screen, and that the catalogue going away
 * leaves an athlete who can still log their dinner.
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

/** A catalogue row as the Supabase read would shape it: 100 g of rolled oats. */
const OATS: CachedFood = {
  id: 'food-oats',
  name: 'Rolled oats',
  brand: 'Catalogue brand',
  barcode: null,
  servingQty: 100,
  servingUnit: 'g',
  calories: 380,
  proteinG: 13,
  carbsG: 68,
  fatG: 7,
  source: 'ausnut',
  externalId: '1-1',
  nutritionBasisQty: 100,
  nutritionBasisUnit: 'g',
  servingSizeText: '100 g',
  nutrients: { sodiumMg: 5 },
  servings: [],
  cachedAt: '2026-08-07T00:00:00.000Z',
};

/** A catalogue that answers. */
const online = jest.fn(async (q: string) => (OATS.name.toLowerCase().includes(q.toLowerCase()) ? [OATS] : []));

/** A catalogue that cannot be reached — the real failure, not an empty answer. */
const down = jest.fn(async () => {
  throw new Error('Network request failed');
});

/** Type a query and let the debounce and the request settle. */
async function searchFor(query: string) {
  fireEvent.changeText(screen.getByLabelText('Search foods'), query);
  await act(async () => {
    jest.advanceTimersByTime(400);
  });
}

const foodScreen = (search: (q: string) => Promise<CachedFood[]>) => <FoodScreen search={search} />;

beforeEach(() => {
  storage.removeItem(NUTRITION_LS_KEY);
  storage.removeItem(LS_KEY);
  online.mockClear();
  down.mockClear();
});

describe('Food search, with the catalogue reachable', () => {
  it('finds a catalogue food and says where it came from', async () => {
    mount(foodScreen(online));
    await searchFor('oats');

    expect(screen.getByText('Rolled oats')).toBeTruthy();
    expect(screen.getByText(/Catalogue · Catalogue brand/)).toBeTruthy();
  });

  it('logs it at the quantity asked for, snapshotting the scaled macros', async () => {
    mount(foodScreen(online));
    await searchFor('oats');

    fireEvent.press(screen.getByLabelText('log Rolled oats'));
    fireEvent.changeText(screen.getByLabelText('Quantity'), '50');
    fireEvent.press(screen.getByLabelText('breakfast'));
    fireEvent.press(screen.getByText('Add to log'));

    const entries = readSlice().logEntries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      entryKind: 'food',
      foodId: 'food-oats',
      customFoodId: null,
      recipeId: null,
      displayName: 'Rolled oats',
      logDate: ymd(new Date()),
      meal: 'breakfast',
      quantity: 50,
      unit: 'g',
      // Half of the 100 g row, worked out once, here.
      calories: 190,
      proteinG: 6.5,
    });
    // `nutrients` rides at the SOURCE's basis, unscaled — halving it here would
    // be double-scaled by every consumer that scales by the entry's own basis.
    expect(entries[0].nutrients).toEqual({ sodiumMg: 5 });
  });

  it('caches the food it just logged, so the same food logs again offline', async () => {
    mount(foodScreen(online));
    await searchFor('oats');
    fireEvent.press(screen.getByLabelText('log Rolled oats'));
    fireEvent.press(screen.getByText('Add to log'));

    expect(readSlice().foodCache.map((f) => f.id)).toEqual(['food-oats']);

    // Remounted with a dead catalogue: the food is still findable and loggable.
    screen.unmount();
    mount(foodScreen(down));
    await searchFor('oats');
    expect(screen.getByText('Rolled oats')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('log Rolled oats'));
    fireEvent.press(screen.getByText('Add to log'));
    expect(readSlice().logEntries).toHaveLength(2);
  });

  it('does not cache a food the athlete only looked at', async () => {
    mount(foodScreen(online));
    await searchFor('oats');
    expect(readSlice().foodCache).toEqual([]);
  });

  it('stars a food, and un-starring stamps the row rather than removing it', async () => {
    mount(foodScreen(online));
    await searchFor('oats');

    fireEvent.press(screen.getByLabelText('star Rolled oats'));
    expect(readSlice().favorites).toHaveLength(1);
    // Starred means loggable later, so the food came onto the device with it.
    expect(readSlice().foodCache).toHaveLength(1);

    fireEvent.press(screen.getByLabelText('unstar Rolled oats'));
    const favorites = readSlice().favorites;
    expect(favorites).toHaveLength(1);
    expect(favorites[0].deletedAt).toEqual(expect.any(String));
  });
});

describe('Food search, with the catalogue unreachable', () => {
  it('says so, instead of reporting that the food does not exist', async () => {
    mount(foodScreen(down));
    await searchFor('oats');

    expect(screen.getByText(/shared food catalogue is unreachable/)).toBeTruthy();
    expect(screen.getByText(/could not be asked/)).toBeTruthy();
  });

  it('still finds the athlete’s own foods and recipes', async () => {
    mount(foodScreen(down));
    // A custom food created with no connection at all.
    fireEvent.press(screen.getByText('New food'));
    fireEvent.changeText(screen.getByLabelText('Food name'), 'My protein shake');
    fireEvent.changeText(screen.getByLabelText('Serving size'), '250');
    fireEvent.press(screen.getByLabelText('unit ml'));
    fireEvent.changeText(screen.getByLabelText('kcal'), '180');
    fireEvent.changeText(screen.getByLabelText('Protein g'), '30');
    fireEvent.press(screen.getByText('Save food'));

    await searchFor('shake');
    expect(screen.getByText('My protein shake')).toBeTruthy();
    expect(screen.getByText(/Your food/)).toBeTruthy();
  });

  it('leaves quick add working, which is the whole point of it', async () => {
    mount(foodScreen(down));
    await searchFor('oats');

    fireEvent.press(screen.getByText('Quick add'));
    fireEvent.changeText(screen.getByLabelText('Name'), 'Pub lunch');
    fireEvent.changeText(screen.getByLabelText('kcal'), '900');
    fireEvent.press(screen.getByText('Add to log'));

    const entries = readSlice().logEntries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ entryKind: 'quick_add', displayName: 'Pub lunch', calories: 900, foodId: null });
  });
});

describe('THE SNAPSHOT INVARIANT, through the screens', () => {
  const createShake = () => {
    fireEvent.press(screen.getByText('New food'));
    fireEvent.changeText(screen.getByLabelText('Food name'), 'Protein shake');
    fireEvent.changeText(screen.getByLabelText('Serving size'), '250');
    fireEvent.press(screen.getByLabelText('unit ml'));
    fireEvent.changeText(screen.getByLabelText('kcal'), '180');
    fireEvent.changeText(screen.getByLabelText('Protein g'), '30');
    fireEvent.press(screen.getByText('Save food'));
  };

  it('does not rewrite a logged entry when the source food is edited afterwards', async () => {
    mount(foodScreen(down));
    createShake();

    await searchFor('shake');
    fireEvent.press(screen.getByLabelText('log Protein shake'));
    fireEvent.press(screen.getByText('Add to log'));

    const before = readSlice().logEntries[0];
    expect(before).toMatchObject({ entryKind: 'custom_food', calories: 180, proteinG: 30, displayName: 'Protein shake' });

    // The athlete corrects the food: new name, wildly different macros.
    fireEvent.press(screen.getByLabelText('edit Protein shake'));
    fireEvent.changeText(screen.getByLabelText('Food name'), 'Protein shake (corrected)');
    fireEvent.changeText(screen.getByLabelText('kcal'), '999');
    fireEvent.changeText(screen.getByLabelText('Protein g'), '1');
    fireEvent.press(screen.getByText('Save changes'));

    const custom = readSlice().customFoods[0];
    expect(custom).toMatchObject({ name: 'Protein shake (corrected)', calories: 999 });

    const after = readSlice().logEntries[0];
    expect(after).toEqual(before);
    expect(after.calories).toBe(180);
    expect(after.displayName).toBe('Protein shake');
  });

  it('keeps the entry when the source food is deleted entirely', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mount(foodScreen(down));
    createShake();
    await searchFor('shake');
    fireEvent.press(screen.getByLabelText('log Protein shake'));
    fireEvent.press(screen.getByText('Add to log'));

    fireEvent.press(screen.getByLabelText('edit Protein shake'));
    fireEvent.press(screen.getByLabelText('delete Protein shake'));
    const [, , buttons] = alertSpy.mock.calls[0] as [string, string, AlertButton[]];
    act(() => buttons.find((b) => b.text === 'Delete')!.onPress!());

    const slice = readSlice();
    // Stamped, not spliced: mergeNutrition is additive.
    expect(slice.customFoods[0].deletedAt).toEqual(expect.any(String));
    expect(slice.logEntries[0]).toMatchObject({ calories: 180, displayName: 'Protein shake' });
  });
});

describe('Recipe builder', () => {
  /** A recipe of 100 g oats + 250 ml shake, making 2 servings. */
  const buildRecipe = async () => {
    fireEvent.press(screen.getByText('New food'));
    fireEvent.changeText(screen.getByLabelText('Food name'), 'Protein shake');
    fireEvent.changeText(screen.getByLabelText('Serving size'), '250');
    fireEvent.press(screen.getByLabelText('unit ml'));
    fireEvent.changeText(screen.getByLabelText('kcal'), '180');
    fireEvent.changeText(screen.getByLabelText('Protein g'), '30');
    fireEvent.press(screen.getByText('Save food'));

    fireEvent.press(screen.getByText('New recipe'));
    fireEvent.changeText(screen.getByLabelText('Recipe name'), 'Overnight oats');
    fireEvent.changeText(screen.getByLabelText('Servings it makes'), '2');

    fireEvent.changeText(screen.getByLabelText('Search an ingredient'), 'oats');
    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    fireEvent.press(screen.getByLabelText('add Rolled oats'));

    fireEvent.changeText(screen.getByLabelText('Search an ingredient'), 'shake');
    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    fireEvent.press(screen.getByLabelText('add Protein shake'));
  };

  it('resolves the per-serving macros live, from the ported resolver', async () => {
    mount(foodScreen(online));
    await buildRecipe();

    // (380 + 180) / 2 = 280 kcal, (13 + 30) / 2 = 21.5 -> 22 P, 68/2 = 34 C,
    // 7/2 = 3.5 -> 4 F per serving.
    expect(screen.getByText('280 kcal · 22P 34C 4F')).toBeTruthy();
  });

  it('saves the recipe and logs a serving at those macros', async () => {
    mount(foodScreen(online));
    await buildRecipe();
    fireEvent.press(screen.getByText('Save recipe'));

    const recipe = readSlice().recipes[0];
    expect(recipe).toMatchObject({ name: 'Overnight oats', servings: 2 });
    expect(recipe.items).toHaveLength(2);
    // The catalogue ingredient came onto the device with the recipe, or the
    // recipe would resolve to nothing the next time the network is gone.
    expect(readSlice().foodCache.map((f) => f.id)).toEqual(['food-oats']);

    await searchFor('overnight');
    fireEvent.press(screen.getByLabelText('log Overnight oats'));
    fireEvent.changeText(screen.getByLabelText('Quantity'), '2');
    fireEvent.press(screen.getByText('Add to log'));

    const entry = readSlice().logEntries[0];
    expect(entry).toMatchObject({
      entryKind: 'recipe',
      recipeId: recipe.id,
      unit: 'serving',
      quantity: 2,
      // Two servings of a two-serving recipe is the whole thing.
      calories: 560,
      proteinG: 43,
    });
    // A recipe has no single nutrition basis, so it carries no nutrient map.
    expect(entry.nutrients).toEqual({});
  });

  it('leaves a logged serving alone when the recipe is edited afterwards', async () => {
    mount(foodScreen(online));
    await buildRecipe();
    fireEvent.press(screen.getByText('Save recipe'));

    await searchFor('overnight');
    fireEvent.press(screen.getByLabelText('log Overnight oats'));
    fireEvent.press(screen.getByText('Add to log'));
    const before = readSlice().logEntries[0];
    expect(before.calories).toBe(280);

    fireEvent.press(screen.getByLabelText('edit Overnight oats'));
    fireEvent.press(screen.getByLabelText('remove Protein shake'));
    fireEvent.press(screen.getByText('Save changes'));

    expect(readSlice().recipes[0].items).toHaveLength(1);
    expect(readSlice().logEntries[0]).toEqual(before);
  });
});

describe('the day the food lands on', () => {
  it('shows what was logged from the Food tab on the Daily Log', async () => {
    mount(foodScreen(online));
    await searchFor('oats');
    fireEvent.press(screen.getByLabelText('log Rolled oats'));
    fireEvent.press(screen.getByText('Add to log'));
    screen.unmount();

    mount(<DailyLogScreen />);
    expect(screen.getByText('Rolled oats')).toBeTruthy();
    // Twice over: the day's total, and the breakfast subtotal beside it.
    expect(screen.getAllByText('380 kcal')).toHaveLength(2);
  });
});

describe('nutrition writes and the EngineDB', () => {
  /*
   * The Phase 0 isolation, re-asserted through the four new screens. If this
   * fails, logging food has started arming a training push.
   */
  it('leaves the training blob byte-identical through a search, a log and a recipe', async () => {
    seedEngine();
    const rawBefore = storage.getItem(LS_KEY);
    const fpBefore = cloudFp(loadDB(storage, LS_KEY).db);

    mount(foodScreen(online));
    await searchFor('oats');
    fireEvent.press(screen.getByLabelText('log Rolled oats'));
    fireEvent.press(screen.getByText('Add to log'));
    fireEvent.press(screen.getByText('New recipe'));
    fireEvent.changeText(screen.getByLabelText('Recipe name'), 'Just oats');
    fireEvent.changeText(screen.getByLabelText('Search an ingredient'), 'oats');
    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    fireEvent.press(screen.getByLabelText('add Rolled oats'));
    fireEvent.press(screen.getByText('Save recipe'));
    // DbProvider coalesces its writes; flush the window so a stray training
    // write would actually have landed by the time this is read back.
    act(() => jest.advanceTimersByTime(500));

    expect(storage.getItem(LS_KEY)).toBe(rawBefore);
    expect(cloudFp(loadDB(storage, LS_KEY).db)).toBe(fpBefore);
    // ...and all of it really happened, so this is not passing by doing nothing.
    expect(readSlice().logEntries).toHaveLength(1);
    expect(readSlice().recipes).toHaveLength(1);
    expect(storage.getItem(LS_KEY)).not.toContain('Rolled oats');
  });
});
