import type { ReactElement } from 'react';
import { View } from 'react-native';
import { render } from '@testing-library/react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { newBlock, newEx, newSet, uid, ymd, type EngineDB, type Session, type Workout } from '@hybrid/engine';
import { DbProvider } from '../src/store/db';
import { RestProvider } from '../src/store/rest';
import { SetTimerProvider } from '../src/store/setTimer';
import { storage } from '../src/store/storage';
import { LS_KEY } from '@hybrid/engine';

/*
 * Mounting a screen the way the app does.
 *
 * Screens read from DbProvider and RestProvider and call navigation hooks, so
 * a bare `render(<Screen/>)` throws before it reaches anything worth asserting.
 * This is the same provider stack App.tsx builds, minus SyncProvider and
 * WhoopProvider — both degrade to "signed out" with no Supabase client, and
 * neither is what these tests are about.
 */

/** A safe-area inset frame; without it the provider blocks on a real measure. */
const FRAME = { x: 0, y: 0, width: 390, height: 844 };
const INSETS = { top: 47, left: 0, right: 0, bottom: 34 };

/**
 * Mount a screen, optionally with route params.
 *
 * Screens that read `useRoute().params` need a real navigator above them —
 * rendering the element bare gives them `undefined` params, which is a
 * different code path from the one the app actually takes. With params the
 * screen goes inside a one-route stack carrying `initialParams`; without, the
 * cheaper bare render is kept so the existing tests do not change shape.
 */
export function renderScreen(ui: ReactElement, params?: object) {
  const Stack = createNativeStackNavigator();
  const inner = params ? (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Under test" initialParams={params}>
        {() => ui}
      </Stack.Screen>
    </Stack.Navigator>
  ) : (
    ui
  );
  return render(
    <SafeAreaProvider initialMetrics={{ frame: FRAME, insets: INSETS }}>
      <DbProvider>
        <RestProvider>
          <SetTimerProvider>
            <NavigationContainer>{inner}</NavigationContainer>
          </SetTimerProvider>
        </RestProvider>
      </DbProvider>
    </SafeAreaProvider>,
  );
}

/**
 * Mount a screen with another route BELOW it in the stack, and hand back the
 * container ref.
 *
 * `renderScreen` puts the screen under test at the ROOT of a one-route stack,
 * where a back action has nowhere to go — so a screen that guards the native
 * back (Android's hardware button and the swipe-back gesture, which
 * react-navigation delivers as one POP action and one `beforeRemove` event)
 * cannot be tested at all. This gives that action somewhere to pop to, and the
 * ref to fire it with.
 */
export function renderStack(ui: ReactElement, params?: object) {
  const Stack = createNativeStackNavigator();
  const navRef = createNavigationContainerRef<{ Below: undefined; 'Under test': object | undefined }>();
  const r = render(
    <SafeAreaProvider initialMetrics={{ frame: FRAME, insets: INSETS }}>
      <DbProvider>
        <RestProvider>
          <SetTimerProvider>
            <NavigationContainer ref={navRef}>
              <Stack.Navigator screenOptions={{ headerShown: false }}>
                <Stack.Screen name="Below">{() => <View />}</Stack.Screen>
                <Stack.Screen name="Under test" initialParams={params}>
                  {() => ui}
                </Stack.Screen>
              </Stack.Navigator>
            </NavigationContainer>
          </SetTimerProvider>
        </RestProvider>
      </DbProvider>
    </SafeAreaProvider>,
  );
  return { ...r, navRef };
}

/*
 * Every key the timer providers persist OUTSIDE the main blob.
 *
 * Rest and the set timer each keep an end timestamp of their own, and the
 * in-memory storage map lives for the whole test FILE — so a test that starts a
 * hold and never stops it hands the next test a provider that resumes it. The
 * next screen then opens showing "Stop" where it should show "Start", which
 * reads as a bug in whatever that test was actually about.
 */
const TIMER_KEYS = [
  LS_KEY + '-rest-ends',
  LS_KEY + '-rest-total',
  LS_KEY + '-rest-alarm',
  LS_KEY + '-set-timer-ends',
  LS_KEY + '-set-timer-total',
  LS_KEY + '-set-timer-owner',
];

/**
 * Seed the store before mounting.
 *
 * DbProvider loads synchronously from the Storage port on first render, so
 * writing the blob first is enough — there is no async gap to wait on, which is
 * the same property that lets a set survive the phone going straight into a
 * pocket.
 *
 * Seeding is also where a test's state RESETS, so the live-timer keys are
 * cleared here: "a fresh store" has to mean a fresh clock too.
 */
export function seed(db: Partial<EngineDB>) {
  const full: EngineDB = { workouts: [], sessions: [], settings: {}, ...db };
  TIMER_KEYS.forEach((k) => storage.removeItem(k));
  storage.setItem(LS_KEY, JSON.stringify(full));
  return full;
}

/**
 * A finished session on a given day whose volume is EXACTLY `kg`.
 *
 * One done set of `kg` × 1 rep, so a test can name the number it expects on the
 * chart instead of deriving it. `daysAgo` rather than a date string because the
 * weekly buckets are relative to now — a fixed date would drift out of the
 * window the day after it was written.
 */
export function volumeSession(daysAgo: number, kg: number): Session {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const ex = { ...newEx(), id: uid(), name: 'Back squat', sets: [{ t: '1', rpe: '8', done: true, aVal: String(kg), aVal2: '1' }] };
  return {
    id: uid(),
    date: ymd(d),
    status: 'completed',
    blocks: [{ ...newBlock(), id: uid(), heading: 'Main', exercises: [ex] }],
    updatedAt: Date.now(),
  };
}

/**
 * A finished session `daysAgo` holding one lift at `kg` × 5, so the e1RM the
 * balance readout compares is a number the test named.
 */
export function liftSession(daysAgo: number, name: string, kg: number): Session {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  // `completedAt` is not decoration: exLogFor and rpeGapInfo both require it,
  // and a session without one is invisible to every history read path.
  const at = d.getTime();
  const ex = { ...newEx(), id: uid(), name, sets: [{ t: '5', rpe: '8', done: true, aVal: String(kg), aVal2: '5' }] };
  return {
    id: uid(),
    date: ymd(d),
    status: 'completed',
    blocks: [{ ...newBlock(), id: uid(), heading: 'Main', exercises: [ex] }],
    startedAt: at,
    completedAt: at,
    updatedAt: at,
  };
}

/** A standalone conditioning effort `daysAgo`, `min` minutes long. */
export function runEffort(daysAgo: number, min: number) {
  return { id: uid(), startedAt: Date.now() - daysAgo * 864e5, dur: min * 60 };
}

/** A one-lift, three-set workout — the shape almost every test wants. */
export function liftWorkout(name = 'Back squat', sets = 3): Workout {
  const ex = { ...newEx(), id: uid(), name, sets: Array.from({ length: sets }, () => ({ ...newSet(), t: '5', rpe: '8' })) };
  const block = { ...newBlock(), id: uid(), heading: 'Main', exercises: [ex] };
  return { id: uid(), name: 'Lower', blocks: [block], updatedAt: Date.now() };
}
