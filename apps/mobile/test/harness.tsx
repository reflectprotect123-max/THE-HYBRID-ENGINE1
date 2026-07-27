import type { ReactElement } from 'react';
import { render } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { newBlock, newEx, newSet, uid, ymd, type EngineDB, type Session, type Workout } from '@hybrid/engine';
import { DbProvider } from '../src/store/db';
import { RestProvider } from '../src/store/rest';
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

export function renderScreen(ui: ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={{ frame: FRAME, insets: INSETS }}>
      <DbProvider>
        <RestProvider>
          <NavigationContainer>{ui}</NavigationContainer>
        </RestProvider>
      </DbProvider>
    </SafeAreaProvider>,
  );
}

/**
 * Seed the store before mounting.
 *
 * DbProvider loads synchronously from the Storage port on first render, so
 * writing the blob first is enough — there is no async gap to wait on, which is
 * the same property that lets a set survive the phone going straight into a
 * pocket.
 */
export function seed(db: Partial<EngineDB>) {
  const full: EngineDB = { workouts: [], sessions: [], settings: {}, ...db };
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
  const ex = { ...newEx(), id: uid(), name, sets: [{ t: '5', rpe: '8', done: true, aVal: String(kg), aVal2: '5' }] };
  return {
    id: uid(),
    date: ymd(d),
    status: 'completed',
    blocks: [{ ...newBlock(), id: uid(), heading: 'Main', exercises: [ex] }],
    updatedAt: Date.now(),
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
