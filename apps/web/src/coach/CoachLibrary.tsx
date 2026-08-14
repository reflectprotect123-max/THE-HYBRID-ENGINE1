import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCoachWorkspace } from './CoachWorkspaceContext';
import { useDb } from '../store/db';
import type { AthleteWeekSummary, ProgramTemplate } from './contracts';
import { CalendarMonth, type CalendarDay } from './library/CalendarMonth';
import { ProgramsTab } from './ProgramsTab';
import { weekStartOfLocalDate } from './coach-week';


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
 *    named as such before the deletion and deleted anyway. It stayed uncalled
 *    for two days. STAGE 3B (13 August 2026) re-homed it, exactly as this
 *    comment predicted: a UI job, not a backend one — the repository method
 *    was never touched, and `prepareAssignment` below writes the same draft,
 *    in the same state, with the same message it always did. The controls now
 *    live with the program they assign (`ProgramsTab`) rather than in a
 *    sidebar beside it.
 *  - The configurator carried the Library's only client picker, and the month
 *    calendar needs a client to read. The picker moves into the header here
 *    rather than vanishing with the tab — the calendar would otherwise be
 *    pinned to whichever client the workspace defaulted to.
 */
export function CoachLibrary() {
  const { clients, selectedClient, selectClient, repository } = useCoachWorkspace();
  const [tab, setTab] = useState<'programs' | 'calendar'>('calendar');
  const [templates, setTemplates] = useState<readonly ProgramTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesError, setTemplatesError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    repository.listProgramTemplates()
      .then((items) => { if (active) setTemplates(items); })
      .catch(() => { if (active) setTemplatesError('The Library could not be loaded.'); })
      .finally(() => { if (active) setTemplatesLoading(false); });
    return () => { active = false; };
  }, [repository]);

  /*
   * The app's one program-assignment path, restored verbatim.
   *
   * Every part of the draft is what the deleted configurator wrote: the same
   * id shape, `state: 'ready-for-coordinator'`, and the same sentence
   * afterwards. Assignment PROPOSES — preferred days and a preferred start are
   * inputs, and the Coordinator resolves the week. Weakening that message
   * would be the screen quietly claiming an authority it does not have.
   */
  const prepareAssignment = async (template: ProgramTemplate, clientId: string, startDate: string, weekdays: number[]) => {
    const client = clients.find((item) => item.id === clientId);
    if (!client) return;
    try {
      await repository.saveAssignmentDraft({
        id: `assignment:${client.id}:${template.id}`,
        clientId: client.id,
        programTemplateId: template.id,
        preferredStartDate: startDate,
        preferredWeekdays: weekdays,
        baseProgramVersion: `${template.id}:v1`,
        state: 'ready-for-coordinator',
        createdAt: new Date().toISOString(),
      });
      setMessage(`${template.name} is prepared for ${client.name}. Preferred days are inputs; the Coordinator still resolves the week.`);
    } catch {
      setMessage('That assignment could not be saved. Nothing was sent to the athlete.');
    }
  };

  return (
    <main className="min-h-screen bg-bg text-text">
      <header className="border-b border-line2 px-3 py-3 sm:px-4">
        <p className="text-[10px] uppercase tracking-[.18em] text-gold">ARC · library</p>
        <h1 className="mt-0.5 text-xl font-semibold sm:text-2xl">Build once. Coach the individual.</h1>
        <p className="mt-1 max-w-[68ch] text-xs text-muted">Open a day to build or edit its session. Preferred days are inputs; the Coordinator still resolves the week.</p>
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

      <div className="p-3 sm:p-4">
        {/* The Programs/Calendar pair the mockup describes, back after stage
            3a deleted it — `.lib-tabs` has been in the stylesheet since stage
            1 and this is what it is for. Calendar stays the default: it is
            the half a coach opens the Library for day to day. */}
        <div className="lib-tabs" role="tablist" aria-label="Library view">
          <button type="button" role="tab" aria-selected={tab === 'calendar'} className={tab === 'calendar' ? 'active' : undefined} onClick={() => setTab('calendar')}>Calendar</button>
          <button type="button" role="tab" aria-selected={tab === 'programs'} className={tab === 'programs' ? 'active' : undefined} onClick={() => setTab('programs')}>Programs</button>
        </div>
        {message ? <p className="mb-2 text-xs text-good" role="status">{message}</p> : null}
        {tab === 'programs' ? (
          <ProgramsTab
            templates={templates}
            loading={templatesLoading}
            error={templatesError}
            clients={clients}
            onAssign={prepareAssignment}
          />
        ) : null}
      </div>
      {tab === 'calendar' ? <CalendarTab clientId={selectedClient?.id ?? null} repository={repository} /> : null}

      {/*
        The session builder's one inbound link, and it belongs DOWN HERE.

        `/coach/author` is the only door to `/coach/build/:id`,
        `/coach/planner/:id` and `/coach/roster-plan/:workoutId`, so deleting
        this link orphans four routes — caught by coach-routes.test.tsx's
        graph walk, not by eye. That is why it exists.
        It used to sit in the header as a filled brass button, above the
        Library's own content. At phone width that made it the largest, first
        thing on the screen: the Library's primary action was to LEAVE the
        Library. Worse, where it leads is the one coach route still in the
        pre-redesign styling, so the trip read as being dumped in a different,
        older app. Reported from a real phone, 13 August 2026.
        Kept reachable, demoted to what it is — a way out, after the thing you
        came for.
      */}
      {/*
        `inline-flex min-h-11 items-center` is load-bearing, not styling.

        This was a bare inline `<a>`, and `min-height` DOES NOT APPLY to a
        non-replaced inline box — so `coach-redesign.css`'s
        `@media (pointer: coarse) { a { min-height: 44px } }` silently did
        nothing to it and it stayed 14px tall on a phone. `checks/web-touch.mjs`
        caught it the moment that check was repointed at the coach bench.

        WCAG 2.5.8's inline exception does not cover it either: it is not a link
        inside a sentence, it is alone in its own paragraph. And per the comment
        above, it is the Library's ONLY inbound link to `/coach/author` — which
        is the only door to build, planner and roster-plan. A 14px target to
        reach the entire builder chain.

        Introduced 13 August by demoting this from a brass button to a text
        link, which was right for its PROMINENCE and wrong for its HIT AREA.
      */}
      <p className="px-3 pb-6 text-xs sm:px-4">
        <Link
          to="/coach/author"
          className="inline-flex min-h-11 items-center text-muted underline underline-offset-2 hover:text-text"
        >
          Open the session builder
        </Link>
      </p>
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
      starts.push(weekStartOfLocalDate(cursor));
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
