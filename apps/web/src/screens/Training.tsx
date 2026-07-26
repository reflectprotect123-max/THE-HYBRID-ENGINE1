import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  blockExercises,
  condEffort,
  condEffortRpe,
  detectPRs,
  exFinished,
  freshSessionBlocks,
  isCond,
  rxLine,
  sessionLetters,
  sessionProgress,
  sessionVolume,
  uid,
  ymd,
  type LoggedSet,
  type Session,
  type StrengthBlock,
  type Workout,
} from '@hybrid/engine';
import { useDb } from '../store/db';
import { Button, Card, Empty, Kicker, LetterChip, Meter, ScreenTitle, SectionHead, cx } from '../ui';

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
  const { db, activeSession, sessions, update } = useDb();
  const today = ymd(new Date());
  const dow = new Date().getDay();

  const candidates = useMemo(
    () => db.workouts.filter((w) => (w.dates || []).includes(today) || (w.days || []).includes(dow)),
    [db.workouts, today, dow],
  );

  function startWorkout(w: Workout) {
    const s: Session = {
      id: uid(),
      date: today,
      name: w.name || 'Session',
      status: 'active',
      blocks: freshSessionBlocks(w.blocks),
      startedAt: Date.now(),
      updatedAt: Date.now(),
      workoutId: w.id,
    };
    update((draft) => {
      draft.sessions.push(s);
    });
  }

  function finishSession() {
    if (!activeSession) return;
    update((draft) => {
      const ds = draft.sessions.find((x) => x.id === activeSession.id);
      if (!ds) return false;
      ds.status = 'completed';
      ds.completedAt = Date.now();
      ds.updatedAt = Date.now();
    });
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
                    {w.origin === 'coach' ? ' · from your coach' : ''}
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
            <div className="mb-1 flex items-baseline gap-1">
              <h2 className="text-5 font-[750] [overflow-wrap:anywhere]">{b.heading || 'Block'}</h2>
              {!isCond(b) && b.superset ? (
                <span className="text-2 font-[750] uppercase tracking-[.14em] text-gold2">superset</span>
              ) : null}
            </div>

            {isCond(b) ? (
              <Card className={cx(b.condResult && 'border-done-line bg-done-bg')}>
                <div className="flex items-center gap-1">
                  <LetterChip letter="♥" />
                  <span className="flex-1 text-5 font-[750]">{b.condFmt}</span>
                  {b.condResult ? <span className="text-3 text-done-ink">logged</span> : null}
                </div>
                <p className="mt-0.5 text-3 text-dim">
                  {condEffort(b).name} · RPE {condEffortRpe(condEffort(b))} · {condEffort(b).cue}
                </p>
                {!b.condResult ? (
                  <Button
                    className="mt-1.5 w-full"
                    // The block travels with the navigation: without it the run
                    // finishes into the standalone history and this block never
                    // reads as done.
                    onClick={() => nav(`/conditioning?block=${encodeURIComponent(b.id || '')}&bi=${bi}`)}
                  >
                    Start conditioning
                  </Button>
                ) : null}
              </Card>
            ) : (
              <ul className="flex flex-col gap-1">
                {blockExercises(b as StrengthBlock<LoggedSet>).map((ex, ei) => {
                  const done = exFinished(ex);
                  const logged = ex.sets.filter((st) => st.done).length;
                  return (
                    <li key={ex.id ?? ei}>
                      <button
                        onClick={() => nav(`/log/${bi}/${ei}`)}
                        className={cx(
                          'w-full rounded-lg border p-2 text-left transition-colors duration-150',
                          done
                            ? 'border-done-line bg-done-bg'
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

      <Button variant="brass" size="lg" className="mt-3 w-full" onClick={finishSession}>
        Finish session
      </Button>
    </>
  );
}
