import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CON_FORMATS,
  blockExercises,
  condEffort,
  condEffortRpe,
  detectPRs,
  exFinished,
  ensureSharedCore,
  isCond,
  isText,
  rxLine,
  sessionLetters,
  sessionProgress,
  sessionVolume,
  ymd,
  type LoggedSet,
  type Session,
  type StrengthBlock,
  type TextBlock,
  type Workout,
} from '@hybrid/engine';
import { appendSharedCoreEvent } from '@hybrid/shared-core';
import { sessionFrom } from '../lib/session';
import { useDb } from '../store/db';
import { Button, Card, Empty, Kicker, LetterChip, Meter, ScreenTitle, SectionHead, cx } from '../ui';
import { strengthProgressionProposals, type StrengthProgressionProposal } from '../coach/progression';
import { recordProgressionProposals } from '../coach/progression-store';

/*
 * Training is the session list: what today's work is, block by block, with each
 * exercise a door into the full-screen logger.
 *
 * It deliberately does NOT create a session on render. Doing that meant simply
 * looking at this screen minted a phantom active session that then had to be
 * expired, showed up in History, and competed in the sync merge.
 */
export function Training() {
  const nav = useNavigate();
  const { db, activeSession, sessions, update, athleteState } = useDb();
  const today = ymd(new Date());
  const dow = new Date().getDay();

  const candidates = useMemo(
    () => db.workouts.filter((w) => (w.dates || []).includes(today) || (w.days || []).includes(dow)),
    [db.workouts, today, dow],
  );

  function startWorkout(w: Workout) {
    update((draft) => {
      // Guard INSIDE the write, mirroring Home's onStart — the render-scope
      // activeSession is stale for a second Start in the same frame, and two
      // workouts scheduled today render two Start buttons side by side, so
      // this needs no double-tap. Two active sessions is a merge conflict,
      // and the second would be invisible/unfinishable (activeSession picks
      // the first active it finds).
      if (draft.sessions.some((x) => x.status === 'active')) return false;
      draft.sessions.push(sessionFrom(w, today));
    });
  }

  function finishSession() {
    if (!activeSession) return;
    let proposals: StrengthProgressionProposal[] = [];
    // Finishing cannot be undone — nothing reopens a completed session — and
    // this is a full-width button at the bottom of a list you thumb through
    // mid-workout. Only ask when there is actually work left to lose.
    const { done, total } = sessionProgress(activeSession);
    const left = total - done;
    if (
      left > 0 &&
      !window.confirm(`Finish with work left? ${left} set${left === 1 ? '' : 's'} still unlogged. Finishing cannot be undone.`)
    ) {
      return;
    }
    update((draft) => {
      const ds = draft.sessions.find((x) => x.id === activeSession.id);
      if (!ds) return false;
      const completedAt = Date.now();
      ds.status = 'completed';
      ds.completedAt = completedAt;
      ds.updatedAt = completedAt;
      /* Completed work remains immutable evidence. The resulting change is a
         separate proposal; only coach review can alter a prescription. */
      proposals = strengthProgressionProposals(
        ds,
        draft.settings,
        athleteState.constraints.filter((constraint) => constraint.hard).map((constraint) => constraint.reason),
      );
      const core = ensureSharedCore(draft, completedAt).core!;
      draft.core = appendSharedCoreEvent(core, {
        type: 'workout_completed',
        occurredAt: new Date(completedAt).toISOString(),
        sourceDomain: ds.kind || 'strength',
        idempotencyKey: `session:${ds.id}:completed`,
        payload: { sessionId: ds.id, domain: ds.kind || 'strength' },
      });
    });
    recordProgressionProposals(proposals);
    // Straight to the recap: the moment after finishing is the only time
    // anyone actually reads what they just did.
    nav(`/recap/${activeSession.id}`);
  }

  if (!activeSession) {
    return (
      <>
        <Kicker>Training</Kicker>
        <ScreenTitle>Start a session</ScreenTitle>
        <div className="mt-2 flex flex-col gap-1">
          {candidates.length ? (
            candidates.map((w) => (
              <Card key={w.id} className="flex items-center gap-1">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-5 font-[750]">{w.name || 'Session'}</p>
                  <p className="text-3 text-dim">
                    {w.blocks.length} {w.blocks.length === 1 ? 'block' : 'blocks'}
                  </p>
                </div>
                <Button variant="brass" onClick={() => startWorkout(w)}>
                  Start
                </Button>
              </Card>
            ))
          ) : (
            <Empty
              title="Nothing scheduled for today"
              body="Anything in your Library can be started now — scheduling is a convenience, not a gate."
              action={
                <Button variant="brass" onClick={() => nav('/library')}>
                  Open Library
                </Button>
              }
            />
          )}
        </div>

        {db.workouts.length && !candidates.length ? (
          <>
            <SectionHead title="Everything else" />
            <div className="flex flex-col gap-1">
              {db.workouts.map((w) => (
                <Card key={w.id} className="flex items-center gap-1">
                  <span className="min-w-0 flex-1 truncate text-5 font-[750]">{w.name || 'Session'}</span>
                  <Button onClick={() => startWorkout(w)}>Start</Button>
                </Card>
              ))}
            </div>
          </>
        ) : null}
      </>
    );
  }

  const s = activeSession;
  const letters = sessionLetters(s);
  const prog = sessionProgress(s);
  const prs = detectPRs(s, sessions.filter((x) => x.id !== s.id));
  /* Deliberately not a useMemo: the no-session branch returns above this line,
     so a hook here would run on one render path and not the other. It is a
     walk over a handful of exercises — the memo would cost more than it saves. */
  const current = firstUnfinished(s);
  const allDone = prog.total > 0 && prog.done >= prog.total;

  return (
    <>
      <Kicker>In progress</Kicker>
      <ScreenTitle>{s.name || 'Session'}</ScreenTitle>

      <div className="mt-2">
        <Meter pct={prog.pct} />
        <div className="num mt-0.5 flex justify-between text-2 font-[650] text-dim">
          <span>
            {prog.done} of {prog.total} done
          </span>
          <span>{sessionVolume(s).toLocaleString()} kg</span>
        </div>
      </div>

      <div className="mt-2 flex flex-col gap-2">
        {s.blocks.map((b, bi) => (
          <section key={b.id ?? bi}>
            {/* Block heading as the logger-section micro-label (04-athlete-04):
                the exercise names are the loud line, not the block above them. */}
            <div className="mb-1 flex items-baseline gap-1">
              <h2 className="text-2 font-[750] uppercase tracking-[.18em] text-dim [overflow-wrap:anywhere]">
                {b.heading || 'Block'}
              </h2>
              {!isCond(b) && !isText(b) && b.superset ? (
                <span className="rounded-pill border border-gold-line bg-gold-wash px-0.5 text-1 font-[750] uppercase tracking-[.1em] text-gold2">
                  superset
                </span>
              ) : null}
            </div>

            {isText(b) ? (
              /* A metcon reads as written. The only state it has is whether you
                 did it, so the whole card is the tick. */
              <Card className={cx(b.done && 'border-done-line bg-done-bg')}>
                <button
                  onClick={() =>
                    update((d) => {
                      const ds = d.sessions.find((x) => x.id === s.id);
                      const t = ds && (ds.blocks[bi] as TextBlock);
                      if (!ds || !t) return false;
                      t.done = !t.done;
                      ds.updatedAt = Date.now();
                    })
                  }
                  role="switch"
                  aria-checked={!!b.done}
                  className="flex w-full items-start gap-1 text-left"
                >
                  <LetterChip letter={b.done ? '✓' : '✎'} />
                  <span className="min-w-0 flex-1 whitespace-pre-wrap text-4 text-text">
                    {b.body?.trim() || 'Nothing written for this one yet.'}
                  </span>
                </button>
                <p className="mt-1 text-2 text-dim">{b.done ? 'Done' : 'Tap when it is done'}</p>
              </Card>
            ) : isCond(b) ? (
              <Card className={cx(b.condResult && 'border-done-line bg-done-bg')}>
                {b.condResult ? (
                  // A logged effort stays reachable — the whole card reopens
                  // the recap, mirroring mobile's "tap to review" rather than
                  // dead-ending once the block is done.
                  <button
                    onClick={() => nav(`/recap/${s.id}`)}
                    className="flex w-full flex-col items-start text-left"
                  >
                    <div className="flex w-full items-center gap-1">
                      <LetterChip letter="♥" />
                      <span className="flex-1 text-5 font-[750]">{CON_FORMATS[b.condFmt]?.name ?? b.condFmt}</span>
                      <span className="text-3 text-done-ink">logged</span>
                    </div>
                    <p className="mt-0.5 text-3 text-dim">
                      {condEffort(b).name} · RPE {condEffortRpe(condEffort(b))} · {condEffort(b).cue} · tap to review
                    </p>
                  </button>
                ) : (
                  <>
                    <div className="flex items-center gap-1">
                      <LetterChip letter="♥" />
                      <span className="flex-1 text-5 font-[750]">{CON_FORMATS[b.condFmt]?.name ?? b.condFmt}</span>
                    </div>
                    <p className="mt-0.5 text-3 text-dim">
                      {condEffort(b).name} · RPE {condEffortRpe(condEffort(b))} · {condEffort(b).cue}
                    </p>
                    <Button
                      className="mt-1.5 w-full"
                      // The block travels with the navigation: without it the
                      // run finishes into the standalone history and this
                      // block never reads as done.
                      onClick={() => nav(`/conditioning?block=${encodeURIComponent(b.id || '')}&bi=${bi}`)}
                    >
                      Start conditioning
                    </Button>
                  </>
                )}
              </Card>
            ) : (
              <ul className="flex flex-col gap-1">
                {blockExercises(b as StrengthBlock<LoggedSet>).map((ex, ei) => {
                  const done = exFinished(ex);
                  const logged = ex.sets.filter((st) => st.done).length;
                  const isCurrent = current === `${bi}:${ei}`;
                  return (
                    <li key={ex.id ?? ei}>
                      <button
                        onClick={() => nav(`/log/${bi}/${ei}`)}
                        // Announced as well as drawn — the card that leads is
                        // the answer to "where am I", and a screen reader
                        // cannot see a shadow.
                        aria-current={isCurrent ? 'step' : undefined}
                        className={cx(
                          'w-full rounded-lg border p-2 text-left transition-colors duration-150',
                          done
                            ? 'border-done-line bg-done-bg'
                            : isCurrent
                              ? // The one you are on. Every card carried the
                                // same weight, so finding your place meant
                                // reading seven set counters.
                                'border-gold-line bg-panel shadow-lift'
                              : 'border-line bg-panel shadow-card hover:border-gold-line',
                        )}
                      >
                        <div className="flex items-center gap-1">
                          <LetterChip letter={letters[bi]?.[ei] ?? '?'} />
                          <span className="min-w-0 flex-1 truncate text-5 font-[750]">
                            {ex.name || 'Exercise'}
                          </span>
                          <span className="num text-3 text-dim">
                            {logged}/{ex.sets.length}
                          </span>
                        </div>
                        <p className="num mt-0.5 text-3 text-muted">{rxLine(ex)}</p>
                        {ex.cue ? <p className="mt-0.5 text-3 text-gold2">{ex.cue}</p> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ))}
      </div>

      {prs.length ? (
        <Card className="mt-2 border-gold-line bg-gold-wash">
          <Kicker>Personal records</Kicker>
          <ul className="num mt-0.5 flex flex-col gap-0.5 text-4 text-gold2">
            {prs.map((p) => (
              <li key={p.name}>
                {p.name} — {p.kg}kg × {p.reps} (e1RM {Math.round(p.e1)}kg)
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* Brass only once the work is actually done. At 2 of 7 the loudest
          control on the screen was the one action you should not take yet —
          the brass belongs on the exercise you are mid-way through. Finishing
          early stays available, it just stops shouting. */}
      <Button variant={allDone ? 'brass' : 'ghost'} size="lg" className="mt-3 w-full" onClick={finishSession}>
        {allDone ? 'Finish session' : 'Finish session early'}
      </Button>
    </>
  );
}

/** `"bi:ei"` of the first exercise with sets still to log, or null when the
 *  session is done. Conditioning blocks have no set list and are skipped. */
function firstUnfinished(s: Session): string | null {
  for (let bi = 0; bi < s.blocks.length; bi++) {
    const b = s.blocks[bi];
    if (isCond(b)) continue;
    const exs = blockExercises(b as StrengthBlock<LoggedSet>);
    for (let ei = 0; ei < exs.length; ei++) if (!exFinished(exs[ei])) return `${bi}:${ei}`;
  }
  return null;
}
