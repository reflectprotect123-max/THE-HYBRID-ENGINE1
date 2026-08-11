import { isLive } from '@hybrid/nutrition-core';
import { WorldSwitch } from '../../components/WorldSwitch';
import { useNutrition } from '../../store/nutrition';
import { Card, Kicker, ScreenTitle, SectionHead } from '../../ui';

/*
 * Settings for the nutrition world, ported from mobile's
 * `NutritionSettingsScreen` (`apps/mobile/src/screens/nutrition/NutritionSettings.tsx`).
 *
 * A SEPARATE screen from the training Settings, not the same one re-themed.
 * That screen (`apps/web/src/screens/Settings.tsx`) is training-only
 * controls, and the sealed-worlds rule says a training surface must not be
 * reachable from here. What both worlds genuinely share is the way across,
 * so `WorldSwitch` is the first thing on it — the same shared component also
 * renders on the training Settings screen, reading `useDiscipline()` to
 * offer the opposite direction there.
 *
 * Sign-in and cloud sync stay off this screen for the same reason mobile's
 * does: they are account-level, already reachable one tap/click away through
 * the switch, and lifting them out is a refactor of the training Settings
 * screen rather than part of building this one.
 */
export function NutritionSettings() {
  const { nutrition, saveFailed, dataRecovered } = useNutrition();
  // Live only: a soft-deleted entry still exists as a record, and counting it
  // would tell the athlete they have food logged that no screen will show.
  const logged = nutrition.logEntries.filter(isLive).length;
  const days = new Set(nutrition.logEntries.filter(isLive).map((e) => e.logDate)).size;

  return (
    <>
      <Kicker>Nutrition</Kicker>
      <ScreenTitle>Settings</ScreenTitle>

      <WorldSwitch />

      {dataRecovered ? (
        <p className="mt-2 rounded-md border border-bad bg-panel p-2 text-4 text-bad">
          Your food log couldn&apos;t be read and had to be reset.
        </p>
      ) : saveFailed ? (
        <p className="mt-2 rounded-md border border-bad bg-panel p-2 text-4 text-bad">
          The last save failed — usually a full disk.
        </p>
      ) : null}

      <SectionHead title="Your food data" />
      <Card>
        <p className="num text-4 text-muted">
          {logged} entr{logged === 1 ? 'y' : 'ies'} across {days} day{days === 1 ? '' : 's'}
        </p>
        <div className="mt-1">
          <p className="text-3 text-dim">
            Your food log is stored separately from your training data, so neither can overwrite the other — on this
            device or in the cloud.
          </p>
        </div>
      </Card>
    </>
  );
}
