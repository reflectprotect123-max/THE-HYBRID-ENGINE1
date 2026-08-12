import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { buildCatalogue } from '@hybrid/engine';
import type { Workout } from '@hybrid/engine';
import { useDb } from '../../store/db';
import { DayBuilder } from './DayBuilder';
import type { DayBuilderValue } from './types';
import { condSiblingId, dayBuilderToWorkouts, workoutsToDayBuilder } from './day-workout';
import { SessionPicker } from './SessionPicker';
import { Screen, T } from '../../ui';

/*
 * The day builder's SCREEN wrapper — the native twin of
 * apps/web/src/coach/library/DayBuilderRoute.tsx. "Screen" not "Route" because
 * this mounts under react-navigation, not a web router: it supplies the real
 * catalogue, loads any session already stored for this day, and writes edits
 * back.
 *
 * A `date` param is the dated mode, reached from the Calendar. No date is
 * library mode, where the guided wizard finishes.
 *
 * SAVING IS REAL AS OF 12 AUGUST 2026. Stage 3a shipped both buttons as stubs
 * that said "not connected yet" — honest, but it meant everything a coach typed
 * here was thrown away on navigation, which is why this screen had never been
 * usable. A session is an engine `Workout` in the athlete's own
 * `EngineDB.workouts`, the same store the Planner, the Library catalogue and
 * the logger already read. See `day-workout.ts` for the translation.
 *
 * WHAT PUBLISH STILL DOES NOT DO. Sending a session to a ROSTER athlete goes
 * through `repository.publishWorkoutDraft`, which needs a client and an
 * existing draft with its base version — neither of which this screen has.
 * Publish therefore saves and schedules the session on the coach's own
 * calendar and says exactly that. It does not claim to have sent anything to
 * anyone, because it has not.
 */

/**
 * This screen's navigation params — the native form of the web's `:date` path
 * segment and its `?pick=1` / `?from=<id>` query params. Exported so the
 * navigator registering this screen can put the same shape in its param list.
 */
export type DayBuilderScreenParams = {
  /** ISO date for the dated mode; absent = library mode. */
  date?: string;
  /** The Calendar's "Add from library": choose an existing session first. */
  pick?: boolean;
  /** The session the coach picked; the builder opens seeded with a COPY of it. */
  from?: string;
};

/*
 * Typed locally rather than against App.tsx's RootStackParams so this file
 * does not race the navigation wiring — the navigator imports
 * `DayBuilderScreenParams` from here, not the other way round.
 */
type BuilderStackParams = { DayBuilder: DayBuilderScreenParams | undefined };
type Nav = NativeStackNavigationProp<BuilderStackParams, 'DayBuilder'>;

export function DayBuilderScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<RouteProp<BuilderStackParams, 'DayBuilder'>>();
  const date = route.params?.date;
  const { db } = useDb();

  /*
   * On the web `pick` and `from` live in the URL so the back button behaves
   * and a half-made choice is not stranded. Here they are navigation params
   * for the same reason: the native stack header owns back, and `setParams`
   * replaces the choice in place instead of pushing a second screen the coach
   * would have to pop back through.
   */
  if (route.params?.pick) {
    return (
      <Screen>
        {/* No onBack — SessionPicker has none; the native stack header owns back. */}
        <SessionPicker
          workouts={db.workouts}
          date={date}
          onPick={(id) => nav.setParams({ pick: undefined, from: id })}
          onCreateInstead={() => nav.setParams({ pick: undefined, from: undefined })}
        />
      </Screen>
    );
  }

  /*
   * Keyed on the chosen source so picking one REMOUNTS the surface below.
   * Without the key the editor's seed — a `useState` initialiser, deliberately
   * read once so a re-render cannot overwrite what the coach is typing — would
   * still hold the value from before the choice, and the session they picked
   * would silently fail to appear.
   */
  return (
    <DayBuilderSurface
      key={route.params?.from ?? 'blank'}
      mode={date ? 'dated' : 'library'}
      date={date}
      copyFromId={route.params?.from ?? null}
    />
  );
}

