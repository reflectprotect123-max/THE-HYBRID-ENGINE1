import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { uid, ymd } from '@hybrid/engine';
import {
  IncompatibleUnitError,
  catalogueResult,
  favoriteKey,
  favoriteKeys,
  favoriteResults,
  emptyNutritionDB,
  foodSearch,
  loggableUnits,
  logEntryFromCustomFood,
  logEntryFromFood,
  logEntryFromRecipe,
  recentResults,
  resolveRecipePerServing,
  upsertCachedFood,
  type CachedFood,
  type FoodSearchResult,
  type FoodSourceKind,
  type NutritionDB,
  type RecipeLookup,
} from '@hybrid/nutrition-core';
import { useNutrition } from '../../store/nutrition';
import { searchCatalogue, type CatalogueSearch } from '../../cloud/catalogue';
import { Btn, Card, Empty, Input, Kicker, Screen, SectionHead, T, Tap, Title } from '../../ui';
import { MealChips, UnitChips, positiveQty } from './fields';

/*
 * Food search: one list over four sources, ported from MacroTrack's
 * `FoodSearchScreen.kt` + `FoodSearchViewModel.kt` and its `AddLogEntryScreen`.
 *
 * THE OFFLINE DECISION, and it is the decision this screen exists to make.
 *
 * The shared catalogue (`public.foods`) is SERVER-SIDE: 5,000 rows in Postgres,
 * read over the network, deliberately not in the synced blob. Three of the four
 * sources are local — custom foods, recipes, and favourites — and recents are
 * derived from the log. So:
 *
 *  1. The local three are searched ALWAYS, first, with no network involved.
 *     They are the sources the athlete built themselves and the ones they log
 *     from most.
 *  2. A catalogue food the athlete has ALREADY used is on the device
 *     (`NutritionDB.foodCache`, written when a food is logged, starred or put
 *     in a recipe) and stays findable and loggable with no connection. Nothing
 *     is cached speculatively — see `CachedFood`.
 *  3. When the catalogue cannot be reached, the screen SAYS SO, once, plainly,
 *     and keeps working on what is on the device. It never dresses a network
 *     failure as "no results", which would tell the athlete their food does not
 *     exist.
 *  4. Quick add is on this screen, above the results, and needs nothing at all.
 *     Whatever else is broken, the athlete can always log what they ate.
 *
 * The one thing this screen will NOT do offline is invent a food. A catalogue
 * row it has never seen is not guessable, and a guessed macro is the one thing
 * MacroTrack's own rules forbid outright.
 */

interface Props {
  /** A confirmation from the pane the athlete just came back from. */
  notice?: string;
  onQuickAdd: () => void;
  onCreateCustomFood: () => void;
  onEditCustomFood: (id: string) => void;
  onCreateRecipe: () => void;
  onEditRecipe: (id: string) => void;
  onScanBarcode?: () => void;
  onReadLabel?: () => void;
  /**
   * A catalogue food the scanner just resolved from a barcode.
   *
   * It arrives here rather than being logged in the scanner so that a scan
   * ends in the SAME log sheet a tapped result opens — one place where
   * quantity, unit, meal and the snapshot rules are decided.
   */
  scanned?: CachedFood | null;
  onScannedConsumed?: () => void;
  /** Injected so a test — and an offline device — needs no network. */
  search?: CatalogueSearch;
}

/** What the log sheet is holding while the athlete adjusts it. */
interface LogDraft {
  result: FoodSearchResult;
  quantity: string;
  unit: string;
  units: string[];
  /**
   * One serving expressed in EACH offered unit.
   *
   * The quantity and the unit are two halves of one measurement, and swapping
   * the unit alone silently changed the measurement: a 100 g food opened at
   * "100 g", and tapping a "slice" chip left it reading "100 slice" — a 3.5 kg,
   * ~9,000 kcal entry logged with no warning. Changing the unit now reseeds the
   * quantity from this table, so the sheet always shows a real amount.
   */
  defaults: Record<string, number>;
  meal: string;
}

/**
 * How long a keystroke waits before it becomes a catalogue query.
 *
 * Every character typed is otherwise a round trip against a 5,000-row table
 * over a phone connection: nine queries to type "chickpeas", eight of whose
 * answers are thrown away, and the last one not necessarily last to arrive.
 */
const QUERY_DEBOUNCE_MS = 250;

