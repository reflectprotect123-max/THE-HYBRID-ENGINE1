import { useMemo } from 'react';
import { View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useDb } from '../store/db';
import { Empty, Kicker, Screen, T, Tap, Title } from '../ui';
import { Detail } from './Library';
import type { RootStackParams } from '../App';

/*
 * A read-only look at one day: what is scheduled there, nothing else.
 *
 * `resolveDayTarget` only ever sends a tap here for a day that is neither a
 * completed session (that opens its own Recap) nor today (that opens
 * Training, where Start actually lives) — see apps/mobile/src/store/session.ts.
 * That split is what keeps this screen honest: no Start button, no write of
 * any kind. Starting or logging a session for a non-today date is explicitly
 * out of scope (docs/superpowers/specs/2026-08-02-calendar-day-jump-design.md).
 *
 * The route carries only the date, not a workout id — deliberately DIFFERENT
 * from the design doc's literal `nav.navigate('Day', {date, workoutId})`, and
 * on purpose. The reason web's Day.tsx dropped the id (a reload/direct link
 * loses navigation state) does not map onto mobile as-is: this app has no
 * `linking` config and no navigation-state persistence (see App.tsx), so a
 * cold restart drops the WHOLE stack back to the tab bar rather than
 * resurrecting a Day screen with a stale param. But re-deriving here still
 * wins on its own merits, independent of that reload argument:
 *   - `db.workouts.find(...)` by date is exactly what Calendar's `build` and
 *     Home's week strip already compute to decide the dot for this same
 *     cell — one match rule, not two copies that can drift.
 *   - A passed `workoutId` still needs a `db.workouts.find` to become a
 *     renderable `Workout`, and that lookup can just as easily miss (the
 *     workout was deleted, or a sync pulled a remote change, between the tap
 *     and this screen mounting) — so the "not found" branch below is
 *     required either way. Re-deriving from `date` collapses id-lookup and
 *     date-lookup into the single path Calendar already trusts, rather than
 *     adding a second one that only sometimes gets used.
 *   - It matches web's Day.tsx exactly, so the two platforms share one
 *     mental model of "what does this screen show" instead of one that
 *     trusts a caller-supplied id and one that doesn't.
 * `resolveDayTarget`'s `preview` branch still carries `workoutId` in its
 * return type — same as it does for web — because the type is shared
 * conceptually across both apps; this screen simply doesn't need it passed
 * through navigation to do its job, the same way web's Day never has.
 */
export function DayScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const route = useRoute<RouteProp<RootStackParams, 'Day'>>();
  const date = route.params?.date || '';
  const { workouts } = useDb();

  const at = useMemo(() => {
    const t = Date.parse(date + 'T12:00:00');
    return Number.isFinite(t) ? new Date(t) : null;
  }, [date]);

  const matched = useMemo(() => {
    if (!at) return undefined;
    const dow = at.getDay();
    return workouts.find((w) => (w.dates || []).includes(date) || (w.days || []).includes(dow));
  }, [workouts, date, at]);

  const heading = at ? at.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) : date;

  return (
    <Screen>
      <Tap
        onPress={() => nav.goBack()}
        label="back"
        box={40}
        className="mb-1 h-5 w-5 items-center justify-center self-start rounded-md border border-line2 bg-panel2"
      >
        <T className="text-6 text-muted">←</T>
      </Tap>
      <Kicker>Day</Kicker>
      <Title>{heading}</Title>

      {matched ? (
        <View className="mt-1">
          <T w="semi" className="text-5 text-text">{matched.name || 'Session'}</T>
          <Detail w={matched} />
        </View>
      ) : (
        <View className="mt-2">
          <Empty title="Nothing scheduled" body="Nothing scheduled for this day." />
        </View>
      )}
    </Screen>
  );
}
