import { useEffect, useMemo, useRef, useState } from 'react';
import { uid, ymd } from '@hybrid/engine';
import {
  favoriteKey,
  favoriteResults,
  foodSearch,
  loggableUnits,
  recentResults,
  resolveRecipePerServing,
  type CachedFood,
  type FoodSearchResult,
  type FoodSourceKind,
  type NutritionDB,
  type RecipeLookup,
} from '@hybrid/nutrition-core';
import { useNutrition } from '../../store/nutrition';
import { searchCatalogue, type CatalogueSearch } from '../../cloud/catalogue';
import { Button, Card, Chip, Empty, Kicker, SectionHead } from '../../ui';
import { cacheFood, entryFromCustomFood, entryFromFood, entryFromRecipe } from './entry';

/*
 * Food search: one list over four sources — mirrors mobile's
 * `FoodSearchScreen.tsx` (search-as-you-type, recent/favourite/catalogue
 * sectioning, tap-to-open quantity sheet) minus the buttons Food.tsx's own
 * `Tabs` row already owns on web (Quick add, New food, New recipe, Scan,
 * Read label) — see that screen's TODO list for which task builds each pane.
 *
 * THE OFFLINE DECISION carries over unchanged from mobile: the shared
 * catalogue (`public.foods`) is the one networked read, searched only when
 * there is a query; favourites, custom foods, recipes and everything already
 * cached on this device (`NutritionDB.foodCache`) are local and searched with
 * no connection at all. When the catalogue cannot be reached the screen says
 * so, once, and keeps working on what is on the device — it never dresses a
 * network failure up as "no results".
 *
 * Every write goes through `entry.ts` — `entryFromFood`, `entryFromCustomFood`,
 * `entryFromRecipe` and `cacheFood`, its forwards to `@hybrid/nutrition-core`'s
 * `logEntryFrom*`/`upsertCachedFood` — the same pass-through-only rule
 * `entry.ts`'s own header documents. This screen never builds a `FoodLogEntry`
 * literal, and the store's `update` is where the write actually lands, exactly
 * as `FoodLog.tsx` and `QuickAdd.tsx` already do.
 */

/** How long a keystroke waits before it becomes a catalogue query — mobile's
 *  own constant: a round trip per character is nine queries to type
 *  "chickpeas", eight of them thrown away before the last one even lands. */
const QUERY_DEBOUNCE_MS = 250;

const MEALS = ['breakfast', 'lunch', 'dinner', 'snack', 'other'] as const;

/** What the log sheet is holding while the athlete adjusts it. */
interface LogDraft {
  result: FoodSearchResult;
  quantity: string;
  unit: string;
  units: string[];
  /** One serving's worth in EACH offered unit — see `unitDefaults` below for
   *  why the quantity is reseeded from here on every unit change. */
  defaults: Record<string, number>;
  meal: string;
}

const SOURCE_LABEL: Record<FoodSourceKind, string> = {
  food: 'Catalogue',
  custom_food: 'Your food',
  recipe: 'Recipe',
};

