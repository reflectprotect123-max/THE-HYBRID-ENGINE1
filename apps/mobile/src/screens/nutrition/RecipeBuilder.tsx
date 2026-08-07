import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, View } from 'react-native';
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
import { Btn, Card, Empty, Input, Kicker, Screen, SectionHead, T, Tap, Title } from '../../ui';
import { NumField, TextField, macroLine, positiveQty } from './fields';
import { lookupFor } from './FoodSearch';

/*
 * The recipe builder, ported from MacroTrack's `RecipeBuilderScreen.kt` and
 * `RecipeRepository`. The macro maths is `@hybrid/nutrition-core`'s
 * `resolveRecipePerServing` — the faithful port of `RecipeMacroResolver`,
 * tested against that repository's own fixtures.
 *
 * A recipe stores NO macros. They are resolved from its ingredients every time
 * they are shown, so correcting an ingredient corrects the recipe — while every
 * meal already logged from it keeps the numbers it was logged with. Those two
 * facts only coexist because the log entry snapshots and the recipe does not.
 *
 * OFFLINE: ingredients resolve entirely from the device (`foodCache` and
 * `customFoods`), which is why adding a catalogue food as an ingredient caches
 * it right then. A recipe built on wifi therefore still resolves, and still
 * logs, on a train. The ingredient SEARCH reaches the catalogue when it can and
 * degrades to the device when it cannot, exactly as the Food search does.
 */

interface Props {
  onDone: (message: string) => void;
  onCancel: () => void;
  /** The recipe being edited, or undefined when creating one. */
  editId?: string;
  /** Injected so a test — and an offline device — needs no network. */
  search?: CatalogueSearch;
}

/** An ingredient while it is being edited: quantity is still text. */
interface Draft {
  id: string;
  foodId: string | null;
  customFoodId: string | null;
  name: string;
  quantity: string;
  unit: string;
}

const QUERY_DEBOUNCE_MS = 250;

