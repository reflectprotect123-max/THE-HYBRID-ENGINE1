import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { buildCatalogue } from '@hybrid/engine';
import { useDb } from '../store/db';
import { useCoachWorkspace } from './CoachWorkspaceContext';
import type { AthleteWeekSummary, ClientSummary, CoachWeekPlan } from './contracts';
import { DayBuilder, type DayBuilderValue } from './library/DayBuilder';
import {
  DAY_STATE_IS_GOOD,
  DAY_STATE_LABEL,
  WEEK_DAY_LABELS,
  coachWeekDayState,
  daysFromWeekBody,
  formatWeekRange,
  isMonday,
  publishFailureMessage,
  publishIdempotencyKey,
  weekBodyFromDays,
  weekDates,
} from './coach-week';
import './coach-redesign.css';

/*
 * THE COACH PUBLISHES THE WEEK — step 3 of
 * docs/superpowers/specs/2026-08-13-coach-publishes-the-week-design.md.
 *
 * Seven day columns, each holding zero or more sessions, and one Publish
 * button. What makes it more than a form is what the button does: since the
 * migration of 13 August 2026, `publish_coach_week` writes the athlete's OWN
 * `athlete_weekly_plans` row with `writer = 'coach'` — the only cross-user
 * write in the ecosystem tables, and a change of authority rather than a
 * screen. For a coached athlete the Coordinator no longer arbitrates the week.
 *
 * WHAT IT STILL DOES NOT TOUCH, said here because a screen is where people
 * look for it: the per-session safety layer. A pain or illness flag still
 * holds a coach's session on the day. That is `@hybrid/auto-coach`, a
 * different layer at a different granularity, and taking the WEEK from the
 * Coordinator does not take the SESSION from the safety resolver.
 *
 * NOTHING IS INVENTED. Every editor here is the day builder the Library
 * already ships (`library/DayBuilder`, `library/day-workout`), in a `week`
 * mode that changes the wording and nothing else, so a session authored in a
 * published week and a session authored on the calendar are the same record in
 * the same shape.
 *
 * EVERY CLASS BELOW ALREADY EXISTS in `coach-redesign.css` — the Library's own
 * seven-column strip (`.lib-days` / `.lib-day-col` / `.lib-day-card` /
 * `.lib-ex-list`, which scrolls INSIDE itself at phone width rather than
 * making the page scroll), the settings screen's save row, the session
 * builder's status pill. Nothing is added to that stylesheet.
 *
 * Two traps in that file, both honoured here and both recorded in its history:
 * `.st-panel`'s base rule is `display: none`, so a panel that is meant to be
 * seen carries `.active`; and `.st-save-note` is coloured `--color-ok` and
 * declared AFTER `.st-warning`, so a failure and a success must be SEPARATE
 * elements or the failure ships in green.
 */

/** Rendered under the Publish button. One element per voice — never both
 *  classes on one element. */
function PublishMessage({ text, failed }: { text: string; failed: boolean }) {
  if (!text) return null;
  return failed
    ? <p className="st-warning" role="status">{text}</p>
    : <p className="st-save-note show" role="status">{text}</p>;
}