export function FoodSearch({ search = searchCatalogue }: { search?: CatalogueSearch }) {
  const { nutrition, update } = useNutrition();
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState<CachedFood[]>([]);
  const [searching, setSearching] = useState(false);
  /* Null means "the catalogue has not refused us" — distinct from an empty
     result list, and shown differently. */
  const [offline, setOffline] = useState<string | null>(null);
  const [draft, setDraft] = useState<LogDraft | null>(null);
  const [logError, setLogError] = useState('');
  const [logged, setLogged] = useState('');

  const trimmed = query.trim();

  /* Every response carries the query it answered, so a slow reply for "chi"
     landing after a fast reply for "chickpeas" cannot repaint the list with
     the wrong food under the right query. */
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
          // The athlete's message, never the error's — a PostgREST string
          // tells them nothing they can act on.
          setOffline('The shared food catalogue is unreachable. Showing what is on this device.');
          setSearching(false);
        });
    }, QUERY_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed, search]);

  const results = useMemo(() => foodSearch(nutrition, trimmed, remote), [nutrition, trimmed, remote]);
  /* With no query the screen is the athlete's own shelf: what they starred,
     then what they last ate, favourites first and never repeated. */
  const shelf = useMemo(() => {
    const favs = favoriteResults(nutrition);
    const seen = new Set(favs.map((f) => favoriteKey(f.kind, f.id)));
    return [...favs, ...recentResults(nutrition).filter((r) => !seen.has(favoriteKey(r.kind, r.id)))];
  }, [nutrition]);

  const shown = trimmed ? results : shelf;

  const openDraft = (result: FoodSearchResult) => {
    setLogError('');
    setLogged('');
    const defaults = unitDefaults(nutrition, remote, result);
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
    const quantity = Number(draft.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setLogError('Enter how much you had — a number greater than zero.');
      return;
    }
    const at = new Date().toISOString();
    const ctx = { id: uid(), logDate: ymd(new Date()), meal: draft.meal, at };
    try {
      update((n) => {
        const entry = buildEntry(n, remote, draft, quantity, ctx);
        n.logEntries.push(entry);
        // Cached ON THE WAY PAST, only now that it has actually been logged —
        // see the offline decision at the top of this file.
        const food = draft.result.kind === 'food' ? findFood(n, remote, draft.result.id) : null;
        if (food) cacheFood(n, food);
      });
    } catch (e) {
      setLogError(e instanceof Error ? e.message : 'That could not be logged.');
      return;
    }
    setLogged(`${draft.result.title} added to ${draft.meal}.`);
    setDraft(null);
  };

  return (
    <>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search foods, your foods, recipes"
        aria-label="Search foods"
        className="mt-1 h-5 w-full rounded-md border border-line bg-well px-1.5 text-4 text-text outline-none placeholder:text-dim focus:border-gold-line"
      />

      {offline ? (
        <p className="mt-1.5 rounded-md border border-line2 bg-panel p-1.5 text-3 text-muted">
          {offline} Quick add always works.
        </p>
      ) : null}

      {logged ? <p className="mt-1.5 text-3 text-ok">{logged}</p> : null}

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
        right={searching ? <span className="text-3 text-dim">Searching…</span> : undefined}
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
            <ResultRow key={favoriteKey(r.kind, r.id)} result={r} first={i === 0} onPress={() => openDraft(r)} />
          ))}
        </Card>
      )}
    </>
  );
}

function ResultRow({ result, first, onPress }: { result: FoodSearchResult; first: boolean; onPress: () => void }) {
  return (
    <div className={first ? '' : 'mt-1.5 border-t border-line pt-1.5'}>
      <button
        onClick={onPress}
        aria-label={`log ${result.title}`}
        className="flex w-full min-w-0 items-center gap-1 rounded-md p-1 text-left hover:bg-well"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-4 font-[650] text-text">{result.title}</span>
          <span className="mt-0.5 block text-2 text-muted">
            {SOURCE_LABEL[result.kind]}
            {result.subtitle ? ` · ${result.subtitle}` : ''}
            {result.kind === 'food' && !result.offline ? ' · needs a connection' : ''}
          </span>
        </span>
        <span aria-hidden className="text-3 text-dim">
          &rsaquo;
        </span>
      </button>
    </div>
  );
}

