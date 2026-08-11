import { useState } from 'react';
import { uid } from '@hybrid/engine';
import type { CustomFood as CustomFoodRecord } from '@hybrid/nutrition-core';
import { useNutrition } from '../../store/nutrition';
import { Button, Card, Chip, Kicker, ScreenTitle } from '../../ui';
import { macro, positiveQty } from './fields';

/*
 * New food: the athlete's own food, saved once and reused from search.
 *
 * Ported from mobile's `CustomFoodScreen.tsx` (`apps/mobile/src/screens/nutrition/CustomFood.tsx`),
 * trimmed to the create path — `Food.tsx` opens this pane with no props
 * (`<CustomFood />`), the same no-editId, no-prefill shape QuickAdd's own
 * pane is opened with. Editing an existing custom food is not a gap this task
 * closes: nothing on web yet lists custom foods to edit, and mobile's `editId`
 * prop exists because ITS list screen passes one in.
 *
 * NOTHING IS INVENTED, same rule as mobile: no default macro, no default
 * serving size. Every number on this form is what the athlete typed, or blank.
 *
 * Saves straight onto `NutritionDB.customFoods` inside the store's own
 * `update`, matching mobile's `save()` exactly — NOT `entry.ts`'s `cacheFood`,
 * which forwards to `upsertCachedFood` and writes `foodCache` (a copy of a
 * CATALOGUE row), a different array for a different kind of food. A custom
 * food has no upsert helper in `@hybrid/nutrition-core` because there is only
 * ever one write path for it — push on create, `Object.assign` in place on
 * edit — so, like mobile, this screen writes the array field directly rather
 * than reaching for a helper that saves a different record type.
 */

/** The two denominators worth one tap. Anything else is typed. */
const COMMON_UNITS = ['g', 'ml', 'serving'] as const;

export function CustomFood() {
  const { update } = useNutrition();
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [servingQty, setServingQty] = useState('');
  const [servingUnit, setServingUnit] = useState('g');
  const [calories, setCalories] = useState('');
  const [proteinG, setProtein] = useState('');
  const [carbsG, setCarbs] = useState('');
  const [fatG, setFat] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  const trimmedName = name.trim();
  const trimmedUnit = servingUnit.trim();
  const qty = positiveQty(servingQty);

  const reset = () => {
    setName('');
    setBrand('');
    setServingQty('');
    setServingUnit('g');
    setCalories('');
    setProtein('');
    setCarbs('');
    setFat('');
  };

  const save = () => {
    setSaved('');
    if (!trimmedName) {
      setError('Give the food a name.');
      return;
    }
    // The serving quantity is what every future log of this food is DIVIDED
    // by. Zero would make it un-loggable, and defaulting it to 100 would
    // silently claim a per-100g label the athlete never read.
    if (qty == null) {
      setError('Enter the serving size these numbers are for — a number greater than zero.');
      return;
    }
    if (!trimmedUnit) {
      setError('Enter the unit that serving is measured in.');
      return;
    }
    setError('');
    const at = new Date().toISOString();
    const created: CustomFoodRecord = {
      id: uid(),
      // Blank until the sync layer owns it — the same rule log entries and
      // cached foods follow, and for the same reason.
      userId: '',
      name: trimmedName,
      brand: brand.trim() || null,
      barcode: null,
      servingQty: qty,
      servingUnit: trimmedUnit,
      calories: macro(calories),
      proteinG: macro(proteinG),
      carbsG: macro(carbsG),
      fatG: macro(fatG),
      // Empty rather than fabricated — four macros were typed, not a
      // micronutrient profile.
      nutrients: {},
      source: 'user_custom',
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
    };
    update((n) => {
      n.customFoods.push(created);
    });
    setSaved(`${trimmedName} saved. Search for it to log it.`);
    reset();
  };

  return (
    <>
      <Kicker>Nutrition</Kicker>
      <ScreenTitle>New food</ScreenTitle>
      <p className="mt-0.5 text-3 text-muted">
        Enter the serving size and the numbers from the label. Nothing is filled in for you.
      </p>

      {saved ? <p className="mt-1.5 text-3 text-ok">{saved}</p> : null}

      <Card tone="raised" className="mt-2">
        <TextRow label="Food name" value={name} onChange={setName} placeholder="e.g. Rolled oats" />
        <TextRow label="Brand" value={brand} onChange={setBrand} placeholder="Optional" />

        <div className="mt-1.5 flex gap-1">
          <NumCell label="Serving size" value={servingQty} onChange={setServingQty} />
          <div className="min-w-0 flex-1">
            <span className="block text-2 font-[750] uppercase tracking-[.1em] text-dim">Unit</span>
            <div className="mt-1 flex flex-wrap gap-0.5">
              {COMMON_UNITS.map((u) => (
                <Chip key={u} on={trimmedUnit === u} onClick={() => setServingUnit(u)} aria-label={`unit ${u}`}>
                  {u}
                </Chip>
              ))}
            </div>
          </div>
        </div>

        <p className="mt-2 text-3 text-muted">
          Nutrition for {qty == null ? 'that serving' : `${qty} ${trimmedUnit || 'unit'}`}
        </p>
        <div className="mt-1 grid grid-cols-4 gap-1">
          <NumCell label="Calories" value={calories} onChange={setCalories} />
          <NumCell label="Protein g" value={proteinG} onChange={setProtein} />
          <NumCell label="Carbs g" value={carbsG} onChange={setCarbs} />
          <NumCell label="Fat g" value={fatG} onChange={setFat} />
        </div>

        {error ? <p className="mt-1.5 text-3 text-bad">{error}</p> : null}

        <div className="mt-2 flex gap-1">
          <Button variant="brass" className="flex-1" onClick={save}>
            Save food
          </Button>
        </div>
        <p className="mt-1 text-3 text-dim">
          Once saved, every log of this food stores its own copy of these numbers.
        </p>
      </Card>
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
    <div className="mt-1.5">
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

function NumCell({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
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