function DayBuilderSurface({
  mode,
  date,
  copyFromId,
}: {
  mode: 'dated' | 'library';
  date?: string;
  copyFromId: string | null;
}) {
  const { db, update } = useDb();
  const nav = useNavigation<Nav>();
  const [notice, setNotice] = useState('');

  const entries = useMemo(() => {
    const tags = (db.settings as { movementTags?: Record<string, string[]> }).movementTags;
    return buildCatalogue(db.workouts, db.sessions, tags);
  }, [db.workouts, db.sessions, db.settings]);

  /*
   * The day's existing session, if any. Resolved ONCE — a `useState`
   * initialiser, not a `useMemo` — because this seeds an editor: recomputing
   * it after the coach's own save would hand the editor back its saved self
   * mid-edit.
   */
  /*
   * A day can hold TWO workouts, not one: `sanitizeDB` splits any workout
   * carrying both conditioning and non-conditioning blocks, so the builder
   * writes the strength sibling and the conditioning sibling separately (see
   * `dayBuilderToWorkouts`). Both are read back here as one day.
   */
  const [existing] = useState<Workout[]>(() =>
    date ? db.workouts.filter((w) => w.dates?.includes(date)) : [],
  );
  const [workoutId] = useState(() => {
    /* The STRENGTH sibling's id is the day's id — the conditioning one is
       derived from it — so a day found by its conditioning half alone still
       resolves to the same pair rather than minting a new one. */
    const cond = existing.find((w) => w.kind === 'conditioning');
    const lift = existing.find((w) => w.kind !== 'conditioning');
    if (lift) return lift.id;
    if (cond?.id.endsWith('-cond')) return cond.id.slice(0, -'-cond'.length);
    return `coach-day-${date ?? 'library'}-${Date.now()}`;
  });
  const [initialValue] = useState<DayBuilderValue | undefined>(() => {
    if (existing.length) return workoutsToDayBuilder(existing);
    /*
     * A COPY, not a link. The chosen session's block and exercise ids come
     * along inside the value, but `persist` writes under THIS day's
     * `workoutId`, so editing here never reaches back into the session the
     * coach picked — which is exactly what the picker promises them in words.
     */
    const source = copyFromId
      ? db.workouts.filter((w) => w.id === copyFromId || w.id === condSiblingId(copyFromId))
      : [];
    return source.length ? workoutsToDayBuilder(source) : undefined;
  });

  function persist(value: DayBuilderValue, message: string) {
    const baseName = existing.find((w) => w.kind !== 'conditioning')?.name
      ?? (date ? `Session · ${date}` : 'Session');
    const next = dayBuilderToWorkouts(value, { id: workoutId, date, name: baseName });
    const nextIds = new Set(next.map((w) => w.id));
    const ours = new Set([workoutId, condSiblingId(workoutId)]);
    update((d) => {
      /*
       * Drop OUR siblings that this save no longer produces — delete every
       * conditioning block from a day and its conditioning workout must go,
       * not linger on the calendar as a session the coach cannot see.
       * Tombstoned so the deletion survives a cloud merge rather than being
       * resurrected by the copy still on the server.
       */
      const stale = d.workouts.filter((w) => ours.has(w.id) && !nextIds.has(w.id));
      if (stale.length) {
        d.settings.deletedIds = { ...(d.settings.deletedIds || {}) };
        for (const w of stale) d.settings.deletedIds[w.id] = Date.now();
      }
      const kept = d.workouts.filter((w) => !ours.has(w.id));
      const merged = next.map((w) => {
        const prior = d.workouts.find((x) => x.id === w.id);
        return prior ? { ...prior, ...w } : w;
      });
      d.workouts = [...kept, ...merged];
    });
    setNotice(message);
  }

  return (
    <View className="flex-1 bg-bg">
      {!!notice && (
        /* The web's role="status"; 'alert' is the closest RN accessibility
           role, and the point survives: a screen reader announces the save. */
        <T accessibilityRole="alert" className="px-2 pt-2 text-4 text-gold2">
          {notice}
        </T>
      )}
      <DayBuilder
        mode={mode}
        date={date}
        published={false}
        entries={entries}
        initialValue={initialValue}
        onPublish={(value) =>
          persist(
            value,
            /* The honesty rule, verbatim in meaning from the web: say exactly
               what happened and what did NOT. Publish has not sent anything to
               a roster athlete, so it must not read as if it had. */
            `Saved and scheduled for ${date}. Sending it to a roster athlete is a separate step and has not happened.`,
          )
        }
        onSave={(value) => persist(value, 'Saved to your library.')}
        onBack={() => nav.goBack()}
      />
    </View>
  );
}