/** Quantity, unit and meal — the log sheet a tapped result opens into. */
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
      <p className="text-5 font-[700] text-text">{draft.result.title}</p>
      <div className="mt-1.5">
        <span className="block text-2 font-[750] uppercase tracking-[.1em] text-dim">Quantity</span>
        <input
          value={draft.quantity}
          onChange={(e) => onChange({ ...draft, quantity: e.target.value })}
          aria-label="Quantity"
          inputMode="decimal"
          className="num mt-0.5 h-5 w-full rounded-md border border-line bg-well px-1 text-5 text-text outline-none focus:border-gold-line"
        />
      </div>
      {/* The quantity is reseeded with the unit — see `LogDraft.defaults`. A
          number carried across a unit change is a different measurement: a
          100 g food opened at "100 g" must not read "100 slice". */}
      {draft.units.length > 1 ? (
        <div className="mt-1.5 flex flex-wrap gap-0.5">
          {draft.units.map((u) => (
            <Chip
              key={u}
              on={draft.unit === u}
              onClick={() => onChange({ ...draft, unit: u, quantity: String(draft.defaults[u] ?? draft.quantity) })}
            >
              {u}
            </Chip>
          ))}
        </div>
      ) : null}
      <div className="mt-1.5 flex flex-wrap gap-0.5">
        {MEALS.map((m) => (
          <Chip key={m} on={draft.meal === m} onClick={() => onChange({ ...draft, meal: m })}>
            {m}
          </Chip>
        ))}
      </div>
      {error ? <p className="mt-1.5 text-3 text-bad">{error}</p> : null}
      <div className="mt-2 flex gap-1">
        <Button variant="brass" className="flex-1" onClick={onSave}>
          Add to log
        </Button>
        <Button className="flex-1" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <p className="mt-1 text-3 text-dim">
        The macros are worked out now and stored as they are — editing this food later will not change this entry.
      </p>
    </Card>
  );
}

/* ---------- resolution helpers ---------- */

/** A catalogue food from the live search results first, then the device. */
function findFood(db: NutritionDB, remote: readonly CachedFood[], id: string): CachedFood | null {
  return remote.find((f) => f.id === id) ?? db.foodCache.find((f) => f.id === id) ?? null;
}

/**
 * The units this result can be offered in, with one serving's worth in each.
 *
 * A recipe is logged in servings and a custom food in its own single unit —
 * neither carries a servings table. A catalogue food's own unit leads, then
 * any unit its servings table records a real conversion for (`loggableUnits`).
 */
function unitDefaults(db: NutritionDB, remote: readonly CachedFood[], result: FoodSearchResult): Record<string, number> {
  if (result.kind === 'recipe') return { serving: 1 };
  if (result.kind === 'custom_food') {
    const food = db.customFoods.find((f) => f.id === result.id && f.deletedAt == null);
    return food ? loggableUnits(food) : { serving: 1 };
  }
  const food = findFood(db, remote, result.id);
  return food ? loggableUnits(food, food.servings) : { serving: 1 };
}

/**
 * Build the entry, or throw. Runs inside `update`, so a throw abandons the
 * whole draft rather than writing half of it.
 */
function buildEntry(
  db: NutritionDB,
  remote: readonly CachedFood[],
  draft: LogDraft,
  quantity: number,
  ctx: { id: string; logDate: string; meal: string; at: string },
) {
  if (draft.result.kind === 'custom_food') {
    const food = db.customFoods.find((f) => f.id === draft.result.id && f.deletedAt == null);
    if (!food) throw new Error('That food is no longer on this device.');
    return entryFromCustomFood(ctx, food, quantity, draft.unit);
  }
  if (draft.result.kind === 'recipe') {
    const recipe = db.recipes.find((r) => r.id === draft.result.id);
    if (!recipe) throw new Error('That recipe is no longer on this device.');
    return entryFromRecipe(ctx, recipe, resolveRecipePerServing(recipe, lookupFor(db)), quantity);
  }
  const food = findFood(db, remote, draft.result.id);
  // Offline, with a food that was never cached, this is the honest end of the
  // road: there is nothing to scale, and inventing it is the one thing
  // MacroTrack's own rules forbid outright.
  if (!food) throw new Error('That food is not on this device and the catalogue is unreachable.');
  return entryFromFood(ctx, food, quantity, draft.unit);
}

/** Recipe ingredients resolve entirely from the device — that is the point. */
export const lookupFor = (db: NutritionDB): RecipeLookup => ({
  food: (id) => db.foodCache.find((f) => f.id === id) ?? null,
  customFood: (id) => db.customFoods.find((f) => f.id === id && f.deletedAt == null) ?? null,
});
