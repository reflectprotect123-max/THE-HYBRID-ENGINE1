import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  agoLabel,
  blockExercises,
  isCond,
  isCondWorkout,
  newBlock,
  rxLine,
  sessionOpeners,
  uid,
  workoutStats,
  type LoggedSet,
  type StrengthBlock,
  type Workout,
} from '@hybrid/engine';
import { useDb } from '../store/db';
import { Button, Card, Chip, Empty, Kicker, ScreenTitle, SectionHead } from '../ui';

/*
 * Two letters, in a fixed seven-column grid.
 *
 * Three-letter chips in a wrapping flex row do not fit a phone: SAT dropped to
 * a line of its own, so a week rendered as 6 + 1 and every session card carried
 * an extra row of height to say nothing. It reads as a layout bug rather than
 * as a week. A grid cannot wrap, so the row survives whatever the label width
 * and the coarse-pointer 44px rule do to the chips.
 *
 * Two letters rather than one because Sunday and Saturday are both S, and
 * unlike the Home week strip there is no date underneath to disambiguate them.
 */
const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/*
 * The Library is everything you can train: sessions you have written, and
 * sessions your coach has assigned. Coach-assigned work is read-only here —
 * editing it locally would silently diverge from what the coach still believes
 * you were given.
 */
export function Library() {
  const nav = useNavigate();
  const { db, update } = useDb();
  const [open, setOpen] = useState<string | null>(null);

  const mine = db.workouts.filter((w) => w.origin !== 'coach');
  const fromCoach = db.workouts.filter((w) => w.origin === 'coach');

  function addWorkout() {
    const w: Workout = { id: uid(), name: 'New session', blocks: [newBlock()], updatedAt: Date.now() };
    update((draft) => {
      draft.workouts.push(w);
    });
    nav(`/planner/${w.id}`);
  }

  function toggleDay(id: string, d: number) {
    update((draft) => {
      const w = draft.workouts.find((x) => x.id === id);
      if (!w) return false;
      const days = new Set(w.days || []);
      if (days.has(d)) days.delete(d);
      else days.add(d);
      w.days = Array.from(days).sort((a, b) => a - b);
      w.updatedAt = Date.now();
    });
  }

  function removeWorkout(id: string) {
    update((draft) => {
      draft.workouts = draft.workouts.filter((x) => x.id !== id);
      // A tombstone, not just a local delete: without one the next sync sees a
      // workout the remote still has and cheerfully restores it.
      draft.settings.deletedIds = { ...(draft.settings.deletedIds || {}), [id]: Date.now() };
    });
  }

  return (
    <>
      <Kicker>Library</Kicker>
      <ScreenTitle>Your sessions</ScreenTitle>

      <Button variant="brass" className="mt-2 w-full" onClick={addWorkout}>
        + New session
      </Button>

      <SectionHead title="Yours" />
      {mine.length ? (
        <ul className="flex flex-col gap-1">
          {mine.map((w) => (
            <li key={w.id}>
              <Card>
                <button
                  className="flex w-full items-center gap-1 text-left"
                  onClick={() => setOpen(open === w.id ? null : w.id)}
                  aria-expanded={open === w.id}
                >
                  <span className="min-w-0 flex-1 truncate text-5 font-[750]">{w.name || 'Session'}</span>
                  <span className="text-3 text-dim">
                    {isCondWorkout(w) || !w.blocks.length
                      ? 'conditioning'
                      : `${w.blocks.length} ${w.blocks.length === 1 ? 'block' : 'blocks'}`}
                  </span>
                </button>

                <Signal w={w} />

                <div className="mt-1 grid grid-cols-7 gap-0.5">
                  {DAYS.map((d, i) => (
                    <Chip
                      key={d}
                      on={(w.days || []).includes(i)}
                      onClick={() => toggleDay(w.id, i)}
                      // The visible label is an abbreviation; a screen reader
                      // gets the day and whether it is on.
                      aria-label={`${DAY_NAMES[i]} — ${(w.days || []).includes(i) ? 'scheduled' : 'not scheduled'}`}
                      className="min-w-0 px-0"
                    >
                      {d}
                    </Chip>
                  ))}
                </div>

                {open === w.id ? (
                  <>
                    <WorkoutDetail w={w} />
                    <div className="mt-1.5 flex gap-1">
                      <Button size="sm" variant="brass" onClick={() => nav(`/planner/${w.id}`)}>
                        Edit
                      </Button>
                      <Button size="sm" onClick={() => removeWorkout(w.id)}>
                        Delete session
                      </Button>
                    </div>
                  </>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <Empty title="Nothing here yet" body="Use “＋ New session” above to build your first one." />
      )}

      {fromCoach.length ? (
        <>
          <SectionHead title="From your coach" />
          <ul className="flex flex-col gap-1">
            {fromCoach.map((w) => (
              <li key={w.id}>
                <Card className="border-gold-line">
                  <div className="flex items-center gap-1">
                    <span className="min-w-0 flex-1 truncate text-5 font-[750]">{w.name || 'Session'}</span>
                    <span className="text-2 font-[750] uppercase tracking-[.14em] text-gold2">assigned</span>
                  </div>
                  {(w.dates || []).length ? (
                    <p className="num mt-0.5 text-3 text-dim">for {(w.dates || []).join(', ')}</p>
                  ) : null}
                  <WorkoutDetail w={w} />
                  <Button size="sm" className="mt-1.5" onClick={() => nav(`/planner/${w.id}`)}>
                    View
                  </Button>
                </Card>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}

/*
 * What this session actually means to you, on the card.
 *
 * The Library is the screen you open to DECIDE what to train, and until now it
 * answered with a name and a block count. These two lines are the two things
 * that bear on the decision: when you last did it, and what you would be
 * lifting if you started it now.
 *
 * Both are suppressed when empty rather than rendered blank — a session you
 * have never trained should say nothing, not "last trained never · opens at".
 */
function Signal({ w }: { w: Workout }) {
  const { db, whoop } = useDb();
  const stats = useMemo(() => workoutStats(w, db.sessions), [w, db.sessions]);
  // Through sessionOpeners, so this figure and the one the logger prefills come
  // from the same function — including the red-morning easing.
  const opens = useMemo(() => sessionOpeners(w, db.settings, whoop), [w, db.settings, whoop]);

  if (!stats.count && !opens.length) return null;

  return (
    <div className="mt-0.5">
      {stats.count ? (
        <p className="num text-3 text-dim">
          {agoLabel(stats.lastDate)} · {stats.count} {stats.count === 1 ? 'time' : 'times'}
        </p>
      ) : null}
      {opens.length ? (
        <p className="num truncate text-3 text-muted">
          opens at {opens.map((o) => `${o.name} ${o.kg}`).join(' · ')}
          {opens.some((o) => o.eased) ? ' (eased today)' : ''}
        </p>
      ) : null}
    </div>
  );
}

function WorkoutDetail({ w }: { w: Workout }) {
  return (
    <div className="mt-1.5 flex flex-col gap-1.5 border-t border-line pt-1.5">
      {w.blocks.map((b, bi) => (
        <div key={b.id ?? bi}>
          <div className="text-3 font-[750] uppercase tracking-[.12em] text-dim">{b.heading || 'Block'}</div>
          {isCond(b) ? (
            <p className="mt-0.5 text-4 text-muted">
              {b.condFmt} · {b.effort || b.targetZone}
            </p>
          ) : (
            <ul className="mt-0.5 flex flex-col gap-0.5">
              {blockExercises(b as StrengthBlock<LoggedSet>).map((ex, ei) => (
                <li key={ex.id ?? ei} className="text-4">
                  <span className="font-[650]">{ex.name || 'Exercise'}</span>
                  <span className="num ml-1 text-dim">{rxLine(ex)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