export function RecipeBuilderScreen({ onDone, onCancel, editId, search = searchCatalogue }: Props) {
  const { nutrition, update } = useNutrition();
  const existing = editId ? nutrition.recipes.find((r) => r.id === editId) : undefined;

  const [name, setName] = useState(existing?.name ?? '');
  const [servings, setServings] = useState(existing ? String(existing.servings) : '1');
  const [items, setItems] = useState<Draft[]>(() =>
    existing ? existing.items.map((item) => draftOf(item, nutrition)) : [],
  );
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState<CachedFood[]>([]);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState('');

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
     custom food and nothing else, which is also what stops a recipe containing
     itself and resolving forever. */
  const candidates = useMemo(
    () => foodSearch(nutrition, trimmedQuery, remote).filter((r) => r.kind !== 'recipe'),
    [nutrition, trimmedQuery, remote],
  );

  const servingCount = positiveQty(servings);

  /* Resolved live, from the same function that will resolve it at log time. A
     recipe whose ingredients do not resolve cannot be logged, so the athlete
     should find that out here, while they can still fix it. */
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
         device from the moment it is part of the recipe, or a recipe built on
         wifi resolves to nothing on a train. */
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
        // The source's own serving, in the source's own unit: the only pairing
        // that is guaranteed to resolve without a conversion nobody recorded.
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
      // `servings > 0` is a check constraint AND the divisor in `perServing`.
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
    update((n) => {
      const live = editId ? n.recipes.find((r) => r.id === editId) : undefined;
      if (live) {
        // Edited IN PLACE, and the item list is REPLACED rather than merged:
        // "these four ingredients" is the statement the athlete just made, so
        // an ingredient they removed must not survive it.
        Object.assign(live, {
          name: trimmed,
          servings: servingCount,
          items: buildItems(items, live.id),
          updatedAt: at,
        });
        return;
      }
      const id = uid();
      const recipe: Recipe = {
        id,
        /* Blank until the sync layer owns it, as with every other record this
           slice writes before a sign-in. */
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
    onDone(existing ? `${trimmed} updated.` : `${trimmed} saved. Search for it to log a serving.`);
  };

  const remove = () => {
    if (!existing) return;
    Alert.alert(`Delete "${existing.name}"?`, 'Meals you already logged from it keep their own numbers.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          update((n) => {
            const live = n.recipes.find((r) => r.id === existing.id);
            if (!live) return false;
            const at = new Date().toISOString();
            // Stamped, not spliced — `mergeNutrition` is additive.
            live.deletedAt = at;
            live.updatedAt = at;
          });
          onDone(`${existing.name} deleted.`);
        },
      },
    ]);
  };

  return (
    <Screen>
      <Kicker>Nutrition</Kicker>
      <Title>{existing ? 'Edit recipe' : 'New recipe'}</Title>

      <Card tone="raised" className="mt-2">
        <TextField label="Recipe name" value={name} onChange={setName} placeholder="e.g. Overnight oats" />
        <View className="mt-1.5 flex-row gap-1">
          <NumField label="Servings it makes" value={servings} onChange={setServings} decimal />
        </View>
        <View className="mt-2 border-t border-line pt-1.5">
          {'macros' in preview ? (
            <>
              <T w="semi" className="text-2 uppercase tracking-widest text-dim">
                Per serving
              </T>
              <T w="med" num className="mt-0.5 text-6 text-text">
                {macroLine(preview.macros)}
              </T>
            </>
          ) : (
            <T className="text-3 text-muted">{preview.problem}</T>
          )}
        </View>
        {error ? <T className="mt-1.5 text-3 text-bad">{error}</T> : null}
        <View className="mt-2 flex-row gap-1">
          <View className="min-w-0 flex-1">
            <Btn variant="brass" onPress={save} className="w-full">
              {existing ? 'Save changes' : 'Save recipe'}
            </Btn>
          </View>
          <View className="min-w-0 flex-1">
            <Btn onPress={onCancel} className="w-full">
              Cancel
            </Btn>
          </View>
        </View>
        {existing ? (
          <View className="mt-1">
            <Btn onPress={remove} label={`delete ${existing.name}`} className="w-full">
              Delete this recipe
            </Btn>
          </View>
        ) : null}
      </Card>

      <SectionHead title="Ingredients" right={<T className="text-3 text-muted">{items.length}</T>} />
      {items.length === 0 ? (
        <Empty title="Nothing added yet" body="Search below and tap a food to add it." />
      ) : (
        <Card>
          {items.map((item, i) => (
            <View key={item.id} className={i ? 'mt-1.5 border-t border-line pt-1.5' : ''}>
              <View className="flex-row items-center gap-1">
                <View className="min-w-0 flex-1">
                  <T w="med" className="text-5 text-text">
                    {item.name}
                  </T>
                  <T className="mt-0.5 text-3 text-muted">{item.unit}</T>
                </View>
                <View style={{ width: 96 }}>
                  <NumField
                    label={`Qty ${item.name}`}
                    value={item.quantity}
                    onChange={(v) =>
                      setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, quantity: v } : x)))
                    }
                    decimal
                  />
                </View>
                <Tap
                  box={{ h: 44, w: 44 }}
                  onPress={() => setItems((prev) => prev.filter((x) => x.id !== item.id))}
                  label={`remove ${item.name}`}
                  className="items-center justify-center px-1"
                >
                  <T className="text-6 text-dim">✕</T>
                </Tap>
              </View>
            </View>
          ))}
        </Card>
      )}

      <Input
        value={query}
        onChangeText={setQuery}
        placeholder="Search an ingredient"
        accessibilityLabel="Search an ingredient"
        className="mt-2 h-5 rounded-md border border-line bg-well px-1 text-5 text-text"
      />
      {offline ? (
        <T className="mt-1.5 rounded-md border border-line2 bg-panel p-1.5 text-3 text-muted">
          The shared food catalogue is unreachable. Showing foods already on this device.
        </T>
      ) : null}

      {trimmedQuery && candidates.length > 0 ? (
        <Card className="mt-1.5">
          {candidates.map((r, i) => (
            <View key={`${r.kind}:${r.id}`} className={i ? 'mt-1.5 border-t border-line pt-1.5' : ''}>
              <Tap box={{ h: 44 }} onPress={() => addIngredient(r)} label={`add ${r.title}`}>
                <T w="med" className="text-5 text-text">
                  {r.title}
                </T>
                <T className="mt-0.5 text-3 text-muted">
                  {r.kind === 'food' ? 'Catalogue' : 'Your food'}
                  {r.subtitle ? ` · ${r.subtitle}` : ''}
                </T>
              </Tap>
            </View>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}

/** An existing item, with its ingredient's name read back off the device. */
const draftOf = (item: RecipeItem, db: NutritionDB): Draft => ({
  id: item.id,
  foodId: item.foodId ?? null,
  customFoodId: item.customFoodId ?? null,
  name:
    (item.foodId ? db.foodCache.find((f) => f.id === item.foodId)?.name : undefined) ??
    (item.customFoodId ? db.customFoods.find((f) => f.id === item.customFoodId)?.name : undefined) ??
    // The ingredient is gone from the device. Named rather than hidden: the
    // recipe will refuse to resolve, and the athlete needs to see which row.
    'Missing ingredient',
  quantity: String(item.quantity),
  unit: item.unit,
});

function findFood(db: NutritionDB, remote: readonly CachedFood[], id: string): CachedFood | null {
  return remote.find((f) => f.id === id) ?? db.foodCache.find((f) => f.id === id) ?? null;
}

/**
 * Drafts as `RecipeItem`s.
 *
 * A quantity that will not parse becomes 0, which every scaler REFUSES — so
 * the live preview shows the problem and `save` will not write. Guessing 1
 * here would quietly log an ingredient the athlete never quantified.
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
