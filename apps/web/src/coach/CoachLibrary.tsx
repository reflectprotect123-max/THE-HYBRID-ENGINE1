import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCoachWorkspace } from './CoachWorkspaceContext';
import { useDb } from '../store/db';
import type { AthleteWeekSummary } from './contracts';
import { CalendarMonth, type CalendarDay } from './library/CalendarMonth';

function mondayOf(d: Date): string {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  copy.setDate(copy.getDate() - ((copy.getDay() + 6) % 7));
  return copy.toISOString().slice(0, 10);
}

/**
 * The Library is the month calendar and the day builder behind it.
 *
 * It used to open on a "Programs" tab: a template list beside a "Prepare an
 * assignment" configurator (training system / experience / sessions-per-week /
 * assign-to / preferred start / preferred weekdays) whose button wrote an
 * assignment draft through `repository.saveAssignmentDraft`. The owner deleted
 * that whole surface on 11 August 2026.
 *
 * Two consequences worth stating rather than discovering later:
 *
 *  - `saveAssignmentDraft` was the app's ONLY program-assignment path. It was
 *    named as such before the deletion and deleted anyway; assigning a program
 *    template to a client is not something this app can do today. The
 *    repository method survives untouched, so re-homing it is a UI job, not a
 *    backend one.
 *  - The configurator carried the Library's only client picker, and the month
 *    calendar needs a client to read. The picker moves into the header here
 *    rather than vanishing with the tab — the calendar would otherwise be
 *    pinned to whichever client the workspace defaulted to.
 */
export function CoachLibrary() {
  const { clients, selectedClient, selectClient, repository } = useCoachWorkspace();

  return (
    <main className="min-h-screen bg-bg text-text">
      <header className="border-b border-line2 px-3 py-3 sm:px-4">
        <p className="text-[10px] uppercase tracking-[.18em] text-gold">ARC · library</p>
        <h1 className="mt-0.5 text-xl font-semibold sm:text-2xl">Build once. Coach the individual.</h1>
        <p className="mt-1 max-w-[68ch] text-xs text-muted">Open a day to build or edit its session. Preferred days are inputs; the Coordinator still resolves the week.</p>
        {/*
          The Programs tab carried the only two links to `/coach/author`, and
          `/coach/author` is the only door to `/coach/build/:id`,
          `/coach/planner/:id` and `/coach/roster-plan/:workoutId`. Deleting
          the tab orphaned all four — caught by coach-routes.test.tsx's graph
          walk, not by eye. One link keeps the whole session-builder chain
          reachable; the assignment configurator stays deleted.
        */}
        <Link to="/coach/author" className="mt-3 inline-block rounded-md border border-gold-line bg-gold-wash px-2 py-1.5 text-xs font-semibold text-gold2">
          Open the session builder
        </Link>
        <label className="mt-3 block max-w-xs text-xs">
          <span className="mb-1 block font-medium">Athlete</span>
          <select
            value={selectedClient?.id ?? ''}
            onChange={(event) => selectClient(event.target.value)}
            className="w-full rounded-md border border-line2 bg-well px-2 py-2 text-sm text-text"
          >
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}{client.source === 'synthetic-fixture' ? ' · fixture' : client.source === 'roster-summary' ? ' · summary only' : ''}
              </option>
            ))}
          </select>
        </label>
      </header>

      <CalendarTab clientId={selectedClient?.id ?? null} repository={repository} />
    </main>
  );
}

