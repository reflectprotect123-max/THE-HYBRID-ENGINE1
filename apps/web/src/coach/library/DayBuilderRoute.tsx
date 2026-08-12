import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { buildCatalogue } from '@hybrid/engine';
import type { Workout } from '@hybrid/engine';
import { useDb } from '../../store/db';
import { DayBuilder, type DayBuilderValue } from './DayBuilder';
import { condSiblingId, dayBuilderToWorkouts, workoutsToDayBuilder } from './day-workout';
import { SessionPicker } from './SessionPicker';

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
  const { db } = useDb();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();

  /*
   * `?pick=1` is the Calendar's "Add from library" — choose an existing
   * session before the builder opens. `?from=<id>` is what that choice
   * becomes: the builder opens seeded with a COPY of that session. Both live
   * in the URL rather than in component state so the back button behaves and a
   * half-made choice is not stranded.
   */
  if (search.get('pick') === '1') {
    return (
      <SessionPicker
        workouts={db.workouts}
        date={date}
        onPick={(id) => setSearch({ from: id }, { replace: true })}
        onCreateInstead={() => setSearch({}, { replace: true })}
        onBack={() => navigate('/coach/library')}
      />
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
      key={search.get('from') ?? 'blank'}
      mode={mode}
      date={date}
      copyFromId={search.get('from')}
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
  const navigate = useNavigate();
  const [notice, setNotice] = useState('');

  const entries = useMemo(() => {
    const tags = (db.settings as { movementTags?: Record<string, string[]> }).movementTags;
    return buildCatalogue(db.workouts, db.sessions, tags);
  }, [db.workouts, db.sessions, db.settings]);

  /*
   * The day's existing session, if any. Resolved ONCE — a `useState`
   * initialiser, not a `useMemo` — because this seeds an editor: recomputing
   * it after the coach's own save would hand the editor back its saved self
   * mid-edit. A day holds one session (the builder's "+ Add new session" is
   * deliberately disabled), so the first match is the match.
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
        onPublish={(value) =>
          persist(
            value,
            `Saved and scheduled for ${date}. Sending it to a roster athlete is a separate step and has not happened.`,
          )
        }
        onSave={(value) => persist(value, 'Saved to your library.')}
        onBack={() => navigate('/coach/library')}
      />
    </>
  );
}
