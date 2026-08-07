import { useState } from 'react';
import { Alert, View } from 'react-native';
import { uid } from '@hybrid/engine';
import type { CustomFood } from '@hybrid/nutrition-core';
import { useNutrition } from '../../store/nutrition';
import { Btn, Card, Chip, Kicker, Screen, T, Title } from '../../ui';
import { NumField, TextField, macro, positiveQty } from './fields';

/*
 * The athlete's own food. Ported from MacroTrack's `CreateCustomFoodScreen.kt`
 * and `CustomFoodRepository`.
 *
 * Entirely local: `custom_foods` is an owner-only table, so nothing here is
 * shared, nothing has to be fetched, and the whole screen works with no
 * connection. It syncs as ordinary athlete data in this slice.
 *
 * NOTHING IS PRE-FILLED. The serving size and every macro come from the label
 * in the athlete's hand or a source they trust — MacroTrack's rule #1, and the
 * reference is explicit that even the serving denominator is a hint-only
 * placeholder. A helpful default here is an invented nutrition number.
 *
 * Editing a food does NOT change what it has already been logged as. That is
 * the snapshot invariant, and it is why this screen can be used to fix a typo
 * without rewriting last month's history.
 */

/** The two denominators worth one tap. Anything else is typed. */
const COMMON_UNITS = ['g', 'ml', 'serving'] as const;

interface Props {
  /** The food being edited, or undefined when creating one. */
  editId?: string;
  onDone: (message: string) => void;
  onCancel: () => void;
}

export function CustomFoodScreen({ editId, onDone, onCancel }: Props) {
  const { nutrition, update } = useNutrition();
  const existing = editId ? nutrition.customFoods.find((f) => f.id === editId) : undefined;

  const [name, setName] = useState(existing?.name ?? '');
  const [brand, setBrand] = useState(existing?.brand ?? '');
  const [servingQty, setServingQty] = useState(existing ? String(existing.servingQty) : '');
  const [servingUnit, setServingUnit] = useState(existing?.servingUnit ?? 'g');
  const [calories, setCalories] = useState(existing ? String(existing.calories) : '');
  const [proteinG, setProtein] = useState(existing ? String(existing.proteinG) : '');
  const [carbsG, setCarbs] = useState(existing ? String(existing.carbsG) : '');
  const [fatG, setFat] = useState(existing ? String(existing.fatG) : '');
  const [error, setError] = useState('');

  const trimmedName = name.trim();
  const trimmedUnit = servingUnit.trim();
  const qty = positiveQty(servingQty);

  const save = () => {
    if (!trimmedName) {
      setError('Give the food a name.');
      return;
    }
    /* The serving quantity is what every future log of this food is DIVIDED
       by. Zero would make it un-loggable (`scaleTo` throws), and defaulting it
       to 100 would silently claim a per-100g label the athlete never read. */
    if (qty == null) {
      setError('Enter the serving size these numbers are for — a number greater than zero.');
      return;
    }
    if (!trimmedUnit) {
      setError('Enter the unit that serving is measured in.');
      return;
    }
    const at = new Date().toISOString();
    const fields = {
      name: trimmedName,
      brand: brand.trim() || null,
      servingQty: qty,
      servingUnit: trimmedUnit,
      calories: macro(calories),
      proteinG: macro(proteinG),
      carbsG: macro(carbsG),
      fatG: macro(fatG),
    };
    update((n) => {
      const live = editId ? n.customFoods.find((f) => f.id === editId) : undefined;
      if (live) {
        // Edited IN PLACE, like a log entry: rebuilding the array from a filter
        // is the shape that drops every other food.
        Object.assign(live, fields, { updatedAt: at });
        return;
      }
      const created: CustomFood = {
        id: uid(),
        /* Blank until the sync layer owns it — the same rule the log entries
           follow, and for the same reason: a client-guessed user id would be
           wrong for everything created before a sign-in. */
        userId: '',
        ...fields,
        barcode: null,
        // Empty rather than fabricated. The athlete typed four macros, not a
        // micronutrient profile, and the label scanner is a later slice.
        nutrients: {},
        source: 'user_custom',
        createdAt: at,
        updatedAt: at,
        deletedAt: null,
      };
      n.customFoods.push(created);
    });
    onDone(existing ? `${trimmedName} updated.` : `${trimmedName} saved. Search for it to log it.`);
  };

  const remove = () => {
    if (!existing) return;
    // The repo's destructive gate: the native confirm with `style: 'destructive'`.
    Alert.alert(`Delete "${existing.name}"?`, 'Meals you already logged from it keep their own numbers.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          update((n) => {
            const live = n.customFoods.find((f) => f.id === existing.id);
            if (!live) return false;
            const at = new Date().toISOString();
            // Stamped, not spliced: `mergeNutrition` is additive, so a removed
            // record returns from the other device on the next sync.
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
      <Title>{existing ? 'Edit food' : 'New food'}</Title>
      <T className="mt-0.5 text-3 text-muted">
        Enter the serving size and the numbers from the label. Nothing is filled in for you.
      </T>

      <Card tone="raised" className="mt-2">
        <TextField label="Food name" value={name} onChange={setName} placeholder="e.g. Rolled oats" />
        <TextField label="Brand" value={brand} onChange={setBrand} placeholder="Optional" />

        <View className="mt-1.5 flex-row gap-1">
          <NumField label="Serving size" value={servingQty} onChange={setServingQty} decimal />
          <View className="min-w-0 flex-1">
            <T w="semi" className="text-2 uppercase tracking-widest text-dim">
              Unit
            </T>
            <View className="mt-1 flex-row flex-wrap gap-0.5">
              {COMMON_UNITS.map((u) => (
                <Chip key={u} on={trimmedUnit === u} onPress={() => setServingUnit(u)} label={`unit ${u}`}>
                  {u}
                </Chip>
              ))}
            </View>
          </View>
        </View>

        <T className="mt-2 text-3 text-muted">
          Nutrition for {qty == null ? 'that serving' : `${qty} ${trimmedUnit || 'unit'}`}
        </T>
        <View className="mt-1 flex-row gap-1">
          <NumField label="kcal" value={calories} onChange={setCalories} />
          <NumField label="Protein g" value={proteinG} onChange={setProtein} />
          <NumField label="Carbs g" value={carbsG} onChange={setCarbs} />
          <NumField label="Fat g" value={fatG} onChange={setFat} />
        </View>

        {error ? <T className="mt-1.5 text-3 text-bad">{error}</T> : null}

        <View className="mt-2 flex-row gap-1">
          <View className="min-w-0 flex-1">
            <Btn variant="brass" onPress={save} className="w-full">
              {existing ? 'Save changes' : 'Save food'}
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
              Delete this food
            </Btn>
          </View>
        ) : null}

        <T className="mt-1 text-3 text-dim">
          {existing
            ? 'Changing these numbers does not change meals you have already logged.'
            : 'Once saved, every log of this food stores its own copy of these numbers.'}
        </T>
      </Card>
    </Screen>
  );
}
