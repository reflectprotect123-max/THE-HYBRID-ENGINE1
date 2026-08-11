import { useEffect, useMemo, useRef, useState } from 'react';
import { uid } from '@hybrid/engine';
import {
  foodSearch,
  resolveRecipePerServing,
  upsertCachedFood,
  type CachedFood,
  type FoodSearchResult,
  type NutritionDB,
  type Recipe,
  type RecipeItem,
  type ScaledMacros,
} from '@hybrid/nutrition-core';
import { useNutrition } from '../../store/nutrition';
import { searchCatalogue, type CatalogueSearch } from '../../cloud/catalogue';
import { Button, Card, Empty, Kicker, ScreenTitle, SectionHead } from '../../ui';
import { macroLine, positiveQty } from './fields';
import { lookupFor } from './FoodSearch';

/*
 * Recipe builder: name + servings + ingredient list, ported from mobile's
 * `RecipeBuilderScreen.tsx` (`apps/mobile/src/screens/nutrition/RecipeBuilder.tsx`).
 * The macro maths is `@hybrid/nutrition-core`'s `resolveRecipePerServing` —
 * this screen never computes a macro itself.
 *
 * A recipe stores NO macros; they are resolved from its ingredients live, here
 * and again at log time, from the SAME lookup (`lookupFor`, exported by
 * `FoodSearch.tsx` and reused rather than duplicated).
 *
 * Ingredient search reuses `foodSearch` + the injected `search` exactly as
 * `FoodSearch.tsx` does — same offline decision, same debounce constant —
 * because a recipe built on wifi must still resolve, and still add
 * ingredients, on a train. Editing an existing recipe is out of scope here,
 * same as `CustomFood.tsx`'s create-only scope: nothing on web yet lists
 * recipes to edit.
 */

const QUERY_DEBOUNCE_MS = 250;

/** An ingredient while it is being edited: quantity is still text. */
interface Draft {
  id: string;
  foodId: string | null;
  customFoodId: string | null;
  name: string;
  quantity: string;
  unit: string;
}