function CalendarTab({ clientId, repository }: { clientId: string | null; repository: ReturnType<typeof useCoachWorkspace>['repository'] }) {
  const navigate = useNavigate();
  const { db } = useDb();
  const localWorkouts = db.workouts;
  const now = new Date();
  const [view, setView] = useState({ year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 });

  const weekStarts = useMemo(() => {
    const last = new Date(Date.UTC(view.year, view.month, 0));
    const starts: string[] = [];
    const cursor = new Date(Date.UTC(view.year, view.month - 1, 1));
    cursor.setUTCDate(cursor.getUTCDate() - ((cursor.getUTCDay() + 6) % 7));
    while (cursor <= last) {
      starts.push(mondayOf(cursor));
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    }
    return starts;
  }, [view]);

  const [sessionsByDate, setSessionsByDate] = useState<Map<string, AthleteWeekSummary['sessions']> | undefined>(undefined);

  useEffect(() => {
    if (!clientId) return;
    let active = true;
    setSessionsByDate(undefined);
    Promise.all(weekStarts.map((weekStart) =>
      (repository.getAthleteWeekSummary?.(clientId, weekStart) ?? Promise.resolve(null)).catch(() => null),
    )).then((summaries) => {
      if (!active) return;
      const merged = new Map<string, AthleteWeekSummary['sessions']>();
      for (const summary of summaries) {
        for (const session of summary?.sessions ?? []) {
          const existing = merged.get(session.date) ?? [];
          if (existing.some((item) => item.id === session.id)) continue;
          merged.set(session.date, [...existing, session]);
        }
      }
      setSessionsByDate(merged);
    });
    return () => { active = false; };
  }, [repository, clientId, weekStarts]);

  /*
   * One CalendarDay per date that actually has sessions. A day with nothing on
   * it is simply absent, and CalendarMonth renders it as an empty day offering
   * Create session / Add from library — the mockup's own two actions.
   */
  const days: CalendarDay[] = useMemo(() => {
    const out: CalendarDay[] = Array.from(sessionsByDate?.entries() ?? []).map(([date, sessions]) => ({
      date,
      // `name` is nullable in AthleteWeekSummary; an unnamed session is still a
      // real session, so it is labelled rather than dropped.
      title: sessions[0]?.name || 'Session',
      // Published is read from the session's own status, never assumed. Saying
      // a day is published when it is not is the kind of claim this workspace
      // is careful never to make.
      published: sessions.every((x) => x.status === 'published'),
      items: sessions.length,
    }));

    /*
     * Sessions the coach built HERE, in the day builder, which writes an
     * engine `Workout` into the local store (see day-workout.ts). Without
     * this the loop does not close: a coach saves a session, returns to the
     * calendar, and the day they just filled looks empty — which reads as the
     * save having failed.
     *
     * They are marked unpublished, because they are: writing a session to the
     * coach's own calendar is not the same as sending it to an athlete, and
     * `DayBuilderRoute` is careful to say so at the moment of saving. This
     * must not quietly contradict it one screen later.
     */
    const seen = new Set(out.map((d) => d.date));
    for (const workout of localWorkouts) {
      for (const date of workout.dates ?? []) {
        if (seen.has(date)) continue;
        seen.add(date);
        out.push({ date, title: workout.name || 'Session', published: false, items: 1 });
      }
    }
    return out;
  }, [sessionsByDate, localWorkouts]);

  /*
   * The month grid renders with or without a client. With none there are no
   * scheduled sessions to draw, but every day still opens the day builder,
   * which reads the signed-in athlete's own stores and does not need one.
   * Returning a bare sentence here instead — as this did until the Programs
   * tab was deleted and took the client picker's only guaranteed value with
   * it — made the whole Library a dead page for anyone with an empty roster.
   */
  return (
    <div className="p-3 sm:p-4">
      {clientId === null && (
        <p className="mb-2 text-xs text-dim">No athlete selected, so no scheduled sessions are shown. Opening a day still builds one.</p>
      )}
      {clientId !== null && sessionsByDate === undefined && (
        <p className="mb-2 text-xs text-dim" role="status">Loading this month&rsquo;s sessions…</p>
      )}
      <CalendarMonth
        days={days}
        year={view.year}
        month={view.month}
        onMonthChange={(year, month) => setView({ year, month })}
        onCreate={(date) => navigate(`/coach/day/${date}`)}
        // "Add from library" now means it: pick one of the coach's own
        // sessions and open the day seeded with a copy of it.
        onAddFromLibrary={(date) => navigate(`/coach/day/${date}?pick=1`)}
        onOpen={(date) => navigate(`/coach/day/${date}`)}
      />
    </div>
  );
}
