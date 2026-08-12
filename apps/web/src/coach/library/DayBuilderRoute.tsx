import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { buildCatalogue } from '@hybrid/engine';
import type { Workout } from '@hybrid/engine';
import { useDb } from '../../store/db';
import { DayBuilder, type DayBuilderValue } from './DayBuilder';
import { dayBuilderToWorkout, workoutToDayBuilder } from './day-workout';

/**
 * The day builder's route wrapper: it supplies the real catalogue, loads any
 * session already stored for this day, and writes edits back.
 *
 * `/coach/day/:date` is the dated mode, reached from the Calendar.
 * `/coach/day` with no date is library mode, where the guided wizard finishes.
 *
 * SAVING IS REAL AS OF 12 AUGUST 2026. Stage 3a shipped both buttons as
 * stubs that said "not connected yet" — honest, but it meant everything a
 * coach typed here was thrown away on navigation, which is why this screen had
 * never been usable. A session is now an engine `Workout` in the athlete's own
 * `EngineDB.workouts`, the same store the Planner, the Library catalogue and
 * the logger already read. See `day-workout.ts` for the translation.
 *
 * WHAT PUBLISH STILL DOES NOT DO. Sending a session to a ROSTER athlete goes
 * through `repository.publishWorkoutDraft`, which needs a client and an
 * existing draft with its base version — neither of which this route has.
 * Publish therefore saves and schedules the session on the coach's own
 * calendar and says exactly that. It does not claim to have sent anything to
 * anyone, because it has not.
 */
export function DayBuilderRoute({ mode }: { mode: 'dated' | 'library' }) {
  const { date } = useParams<{ date: string }>();
  const { db, update } = useDb();
  const navigate = useNavigate();
  const [notice, setNotice] = useState('');

  const entries = useMemo(() => {
    const tags = (db.settings as { movementTags?: Record<string, string[]> }).movementTags;
    return buildCatalogue(db.workouts, db.sessions, tags);
  }, [db.workouts, db.sessions, db.settings]);

  /*
   * The day's existing session, if any. Resolved ONCE — `useState`'s
   * initialiser, not `useMemo` — because this seeds an editor: recomputing it
   * after the coach's own save would hand the editor back its saved self
   * mid-edit. A day holds one session (the builder's "+ Add new session" is
   * deliberately disabled), so the first match is the match.
   */
  const [existing] = useState<Workout | undefined>(() =>
    date ? db.workouts.find((w) => w.dates?.includes(date)) : undefined,
  );
  const [workoutId] = useState(() => existing?.id ?? `coach-day-${date ?? 'library'}-${Date.now()}`);
  const [initialValue] = useState<DayBuilderValue | undefined>(() =>
    existing ? workoutToDayBuilder(existing) : undefined,
  );

  function persist(value: DayBuilderValue, message: string) {
    const next = dayBuilderToWorkout(value, {
      id: workoutId,
      date,
      name: existing?.name ?? (date ? `Session · ${date}` : 'Session'),
    });
    update((d) => {
      const at = d.workouts.findIndex((w) => w.id === workoutId);
      if (at === -1) d.workouts = [...d.workouts, next];
      else d.workouts = d.workouts.map((w) => (w.id === workoutId ? { ...w, ...next } : w));
    });
    setNotice(message);
  }

  function handlePublish(value: DayBuilderValue) {
    persist(
      value,
      `Saved and scheduled for ${date}. Sending it to a roster athlete is a separate step and has not happened.`,
    );
  }

  function handleSave(value: DayBuilderValue) {
    persist(value, 'Saved to your library.');
  }

  return (
    <>
      {notice && (
        <p className="cb-note" role="status">
          {notice}
        </p>
      )}
      <DayBuilder
        mode={mode}
        date={date}
        published={false}
        entries={entries}
        initialValue={initialValue}
        onPublish={handlePublish}
        onSave={handleSave}
        onBack={() => navigate('/coach/library')}
      />
    </>
  );
}