export function RecipeBuilder({ search = searchCatalogue }: { search?: CatalogueSearch }) {
  const { nutrition, update } = useNutrition();

  const [name, setName] = useState('');
  const [servings, setServings] = useState('1');
  const [items, setItems] = useState<Draft[]>([]);
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState<CachedFood[]>([]);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  const trimmedQuery = query.trim();
  const inFlight = useRef(0);

  useEffect(() => {
    if (!trimmedQuery) {
      setRemote([]);
      return;
    }
    const token = ++inFlight.current;
    const timer = setTimeout(() => {
      search(trimmedQuery)
        .then((rows) => {
          if (inFlight.current !== token) return;
          setRemote(rows);
          setOffline(false);
        })
        .catch(() => {
          if (inFlight.current !== token) return;
          setRemote([]);
          setOffline(true);
        });
    }, QUERY_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmedQuery, search]);

  /* Recipes cannot be ingredients: `recipe_items` has columns for a food and a
     custom food and nothing else. */
  const candidates = useMemo(
    () => foodSearch(nutrition, trimmedQuery, remote).filter((r) => r.kind !== 'recipe'),
    [nutrition, trimmedQuery, remote],
  );

  const servingCount = positiveQty(servings);

  /* Resolved live, from the same function that will resolve it at log time. */
  const preview = useMemo((): { macros: ScaledMacros } | { problem: string } => {
    if (!items.length) return { problem: 'Add an ingredient to see the macros.' };
    if (servingCount == null) return { problem: 'How many servings does this make?' };
    try {
      return { macros: resolveRecipePerServing(asRecipe(items, servingCount, name), lookupFor(nutrition)) };
    } catch (e) {
      return { problem: e instanceof Error ? e.message : 'These ingredients do not resolve.' };
    }
  }, [nutrition, items, servingCount, name]);

  const addIngredient = (result: FoodSearchResult) => {
    const food = result.kind === 'food' ? findFood(nutrition, remote, result.id) : null;
    const custom = result.kind === 'custom_food' ? nutrition.customFoods.find((f) => f.id === result.id) : null;
    const source = food ?? custom;
    if (!source) {
      setError('That food is not on this device, so it cannot be resolved offline later.');
      return;
    }
    if (food) {
      /* Cached HERE, not at save time: the ingredient's macros must be on the
         device from the moment it is part of the recipe. */
      update((n) => upsertCachedFood(n, food));
    }
    setError('');
    setQuery('');
    setItems((prev) => [
      ...prev,
      {
        id: uid(),
        foodId: food ? food.id : null,
        customFoodId: custom ? custom.id : null,
        name: source.name,
        quantity: String(source.servingQty),
        unit: source.servingUnit,
      },
    ]);
  };

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Give the recipe a name.');
      return;
    }
    if (servingCount == null) {
      setError('Enter how many servings this makes — a number greater than zero.');
      return;
    }
    if (!items.length) {
      setError('A recipe needs at least one ingredient.');
      return;
    }
    if ('problem' in preview) {
      setError(preview.problem);
      return;
    }
    const at = new Date().toISOString();
    const id = uid();
    update((n) => {
      const recipe: Recipe = {
        id,
        userId: '',
        name: trimmed,
        description: null,
        instructions: null,
        servings: servingCount,
        items: buildItems(items, id),
        createdAt: at,
        updatedAt: at,
        deletedAt: null,
      };
      n.recipes.push(recipe);
    });
    setError('');
    setSaved(`${trimmed} saved. Search for it to log a serving.`);
    setName('');
    setServings('1');
    setItems([]);
  };

  return (
    <>
      <Kicker>Nutrition</Kicker>
      <ScreenTitle>New recipe</ScreenTitle>

      <Card tone="raised" className="mt-2">
        <TextRow label="Recipe name" value={name} onChange={setName} placeholder="e.g. Overnight oats" />
        <div className="mt-1.5">
          <NumRow label="Servings it makes" value={servings} onChange={setServings} />
        </div>
        <div className="mt-2 border-t border-line pt-1.5">
          {'macros' in preview ? (
            <>
              <span className="block text-2 font-[750] uppercase tracking-[.1em] text-dim">Per serving</span>
              <p data-testid="per-serving-macros" className="num mt-0.5 text-6 font-[650] text-text">
                {macroLine(preview.macros)}
              </p>
            </>
          ) : (
            <p className="text-3 text-muted">{preview.problem}</p>
          )}
        </div>
        {error ? <p className="mt-1.5 text-3 text-bad">{error}</p> : null}
        {saved ? <p className="mt-1.5 text-3 text-ok">{saved}</p> : null}
        <div className="mt-2 flex gap-1">
          <Button variant="brass" className="flex-1" onClick={save}>
            Save recipe
          </Button>
        </div>
      </Card>

      <SectionHead title="Ingredients" right={<span className="text-3 text-muted">{items.length}</span>} />
      {items.length === 0 ? (
        <Empty title="Nothing added yet" body="Search below and tap a food to add it." />
      ) : (
        <Card>
          {items.map((item, i) => (
            <div key={item.id} className={i ? 'mt-1.5 border-t border-line pt-1.5' : ''}>
              <div className="flex items-center gap-1">
                <div className="min-w-0 flex-1">
                  <p className="text-5 font-[650] text-text">{item.name}</p>
                  <p className="mt-0.5 text-3 text-muted">{item.unit}</p>
                </div>
                <div style={{ width: 96 }}>
                  <NumRow
                    label={`Qty ${item.name}`}
                    value={item.quantity}
                    onChange={(v) =>
                      setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, quantity: v } : x)))
                    }
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setItems((prev) => prev.filter((x) => x.id !== item.id))}
                  aria-label={`remove ${item.name}`}
                  className="flex h-5 w-5 items-center justify-center px-1 text-6 text-dim"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </Card>
      )}

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search an ingredient"
        aria-label="Search an ingredient"
        className="mt-2 h-5 w-full rounded-md border border-line bg-well px-1.5 text-4 text-text outline-none placeholder:text-dim focus:border-gold-line"
      />
      {offline ? (
        <p className="mt-1.5 rounded-md border border-line2 bg-panel p-1.5 text-3 text-muted">
          The shared food catalogue is unreachable. Showing foods already on this device.
        </p>
      ) : null}

      {trimmedQuery && candidates.length > 0 ? (
        <Card className="mt-1.5">
          {candidates.map((r, i) => (
            <div key={`${r.kind}:${r.id}`} className={i ? 'mt-1.5 border-t border-line pt-1.5' : ''}>
              <button
                type="button"
                onClick={() => addIngredient(r)}
                aria-label={`add ${r.title}`}
                className="flex w-full min-w-0 items-center gap-1 rounded-md p-1 text-left hover:bg-well"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-5 font-[650] text-text">{r.title}</span>
                  <span className="mt-0.5 block text-3 text-muted">
                    {r.kind === 'food' ? 'Catalogue' : 'Your food'}
                    {r.subtitle ? ` · ${r.subtitle}` : ''}
                  </span>
                </span>
              </button>
            </div>
          ))}
        </Card>
      ) : null}
    </>
  );
}

function TextRow({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <span className="block text-2 font-[750] uppercase tracking-[.1em] text-dim">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="mt-0.5 h-5 w-full rounded-md border border-line bg-well px-1 text-5 text-text outline-none placeholder:text-dim focus:border-gold-line"
      />
    </div>
  );
}

function NumRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="min-w-0 flex-1">
      <span className="block text-2 font-[750] uppercase tracking-[.1em] text-dim">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        inputMode="decimal"
        className="num mt-0.5 h-5 w-full rounded-md border border-line bg-well px-1 text-5 text-text outline-none focus:border-gold-line"
      />
    </div>
  );
}

/* ---------- resolution helpers ---------- */

function findFood(db: NutritionDB, remote: readonly CachedFood[], id: string): CachedFood | null {
  return remote.find((f) => f.id === id) ?? db.foodCache.find((f) => f.id === id) ?? null;
}

/**
 * Drafts as `RecipeItem`s. A quantity that will not parse becomes 0, which
 * every scaler REFUSES — so the live preview shows the problem and `save`
 * will not write.
 */
function buildItems(items: readonly Draft[], recipeId: string): RecipeItem[] {
  return items.map((item, i) => ({
    id: item.id,
    recipeId,
    foodId: item.foodId,
    customFoodId: item.customFoodId,
    quantity: positiveQty(item.quantity) ?? 0,
    unit: item.unit,
    sortOrder: i,
  }));
}

/** The in-progress recipe, shaped for the resolver so the preview is the real thing. */
function asRecipe(items: readonly Draft[], servings: number, name: string): Recipe {
  return {
    id: 'preview',
    userId: '',
    name,
    description: null,
    instructions: null,
    servings,
    items: buildItems(items, 'preview'),
    createdAt: '',
    updatedAt: '',
    deletedAt: null,
  };
}