export function FoodSearchScreen({
  notice = '',
  onQuickAdd,
  onCreateCustomFood,
  onEditCustomFood,
  onCreateRecipe,
  onEditRecipe,
  onScanBarcode,
  onReadLabel,
  scanned = null,
  onScannedConsumed,
  search = searchCatalogue,
}: Props) {
  const { nutrition, update } = useNutrition();
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState<CachedFood[]>([]);
  const [searching, setSearching] = useState(false);
  /* Null means "the catalogue has not refused us". It is NOT the same as an
     empty result list, and the two are shown differently. */
  const [offline, setOffline] = useState<string | null>(null);
  const [draft, setDraft] = useState<LogDraft | null>(null);
  const [logError, setLogError] = useState('');
  const [logged, setLogged] = useState(notice);

  const trimmed = query.trim();

  /* Every response carries the query it answered. Without this, a slow reply
     for "chi" arriving after a fast reply for "chickpeas" would repaint the
     list with the wrong food under the right query. */
  const inFlight = useRef(0);

  useEffect(() => {
    if (!trimmed) {
      setRemote([]);
      setSearching(false);
      return;
    }
    const token = ++inFlight.current;
    setSearching(true);
    const timer = setTimeout(() => {
      search(trimmed)
        .then((rows) => {
          if (inFlight.current !== token) return;
          setRemote(rows);
          setOffline(null);
          setSearching(false);
        })
        .catch(() => {
          if (inFlight.current !== token) return;
          setRemote([]);
          /* The athlete's message, never the error's: a PostgREST string tells
             them nothing they can act on, and what they can act on is that
             everything they have used before is still here. */
          setOffline('The shared food catalogue is unreachable. Showing what is on this device.');
          setSearching(false);
        });
    }, QUERY_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed, search]);

  /* A scanned food is not a search result and must outlive the search that is
     about to clear `remote` — typing a query, or simply arriving with none,
     resets it. Pinned separately, so the log sheet can still resolve the food
     it is holding. */
  const [pinned, setPinned] = useState<CachedFood[]>([]);
  /* Kept in a ref because the parent passes a fresh closure every render;
     as an effect dependency it would re-run the scan handler forever. */
  const consumed = useRef(onScannedConsumed);
  consumed.current = onScannedConsumed;

  useEffect(() => {
    if (!scanned) return;
    setPinned((prev) => [scanned, ...prev.filter((f) => f.id !== scanned.id)]);
    setLogError('');
    setLogged('');
    /* The draft is built from the scanned food directly rather than through
       `openDraft`: `setPinned` has not landed in this render, so the pool the
       helpers read does not contain it yet. */
    const result = catalogueResult(scanned, false);
    const defaults = unitDefaults(emptyNutritionDB(), [scanned], result);
    const units = Object.keys(defaults);
    const unit = units[0] ?? 'serving';
    setDraft({
      result,
      quantity: String(defaults[unit] ?? 1),
      unit,
      units,
      defaults,
      meal: 'other',
    });
    consumed.current?.();
  }, [scanned]);

  /* Everything the log sheet may have to resolve a food from: what the last
     search returned, plus what was scanned. */
  const pool = useMemo(() => [...remote, ...pinned.filter((p) => !remote.some((r) => r.id === p.id))], [remote, pinned]);

  const results = useMemo(() => foodSearch(nutrition, trimmed, remote), [nutrition, trimmed, remote]);
  /* With no query the screen is the athlete's own shelf: what they starred,
     then what they last ate. The reference does exactly this, and it is the
     fastest path to logging the same breakfast for the fourth day running. */
  const shelf = useMemo(() => {
    const favs = favoriteResults(nutrition);
    const seen = new Set(favs.map((f) => favoriteKey(f.kind, f.id)));
    return [...favs, ...recentResults(nutrition).filter((r) => !seen.has(favoriteKey(r.kind, r.id)))];
  }, [nutrition]);
  const starred = useMemo(() => favoriteKeys(nutrition), [nutrition]);

  const shown = trimmed ? results : shelf;

  const openDraft = (result: FoodSearchResult) => {
    setLogError('');
    setLogged('');
    const defaults = unitDefaults(nutrition, pool, result);
    const units = Object.keys(defaults);
    const unit = units[0] ?? 'serving';
    setDraft({
      result,
      quantity: String(defaults[unit] ?? 1),
      unit,
      units,
      defaults,
      meal: 'other',
    });
  };

  const commit = () => {
    if (!draft) return;
    const quantity = positiveQty(draft.quantity);
    // Zero and negative are not quantities; every scaler throws on them, and a
    // thrown error mid-write would leave the sheet open with no explanation.
    if (quantity == null) {
      setLogError('Enter how much you had — a number greater than zero.');
      return;
    }
    const at = new Date().toISOString();
    const ctx = { id: uid(), logDate: ymd(new Date()), meal: draft.meal, at };
    try {
      update((n) => {
        const entry = buildEntry(n, pool, draft, quantity, ctx);
        n.logEntries.push(entry);
        // The source is cached ON THE WAY PAST, only now that it has actually
        // been logged: see the offline decision at the top of this file.
        const food = draft.result.kind === 'food' ? findFood(n, pool, draft.result.id) : null;
        if (food) upsertCachedFood(n, food);
      });
    } catch (e) {
      // An incompatible unit is the expected failure and reads as advice; any
      // other throw is a bug and must not be dressed up as one.
      setLogError(
        e instanceof IncompatibleUnitError
          ? `That unit does not fit this food. ${e.message.split('. ')[0]}.`
          : e instanceof Error
            ? e.message
            : 'That could not be logged.',
      );
      return;
    }
    setLogged(`${draft.result.title} added to ${draft.meal}.`);
    setDraft(null);
  };

  const toggleStar = (result: FoodSearchResult) => {
    const key = favoriteKey(result.kind, result.id);
    const on = starred.has(key);
    update((n) => {
      const row = n.favorites.find((f) => favoriteKey(kindOf(f), targetOf(f)) === key);
      const at = new Date().toISOString();
      if (row) {
        // Un-starring is a STAMP: `mergeNutrition` is additive, so a spliced
        // favourite comes back from the other device on the next sync.
        row.deletedAt = on ? at : null;
        row.updatedAt = at;
        return;
      }
      n.favorites.push({
        userId: '',
        foodId: result.kind === 'food' ? result.id : null,
        customFoodId: result.kind === 'custom_food' ? result.id : null,
        recipeId: result.kind === 'recipe' ? result.id : null,
        sortOrder: n.favorites.length,
        createdAt: at,
        updatedAt: at,
        deletedAt: null,
      });
      // A starred catalogue food that is not on the device could not be logged
      // offline, and `favoriteResults` would drop it from the very list the
      // athlete just added it to.
      const food = result.kind === 'food' ? findFood(n, pool, result.id) : null;
      if (food) upsertCachedFood(n, food);
    });
  };

  return (
    <Screen>
      <Kicker>Nutrition</Kicker>
      <Title>Food</Title>
      <T className="mt-0.5 text-3 text-muted">Anything you add here is logged against today.</T>

      <View className="mt-2 flex-row gap-1">
        <View className="min-w-0 flex-1">
          <Btn variant="brass" onPress={onQuickAdd} className="w-full">
            Quick add
          </Btn>
        </View>
        <View className="min-w-0 flex-1">
          <Btn onPress={onCreateCustomFood} className="w-full">
            New food
          </Btn>
        </View>
        <View className="min-w-0 flex-1">
          <Btn onPress={onCreateRecipe} className="w-full">
            New recipe
          </Btn>
        </View>
      </View>

      {/* Both optional, so a caller that has not wired the panes — and the
          existing tests, which mount this screen directly — renders neither
          rather than a button that leads nowhere. */}
      {onScanBarcode || onReadLabel ? (
        <View className="mt-1 flex-row gap-1">
          {onScanBarcode ? (
            <View className="min-w-0 flex-1">
              <Btn onPress={onScanBarcode} className="w-full">
                Scan barcode
              </Btn>
            </View>
          ) : null}
          {onReadLabel ? (
            <View className="min-w-0 flex-1">
              <Btn onPress={onReadLabel} className="w-full">
                Read a label
              </Btn>
            </View>
          ) : null}
        </View>
      ) : null}

      <Input
        value={query}
        onChangeText={setQuery}
        placeholder="Search foods, your foods, recipes"
        accessibilityLabel="Search foods"
        className="mt-2 h-5 rounded-md border border-line bg-well px-1 text-5 text-text"
      />

      {offline ? (
        <T className="mt-1.5 rounded-md border border-line2 bg-panel p-1.5 text-3 text-muted">
          {offline} Quick add always works.
        </T>
      ) : null}

      {logged ? <T className="mt-1.5 text-3 text-ok">{logged}</T> : null}

      {draft ? (
        <LogSheet
          draft={draft}
          error={logError}
          onChange={setDraft}
          onSave={commit}
          onCancel={() => {
            setDraft(null);
            setLogError('');
          }}
        />
      ) : null}

      <SectionHead
        title={trimmed ? 'Results' : 'Favourites and recent'}
        right={searching ? <T className="text-3 text-dim">Searching…</T> : undefined}
      />

      {shown.length === 0 ? (
        <Empty
          title={trimmed ? 'Nothing found' : 'Nothing here yet'}
          body={
            trimmed
              ? offline
                ? 'Nothing on this device matches. The shared catalogue is unreachable, so it could not be asked.'
                : 'No food, custom food or recipe matches that. Quick add works without one.'
              : 'Star a food or log something and it will be here next time.'
          }
        />
      ) : (
        <Card>
          {shown.map((r, i) => (
            <ResultRow
              key={favoriteKey(r.kind, r.id)}
              result={r}
              first={i === 0}
              starred={starred.has(favoriteKey(r.kind, r.id))}
              onPress={() => openDraft(r)}
              onStar={() => toggleStar(r)}
              onEdit={
                r.kind === 'custom_food'
                  ? () => onEditCustomFood(r.id)
                  : r.kind === 'recipe'
                    ? () => onEditRecipe(r.id)
                    : undefined
              }
            />
          ))}
        </Card>
      )}
    </Screen>
  );
}

/** What a result is, in one word the athlete can act on. */
const SOURCE_LABEL: Record<FoodSourceKind, string> = {
  food: 'Catalogue',
  custom_food: 'Your food',
  recipe: 'Recipe',
};

function ResultRow({
  result,
  first,
  starred,
  onPress,
  onStar,
  onEdit,
}: {
  result: FoodSearchResult;
  first: boolean;
  starred: boolean;
  onPress: () => void;
  onStar: () => void;
  onEdit?: () => void;
}) {
  return (
    <View className={first ? '' : 'mt-1.5 border-t border-line pt-1.5'}>
      <View className="flex-row items-center gap-1">
        <Tap box={{ h: 44 }} onPress={onPress} label={`log ${result.title}`} className="min-w-0 flex-1">
          <T w="med" className="text-5 text-text">
            {result.title}
          </T>
          <T className="mt-0.5 text-3 text-muted">
            {SOURCE_LABEL[result.kind]}
            {result.subtitle ? ` · ${result.subtitle}` : ''}
            {/* Said out loud, because "can I log this on the train" is
                otherwise a question the athlete answers by trying. */}
            {result.kind === 'food' && !result.offline ? ' · needs a connection' : ''}
          </T>
        </Tap>
        {onEdit ? (
          <Tap
            box={{ h: 44, w: 44 }}
            onPress={onEdit}
            label={`edit ${result.title}`}
            className="items-center justify-center px-1"
          >
            <T className="text-5 text-dim">✎</T>
          </Tap>
        ) : null}
        <Tap
          box={{ h: 44, w: 44 }}
          onPress={onStar}
          label={starred ? `unstar ${result.title}` : `star ${result.title}`}
          className="items-center justify-center px-1"
        >
          <T className={`text-6 ${starred ? 'text-gold2' : 'text-dim'}`}>{starred ? '★' : '☆'}</T>
        </Tap>
      </View>
    </View>
  );
}

/** Quantity, unit and meal — the reference's AddLogEntryScreen, in a card. */
function LogSheet({
  draft,
  error,
  onChange,
  onSave,
  onCancel,
}: {
  draft: LogDraft;
  error: string;
  onChange: (d: LogDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <Card tone="raised" className="mt-2">
      <T w="semi" className="text-6 text-text">
        {draft.result.title}
      </T>
      <View className="mt-1.5 flex-row gap-1">
        <View className="min-w-0 flex-1">
          <T w="semi" className="text-2 uppercase tracking-widest text-dim">
            Quantity
          </T>
          <Input
            value={draft.quantity}
            onChangeText={(v: string) => onChange({ ...draft, quantity: v })}
            accessibilityLabel="Quantity"
            keyboardType="decimal-pad"
            num
            w="semi"
            className="mt-0.5 h-5 rounded-md border border-line bg-well px-1 text-5 text-text"
          />
        </View>
      </View>
      {/* The quantity is reseeded with the unit — see `LogDraft.defaults`. A
          number carried across a unit change is a different measurement. */}
      <UnitChips
        units={draft.units}
        value={draft.unit}
        onChange={(unit) =>
          onChange({ ...draft, unit, quantity: String(draft.defaults[unit] ?? draft.quantity) })
        }
      />
      <MealChips value={draft.meal} onChange={(meal) => onChange({ ...draft, meal })} />
      {error ? <T className="mt-1.5 text-3 text-bad">{error}</T> : null}
      <View className="mt-2 flex-row gap-1">
        <View className="min-w-0 flex-1">
          <Btn variant="brass" onPress={onSave} className="w-full">
            Add to log
          </Btn>
        </View>
        <View className="min-w-0 flex-1">
          <Btn onPress={onCancel} className="w-full">
            Cancel
          </Btn>
        </View>
      </View>
      <T className="mt-1 text-3 text-dim">
        The macros are worked out now and stored as they are — editing this food later will not change this entry.
      </T>
    </Card>
  );
}

/* ---------- resolution helpers ---------- */

/** A catalogue food from the device first, then from the live search results. */
function findFood(db: NutritionDB, remote: readonly CachedFood[], id: string): CachedFood | null {
  return remote.find((f) => f.id === id) ?? db.foodCache.find((f) => f.id === id) ?? null;
}

const kindOf = (f: { foodId?: string | null; customFoodId?: string | null }): FoodSourceKind =>
  f.foodId ? 'food' : f.customFoodId ? 'custom_food' : 'recipe';

const targetOf = (f: { foodId?: string | null; customFoodId?: string | null; recipeId?: string | null }): string =>
  f.foodId ?? f.customFoodId ?? f.recipeId ?? '';

/**
 * The units this result can be logged in.
 *
 * A catalogue food's own unit leads, then any unit its servings table records
 * a real conversion for. Nothing else is offered, because anything else would
 * need a density nobody stated.
 */
function unitsFor(db: NutritionDB, remote: readonly CachedFood[], result: FoodSearchResult): string[] {
  return Object.keys(unitDefaults(db, remote, result));
}

/**
 * The units this result can be offered in, with one serving's worth in each.
 *
 * The rule lives in `loggableUnits` next to the resolver it mirrors; this is
 * only the dispatch over the three result kinds. A recipe is logged in
 * servings and a custom food in its own single unit — neither carries a
 * servings table.
 */
function unitDefaults(db: NutritionDB, remote: readonly CachedFood[], result: FoodSearchResult): Record<string, number> {
  if (result.kind === 'recipe') return { serving: 1 };
  if (result.kind === 'custom_food') {
    const food = db.customFoods.find((f) => f.id === result.id);
    return food ? loggableUnits(food) : { serving: 1 };
  }
  const food = findFood(db, remote, result.id);
  return food ? loggableUnits(food, food.servings) : { serving: 1 };
}

/**
 * Build the entry, or throw.
 *
 * Runs inside `update`, so a throw abandons the whole draft rather than writing
 * half of it — the provider's `update` never commits a draft its callback threw
 * out of.
 */
function buildEntry(
  db: NutritionDB,
  remote: readonly CachedFood[],
  draft: LogDraft,
  quantity: number,
  ctx: { id: string; logDate: string; meal: string; at: string },
) {
  if (draft.result.kind === 'custom_food') {
    const food = db.customFoods.find((f) => f.id === draft.result.id);
    if (!food) throw new Error('That food is no longer on this device.');
    return logEntryFromCustomFood(ctx, food, quantity, draft.unit);
  }
  if (draft.result.kind === 'recipe') {
    const recipe = db.recipes.find((r) => r.id === draft.result.id);
    if (!recipe) throw new Error('That recipe is no longer on this device.');
    return logEntryFromRecipe(ctx, recipe, resolveRecipePerServing(recipe, lookupFor(db)), quantity);
  }
  const food = findFood(db, remote, draft.result.id);
  // Offline, with a food that was never cached, this is the honest end of the
  // road: there is nothing to scale, and inventing it is the one thing forbidden.
  if (!food) throw new Error('That food is not on this device and the catalogue is unreachable.');
  return logEntryFromFood(ctx, food, quantity, draft.unit);
}

/** Recipe ingredients resolve entirely from the device — that is the point. */
export const lookupFor = (db: NutritionDB): RecipeLookup => ({
  food: (id) => db.foodCache.find((f) => f.id === id) ?? null,
  customFood: (id) => db.customFoods.find((f) => f.id === id && f.deletedAt == null) ?? null,
});
