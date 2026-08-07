import { View } from 'react-native';
import { isLive } from '@hybrid/nutrition-core';
import { WorldSwitch } from '../../ui/WorldSwitch';
import { useNutrition } from '../../store/nutrition';
import { Card, Kicker, Screen, SectionHead, T, Title } from '../../ui';

/*
 * Settings for the nutrition world.
 *
 * A SEPARATE screen from the training Settings, not the same one re-themed.
 * That screen is HR zones, WHOOP, Concept2 and an EngineDB backup — every line
 * of it a training control, and the sealed-worlds rule says a training surface
 * must not be reachable from here. What both worlds genuinely share is the way
 * out, so `WorldSwitch` is the first thing on it.
 *
 * Sign-in and cloud sync stay on the training Settings for this slice: they
 * are account-level, they are already reachable one tap away through the
 * switch, and lifting them out is a refactor of that screen rather than part
 * of building this one.
 */
export function NutritionSettingsScreen() {
  const { nutrition, saveFailed, dataRecovered } = useNutrition();
  // Live only: a soft-deleted entry still exists as a record, and counting it
  // would tell the athlete they have food logged that no screen will show.
  const logged = nutrition.logEntries.filter(isLive).length;
  const days = new Set(nutrition.logEntries.filter(isLive).map((e) => e.logDate)).size;

  return (
    <Screen>
      <Kicker>Nutrition</Kicker>
      <Title>Settings</Title>

      <WorldSwitch />

      {dataRecovered ? (
        <T className="mt-2 rounded-md border border-bad bg-panel p-2 text-4 text-bad">
          Your food log couldn&apos;t be read and had to be reset.
        </T>
      ) : saveFailed ? (
        <T className="mt-2 rounded-md border border-bad bg-panel p-2 text-4 text-bad">
          The last save failed — usually a full disk.
        </T>
      ) : null}

      <SectionHead title="Your food data" />
      <Card>
        <T num className="text-4 text-muted">
          {logged} entr{logged === 1 ? 'y' : 'ies'} across {days} day{days === 1 ? '' : 's'}
        </T>
        <View className="mt-1">
          <T className="text-3 text-dim">
            Your food log is stored separately from your training data, so neither can overwrite the other — on this
            phone or in the cloud.
          </T>
        </View>
      </Card>
    </Screen>
  );
}
