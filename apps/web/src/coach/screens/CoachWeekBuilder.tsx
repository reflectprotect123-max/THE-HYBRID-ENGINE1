import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useCoachWorkspace } from '../data/CoachWorkspaceContext';
import { coachingTargetOf } from '../data/contracts';
import type { AthleteWeekSummary, ClientSummary, CoachWeekPlan } from '../data/contracts';
import { DayBuilder, type DayBuilderValue } from '../library/DayBuilder';
import { isConditioningCategory } from '../library/day-workout';
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
} from '../data/coach-week';
import '../coach-redesign.css';

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
 * WHAT NO LONGER EXISTS, said here because a screen is where people look for
 * it: the per-session safety layer. This comment used to promise that "a pain
 * or illness flag still holds a coach's session on the day — that is
 * `@hybrid/auto-coach`". That package was deleted on 14 August 2026, and the
 * safety stop went with it, deliberately (see CLAUDE.md, "Who owns the week"
 * and "The auto-coach is deleted"). Nothing holds a session now, and nothing
 * stops one. The flags are still raised — `pain_hold_active` and
 * `illness_flag_active` in `@hybrid/whole-athlete-state` — and nothing
 * consumes them. So this screen reports no holds: nothing writes an
 * `action: 'held'` receipt any more, and a coach seeing a missed session
 * cannot tell injury from indifference, because the system no longer knows
 * either. (`held-pain` / `held-illness` remain in `coach-week.ts`'s day-state
 * vocabulary as states nothing produces.)
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

  const dates = useMemo(() => weekDates(weekStart), [weekStart]);
  const today = new Date().toISOString().slice(0, 10);

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
   * Only an athlete this account actually COACHES has a published week to
   * read. `publish_coach_week` and every projection behind it are keyed on a
   * coach↔athlete relationship; an entry without one is not asked at all,
   * because asking anyway would produce "that athlete is not on your roster"
   * dressed as a load failure, which reads as breakage rather than as the fact
   * it is.
   *
   * That used to be spelled `athlete.source === 'roster-summary'`, and since
   * 14 August 2026 it has a SECOND right answer: the coach themselves, once
   * they have redeemed their own invite. `coachingTargetOf` is the one place
   * that question is asked, and it returns the id the commands are keyed on —
   * which for the folded self entry is NOT `athlete.id`. `athlete.id` is
   * `engine-local` there, a selection key that matches no `athlete_user_id`;
   * sending it would fail every call with "not on your roster" while the
   * relationship really exists.
   */
  const target = coachingTargetOf(athlete);
  const coached = target !== null;
  const targetId = target?.athleteUserId ?? athlete.id;
  /* The coach is looking at their OWN week. Worth saying on the screen: the
     copy below is written in the third person about an athlete's phone, and
     for this entry that phone is theirs. */
  const self = athlete.selfCoaching != null;

  useEffect(() => {
    if (!coached) return;
    let active = true;
    setLoadFailed(false);
    (repository.getCoachWeek?.(targetId, weekStart) ?? Promise.resolve(null))
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
  }, [repository, targetId, weekStart, coached]);

  useEffect(() => {
    if (!coached) return;
    let active = true;
    (repository.getAthleteWeekSummary?.(targetId, weekStart) ?? Promise.resolve(null))
      .then((value) => { if (active) setSummary(value); })
      /* A summary that will not load costs the completion column and nothing
         else. It must not blank the week the coach is building. */
      .catch(() => { if (active) setSummary(null); });
    return () => { active = false; };
  }, [repository, targetId, weekStart, coached]);

  const publishedDays = plan?.body?.days ?? [];

  /* `!loadFailed` is load-bearing and was missing until 14 August 2026. When
     the read fails, `plan` stays null, so the seven editors are empty AND
     `base` computes to 0 — which sends `p_base_version = null`, the value that
     tells `publish_coach_week` to skip the optimistic-lock comparison
     entirely. The one guard that exists to catch "you are publishing over
     something you never saw" was disabled in precisely the state that needs
     it: a coach could press Publish on a failed read and replace a real week
     with seven empty days, and be told "Published. Version 4." The warning
     below said so in words; words are not a guard. */
  const canPublish = coached && Boolean(repository.publishCoachWeek) && !loadFailed;

  async function publish() {
    if (!repository.publishCoachWeek) return;
    setBusy(true);
    setConfirming(false);
    const body = weekBodyFromDays(weekStart, days);
    const base = plan?.version ?? 0;
    try {
      const published = await repository.publishCoachWeek(
        /* The real user id, never `athlete.id` — see `targetId` above. */
        targetId,
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
      setMessage(`Published to ${self ? 'yourself' : athlete.name}. Version ${published.version}.`);
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
        <h1 className="lib-title">{self ? 'Your week' : `${athlete.name}’s week`}</h1>
        {/* One fact either way — who it lands on. Written in the person it is
            true of, so a coach publishing to THEMSELVES is not told about
            "their phone" as if it were somebody else's. This copy used to add
            that a pain or illness flag could still hold a session; the safety
            stop was deleted with `@hybrid/auto-coach` on 14 August 2026, and a
            screen that keeps promising a stop nothing performs is the worst
            available state. */}
        <p className="lib-sub">
          {formatWeekRange(weekStart)}.{' '}
          {self
            ? 'What you publish here becomes your own week on your phone'
            : `What you publish here becomes ${athlete.name}’s week on their phone`}
          {' '}— the Coordinator does not rearrange it.
        </p>
      </div>

      {loadFailed && (
        <p className="st-warning" role="status">
          The published week could not be read, so what you see below is empty rather than
          out of date. Publishing is turned off until it loads — reload the page. Publishing
          from here would replace a real week with an empty one.
        </p>
      )}

      {/* Publishing to YOURSELF is a real publish and is said so — the same
          replacement, into your own record, with the same consequence for the
          Coordinator. It is not a warning and does not wear `.st-warning`:
          nothing is refused here and nothing is degraded. */}
      {self && (
        <div className="rd-panel">
          <p className="rd-panel-note">
            This is your own account. Publishing writes your own weekly plan and takes this week
            off the Coordinator, exactly as it would for anyone else you coach — the week you
            build here is the week your phone shows you.
          </p>
        </div>
      )}

      {!coached && (
        <div className="rd-panel">
          <p className="st-warning">
            {athlete.name} is {athlete.source === 'engine-local' ? 'your own account' : 'a demonstration fixture'},
            not an athlete on your roster.
          </p>
          <p className="rd-panel-note">
            You can build a week here to see the shape of it, and Publish is off: a week is
            published into a real athlete&rsquo;s own record, through a coaching relationship
            the server checks. There is no such relationship for this entry.
            {athlete.source === 'engine-local'
              ? ' You can coach yourself — mint an invite in Settings and redeem it — but nothing here does that for you.'
              : ''}
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
                            {isConditioningCategory(block.category) ? 'conditioning' : 'note'}
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
            {self ? 'You' : athlete.name} will see these seven days — {formatWeekRange(weekStart)} —
            as {self ? 'your' : 'their'} week, replacing whatever {self ? 'your' : 'their'} own
            Coordinator had planned for it.
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
