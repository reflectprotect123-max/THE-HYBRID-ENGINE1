import { useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import { uid } from '@hybrid/engine';
import type { CustomFood } from '@hybrid/nutrition-core';
import type { LabelFormValues } from '../../store/scanCorpus';
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
 * NOTHING IS INVENTED. The serving size and every macro come from the label in
 * the athlete's hand or a source they trust — MacroTrack's rule #1, and the
 * reference is explicit that even the serving denominator is a hint-only
 * placeholder. A default supplied by this screen would be an invented
 * nutrition number.
 *
 * `prefill` is not a default and is the only exception: it carries what the
 * athlete just scanned or just had read off a panel they typed in. It is a
 * transcription of their own label, arriving one screen later, and every field
 * the reader was unsure of arrives blank rather than zeroed — which is the
 * same rule stated from the other side.
 *
 * Editing a food does NOT change what it has already been logged as. That is
 * the snapshot invariant, and it is why this screen can be used to fix a typo
 * without rewriting last month's history.
 */

/** The two denominators worth one tap. Anything else is typed. */
const COMMON_UNITS = ['g', 'ml', 'serving'] as const;

/** What a barcode scan or a label read hands forward. Every field optional. */
export interface CustomFoodPrefill {
  barcode?: string | null;
  calories?: number | null;
  proteinG?: number | null;
  carbsG?: number | null;
  fatG?: number | null;
  servingQty?: number | null;
  servingUnit?: string | null;
  /** Said on screen, so the athlete knows which numbers are not their typing. */
  note?: string;
}

interface Props {
  /** The food being edited, or undefined when creating one. */
  editId?: string;
  /** Values carried in from the scanner or the label reader. */
  prefill?: CustomFoodPrefill;
  /**
   * A CREATED food's fields as they arrived and as they were saved.
   *
   * The `before` half is the point: it is what the athlete was actually
   * looking at when they pressed save, which is the only thing a proposal can
   * honestly be scored against. Never fired for an edit — editing a food months
   * later says nothing about the read that created it.
   */
  onSaved?: (before: LabelFormValues, after: LabelFormValues) => void;
  onDone: (message: string) => void;
  onCancel: () => void;
}

/** A prefilled number, or blank. Never "0" — a missing macro is not zero. */
const initial = (n: number | null | undefined): string => (n == null ? '' : String(Math.round(n * 10) / 10));

export function CustomFoodScreen({ editId, prefill, onSaved, onDone, onCancel }: Props) {
  const { nutrition, update } = useNutrition();
  const existing = editId ? nutrition.customFoods.find((f) => f.id === editId) : undefined;

  const [name, setName] = useState(existing?.name ?? '');
  const [brand, setBrand] = useState(existing?.brand ?? '');
  const [servingQty, setServingQty] = useState(existing ? String(existing.servingQty) : initial(prefill?.servingQty));
  const [servingUnit, setServingUnit] = useState(existing?.servingUnit ?? prefill?.servingUnit ?? 'g');
  const [calories, setCalories] = useState(existing ? String(existing.calories) : initial(prefill?.calories));
  const [proteinG, setProtein] = useState(existing ? String(existing.proteinG) : initial(prefill?.proteinG));
  const [carbsG, setCarbs] = useState(existing ? String(existing.carbsG) : initial(prefill?.carbsG));
  const [fatG, setFat] = useState(existing ? String(existing.fatG) : initial(prefill?.fatG));
  const [error, setError] = useState('');
  /* Captured on the FIRST render and never again — `useRef`'s initial argument
     is only read once, so these stay the values the prefill put on screen even
     after every one of them has been typed over. Recomputing from `prefill` at
     save time would miss the screen's own defaults (a blank unit shows as "g"),
     and reading the live state would compare the athlete's answer to itself. */
  const shown = useRef<LabelFormValues>({ calories, proteinG, carbsG, fatG, servingQty, servingUnit });
  /* The barcode is carried, not shown as an editable field: it came off a
     scanner and a typo in it would silently attach this food to a different
     product's code. It is only ever set when creating. */
  const barcode = existing ? existing.barcode : (prefill?.barcode ?? null);

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
        // Kept so the NEXT scan of this product finds it on this device
        // instead of ending at the same dead end again.
        barcode,
        // Empty rather than fabricated. The athlete typed four macros, not a
        // micronutrient profile, and no panel reader here produces one.
        nutrients: {},
        source: 'user_custom',
        createdAt: at,
        updatedAt: at,
        deletedAt: null,
      };
      n.customFoods.push(created);
    });
    // After the write, so a rejected save never reports a confirmation that
    // did not happen; only for a create, which is the only path a prefill has.
    if (!existing) onSaved?.(shown.current, { calories, proteinG, carbsG, fatG, servingQty, servingUnit });
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
        {prefill && !existing
          ? 'Check every number against the packet before saving. Anything blank was not read — type it in.'
          : 'Enter the serving size and the numbers from the label. Nothing is filled in for you.'}
      </T>

      {prefill?.note && !existing ? (
        <Card tone="quiet" className="mt-1.5">
          <T className="text-3 text-muted">{prefill.note}</T>
        </Card>
      ) : null}

      {barcode && !existing ? (
        <T className="mt-1.5 text-3 text-dim" num>
          Barcode {barcode}
        </T>
      ) : null}

      <Card tone="raised" className="mt-2">
        <TextField label="Food name" value={name} onChange={setName} placeholder="e.g. Rolled oats" />
        <TextField label="Brand" value={brand} onChange={setBrand} placeholder="Optional" />

        <View className="mt-1.5 flex-row gap-1">
          <NumField label="Serving size" value={servingQty} onChange={setServingQty} />
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
