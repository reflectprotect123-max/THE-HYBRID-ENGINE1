import { useState } from 'react';
import { View } from 'react-native';
import { uid, ymd } from '@hybrid/engine';
import { quickAddEntry } from '@hybrid/nutrition-core';
import { useNutrition } from '../../store/nutrition';
import { Btn, Card, Kicker, Screen, T, Title } from '../../ui';
import { MealChips, NumField, TextField, macro } from './fields';

/*
 * Quick add: macros with no food record behind them. Ported from MacroTrack's
 * `QuickAddScreen.kt`.
 *
 * This is the screen that has to work when everything else does not. It touches
 * no catalogue, needs no connection, and creates no food — so it is what stands
 * between a broken network and an athlete who cannot log their dinner. The
 * entry it writes carries `entry_kind = 'quick_add'` and all three provenance
 * ids null, which is the table's own check constraint and also the literal
 * truth: there is no source these numbers could ever be re-derived from.
 */

export function QuickAddScreen({ onDone, onCancel }: { onDone: (message: string) => void; onCancel: () => void }) {
  const { update } = useNutrition();
  const [name, setName] = useState('');
  const [meal, setMeal] = useState('other');
  const [calories, setCalories] = useState('');
  const [proteinG, setProtein] = useState('');
  const [carbsG, setCarbs] = useState('');
  const [fatG, setFat] = useState('');

  const trimmed = name.trim();

  const save = () => {
    // An entry with no name is unreadable in the day's list and unfindable
    // later; the button is disabled on this too, this is the guard behind it.
    if (!trimmed) return;
    const at = new Date().toISOString();
    update((n) => {
      n.logEntries.push(
        quickAddEntry(
          { id: uid(), logDate: ymd(new Date()), meal, at },
          {
            displayName: trimmed,
            calories: macro(calories),
            proteinG: macro(proteinG),
            carbsG: macro(carbsG),
            fatG: macro(fatG),
          },
        ),
      );
    });
    onDone(`${trimmed} added to ${meal}.`);
  };

  return (
    <Screen>
      <Kicker>Nutrition</Kicker>
      <Title>Quick add</Title>
      <T className="mt-0.5 text-3 text-muted">
        Straight onto today, with no food record. Nothing here needs a connection.
      </T>

      <Card tone="raised" className="mt-2">
        <TextField label="Name" value={name} onChange={setName} placeholder="What did you eat?" />
        <MealChips value={meal} onChange={setMeal} />
        <View className="mt-1.5 flex-row gap-1">
          <NumField label="kcal" value={calories} onChange={setCalories} />
          <NumField label="Protein g" value={proteinG} onChange={setProtein} />
          <NumField label="Carbs g" value={carbsG} onChange={setCarbs} />
          <NumField label="Fat g" value={fatG} onChange={setFat} />
        </View>
        <View className="mt-2 flex-row gap-1">
          <View className="min-w-0 flex-1">
            <Btn variant="brass" onPress={save} disabled={!trimmed} className="w-full">
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
          These numbers are stored as you type them and are never recalculated later.
        </T>
      </Card>
    </Screen>
  );
}