/** The whole screen, once the athlete and the week are known to be real. */
function WeekBuilder({ athlete, weekStart }: { athlete: ClientSummary; weekStart: string }) {
  const { repository } = useCoachWorkspace();
  const { db } = useDb();

  const dates = useMemo(() => weekDates(weekStart), [weekStart]);
  const today = new Date().toISOString().slice(0, 10);

  /*
   * The exercise catalogue is the SIGNED-IN coach's own library, and that is
   * correct here rather than a leak of the kind ClientDetailGate exists to
   * stop: it supplies exercise NAMES to pick from while authoring. Nothing on
   * this screen reads the athlete's own training from a local store — the
   * athlete's published week and their completions both come from the
   * repository, which is server-side and authorised per athlete.
   */
  const entries = useMemo(() => {
    const tags = (db.settings as { movementTags?: Record<string, string[]> }).movementTags;
    return buildCatalogue(db.workouts, db.sessions, tags);
  }, [db.workouts, db.sessions, db.settings]);

  const [plan, setPlan] = useState<CoachWeekPlan | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [summary, setSummary] = useState<AthleteWeekSummary | null>(null);
  const [days, setDays] = useState<DayBuilderValue[]>(() => daysFromWeekBody(null, weekStart));
  const [editing, setEditing] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);

  /*
   * Only a ROSTER athlete has a published week to read. `publish_coach_week`
   * and every projection behind it are keyed on a coach↔athlete relationship,
   * and the signed-in coach's own `engine-local` entry is not one — asking
   * anyway would produce "that athlete is not on your roster" dressed as a
   * load failure, which reads as breakage rather than as the fact it is.
   */
  const roster = athlete.source === 'roster-summary';

  useEffect(() => {
    if (!roster) return;
    let active = true;
    setLoadFailed(false);
    (repository.getCoachWeek?.(athlete.id, weekStart) ?? Promise.resolve(null))
      .then((value) => {
        if (!active) return;
        setPlan(value);
        /* The editors are seeded from the published week ONCE per (athlete,
           week) — after this the coach's own edits are the truth, and a later
           re-seed would overwrite what they are typing. */
        setDays(daysFromWeekBody(value?.body ?? null, weekStart));
      })
      .catch(() => { if (active) setLoadFailed(true); });
    return () => { active = false; };
  }, [repository, athlete.id, weekStart, roster]);

  useEffect(() => {
    if (!roster) return;
    let active = true;
    (repository.getAthleteWeekSummary?.(athlete.id, weekStart) ?? Promise.resolve(null))
      .then((value) => { if (active) setSummary(value); })
      /* A summary that will not load costs the completion column and nothing
         else. It must not blank the week the coach is building. */
      .catch(() => { if (active) setSummary(null); });
    return () => { active = false; };
  }, [repository, athlete.id, weekStart, roster]);

  const publishedDays = plan?.body?.days ?? [];
  const canPublish = roster && Boolean(repository.publishCoachWeek);

  async function publish() {
    if (!repository.publishCoachWeek) return;
    setBusy(true);
    setConfirming(false);
    const body = weekBodyFromDays(weekStart, days);
    const base = plan?.version ?? 0;
    try {
      const published = await repository.publishCoachWeek(
        athlete.id,
        weekStart,
        body,
        /* Null on a FIRST publish only. After that the version this edit
           started from goes back, so a colleague who published in between
           makes this refuse rather than silently overwrite them. */
        base === 0 ? null : base,
        publishIdempotencyKey(body, base),
      );
      setPlan(published);
      setDays(daysFromWeekBody(published.body, weekStart));
      setFailed(false);
      setMessage(`Published to ${athlete.name}. Version ${published.version}.`);
    } catch (error) {
      setFailed(true);
      setMessage(publishFailureMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (editing !== null) {
    const index = editing;
    return (
      <DayBuilder
        /* Keyed so choosing a different day REMOUNTS the editor: its seed is a
           `useState` initialiser, read once on purpose, so a re-render alone
           would leave yesterday's blocks on screen under today's date. */
        key={`${weekStart}-${index}`}
        mode="week"
        date={dates[index]}
        published={(publishedDays.find((d) => d.date === dates[index])?.sessions.length ?? 0) > 0}
        entries={entries}
        initialValue={days[index]}
        onSave={(value) => {
          setDays((prev) => prev.map((day, i) => (i === index ? value : day)));
          setEditing(null);
          /* A published week that has been edited since is no longer the week
             the athlete is looking at, and the old success line said it was. */
          setMessage('');
        }}
        onBack={() => setEditing(null)}
      />
    );
  }

  return (
    <main className="rd-content">
      <div className="lib-header">
        <p className="lib-eyebrow">ARC · week builder</p>
        <h1 className="lib-title">{athlete.name}&rsquo;s week</h1>
        <p className="lib-sub">
          {formatWeekRange(weekStart)}. What you publish here becomes {athlete.name}&rsquo;s week on
          their phone — the Coordinator does not rearrange it. A pain or illness flag can still
          hold a single session on the day, and you are told when it does.
        </p>
      </div>

      {loadFailed && (
        <p className="st-warning" role="status">
          The published week could not be read, so what you see below is empty rather than
          out of date. Publishing from here would overwrite whatever is actually stored — reload
          before you do.
        </p>
      )}

      {!roster && (
        <div className="rd-panel">
          <p className="st-warning">
            {athlete.name} is {athlete.source === 'engine-local' ? 'your own account' : 'a demonstration fixture'},
            not an athlete on your roster.
          </p>
          <p className="rd-panel-note">
            You can build a week here to see the shape of it, and Publish is off: a week is
            published into a real athlete&rsquo;s own record, through a coaching relationship
            the server checks. There is no such relationship for this entry.
          </p>
        </div>
      )}

      <div className="lib-days">
        {dates.map((date, index) => {
          const draft = days[index] ?? { instructions: '', blocks: [] };
          const publishedSessions = publishedDays.find((d) => d.date === date)?.sessions ?? [];
          const state = coachWeekDayState({
            hasSessions: draft.blocks.length > 0 || publishedSessions.length > 0,
            published: publishedSessions.length > 0,
            sessionStatuses: (summary?.sessions ?? []).filter((s) => s.date === date).map((s) => s.status),
            date,
            today,
            /* STEP 5's SEAM, left open on purpose. Held-session reporting is
               not built — no source here knows a session was held for pain or
               illness — and `coachWeekDayState` renders those states the
               moment one does. Deriving a hold from a missing session instead
               would be a guess printed as a fact. */
            held: null,
          });
          return (
            <div key={date} className={`lib-day-col${draft.blocks.length === 0 ? ' empty' : ''}`}>
              <p className="lib-day-label">
                {WEEK_DAY_LABELS[index]} {date.slice(8)}
              </p>
              <div className="lib-day-card">
                <p className="lib-day-card-title">
                  {draft.blocks.length === 0 ? 'Rest day' : `${draft.blocks.length} block${draft.blocks.length === 1 ? '' : 's'}`}
                </p>
                {draft.blocks.length > 0 && (
                  <ul className="lib-ex-list">
                    {draft.blocks.map((block) => (
                      <li key={block.id}>
                        <span className="ex-badge" aria-hidden>·</span>
                        <p>
                          {block.category}
                          <span className="ex-sets">
                            {block.exercises.length > 0
                              ? `${block.exercises.length} exercise${block.exercises.length === 1 ? '' : 's'}`
                              : 'conditioning'}
                          </span>
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
                {/* Said in WORDS, not by colour alone — the same rule the
                    Command Center's week strip follows.

                    `.cb-status` is `display: inline-flex`, so it does NOT
                    close the line: without a block-level wrapper the Edit
                    button sits beside it and, in a 160px column, on top of it.
                    `.cb-meta` is the wrapper the session builder already puts
                    it in, and `.lib-detail-cta-row` is a flex row, so the
                    button starts a line of its own. */}
                <div className="cb-meta">
                  <span className={`cb-status${DAY_STATE_IS_GOOD[state] ? ' published' : ''}`}>
                    <span className="dot" />
                    {DAY_STATE_LABEL[state]}
                  </span>
                </div>
                <div className="lib-detail-cta-row">
                  <button type="button" className="cb-add-btn ghost" onClick={() => setEditing(index)}>
                    Edit {WEEK_DAY_LABELS[index]}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* `.st-panel`'s base rule is `display: none`; a panel meant to be seen
          carries `.active`. Rendered only while confirming, so there is never
          an inactive one on the page. */}
      {confirming && (
        <section className="st-panel active" aria-labelledby="publish-confirm">
          <h2 className="rd-section-label" id="publish-confirm">Publish this week?</h2>
          <p className="rd-panel-note">
            {athlete.name} will see these seven days — {formatWeekRange(weekStart)} — as their week,
            replacing whatever their own Coordinator had planned for it.
            {plan && plan.version > 0
              ? ` This replaces version ${plan.version}, which they may already have trained from.`
              : ' Nothing has been published for this week before.'}
          </p>
          <div className="lib-detail-cta-row">
            <button type="button" className="lib-cta" disabled={busy} onClick={publish}>
              Yes, publish
            </button>
            <button type="button" className="lib-cta ghost" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </section>
      )}

      <div className="st-save-row">
        <button
          type="button"
          className="cb-add-btn ghost"
          disabled={!canPublish || busy}
          onClick={() => setConfirming(true)}
        >
          Publish the week
        </button>
        <PublishMessage text={message} failed={failed} />
      </div>
    </main>
  );
}

/**
 * The route. Resolves the athlete named in the ADDRESS, not the one selected
 * in the frame, and refuses rather than guessing when the two disagree.
 *
 * That distinction matters: `ClientDetailGate` judges the SELECTED client, so
 * a screen that silently worked on a different athlete than the gate examined
 * would be an authorisation check pointed at the wrong person — the exact
 * "renders one athlete's record under another's name" failure the gate exists
 * to prevent, inverted.
 */
export function CoachWeekBuilder() {
  const { athleteId, weekStart } = useParams<{ athleteId: string; weekStart: string }>();
  const { clients, selectedClient, selectClient, loading } = useCoachWorkspace();

  if (!weekStart || !isMonday(weekStart)) {
    return (
      <main className="rd-content">
        <div className="rd-panel">
          <p className="st-warning">A week has to start on a Monday.</p>
          <p className="rd-panel-note">
            &ldquo;{weekStart}&rdquo; is not one, and the server refuses a week keyed on any other
            day — two weeks starting on arbitrary days would overlap and both claim the same dates.
          </p>
        </div>
      </main>
    );
  }

  if (loading) return <main className="rd-content"><p className="cb-note">Loading the roster…</p></main>;

  const athlete = clients.find((client) => client.id === athleteId);
  if (!athlete) {
    return (
      <main className="rd-content">
        <div className="rd-panel">
          <p className="st-warning">That athlete is not on your roster.</p>
          <p className="rd-panel-note">
            A week can only be built for someone this account actually coaches. If they have just
            redeemed an invite, reload the bench.
          </p>
        </div>
      </main>
    );
  }

  if (selectedClient && selectedClient.id !== athlete.id) {
    return (
      <main className="rd-content">
        <div className="rd-panel">
          <p className="st-warning">
            This week belongs to {athlete.name}, and {selectedClient.name} is selected.
          </p>
          <p className="rd-panel-note">
            Switching keeps the whole bench pointed at one person, so nothing on it can end up
            captioned with the wrong name.
          </p>
          <p className="lib-detail-cta-row">
            <button type="button" className="lib-cta" onClick={() => selectClient(athlete.id)}>
              Switch to {athlete.name}
            </button>
          </p>
        </div>
      </main>
    );
  }

  return <WeekBuilder athlete={athlete} weekStart={weekStart} />;
}
