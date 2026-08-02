import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { hasLoggedWork, ymd, type Session, type Workout } from '@hybrid/engine';
import { useDb } from '../store/db';
import { resolveDayTarget } from '../lib/session';
import { Button, Card, Kicker, ScreenTitle, cx } from '../ui';

/*
 * A month at a time: what is planned, and what actually happened.
 *
 * Planned and trained are drawn differently on purpose — a dot you intended is
 * not the same as a dot you earned, and a calendar that conflates them lets you
 * believe you trained more than you did.
 */
export function Calendar() {
  const nav = useNavigate();
  const { db } = useDb();
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const days = useMemo(() => buildMonth(cursor, db.workouts, db.sessions), [cursor, db]);
  const monthName = cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const today = ymd(new Date());

  /* A tapped cell goes to whatever the day actually holds — a completed
     day's Recap, today's Training, or a read-only preview for anything
     else — the same three-way split Home's WeekStrip will use (Task 6). */
  const openDay = (d: Cell) => {
    const target = resolveDayTarget(d.key, today, d.workoutId, d.sessionId);
    if (target.kind === 'recap') nav('/recap/' + target.id);
    else if (target.kind === 'today') nav('/training');
    else nav('/day/' + target.date);
  };

  return (
    <>
      <Kicker>Calendar</Kicker>
      <ScreenTitle>{monthName}</ScreenTitle>

      <div className="mt-2 flex gap-1">
        <Button size="sm" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} aria-label="previous month">
          ‹
        </Button>
        <Button size="sm" onClick={() => setCursor(new Date())} className="flex-1">
          Today
        </Button>
        <Button size="sm" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} aria-label="next month">
          ›
        </Button>
      </div>

      <Card className="mt-2">
        <div className="grid grid-cols-7 gap-0.5">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
            <div key={i} className="pb-0.5 text-center text-1 font-[750] uppercase tracking-widest text-dim">
              {d}
            </div>
          ))}
          {days.map((d, i) =>
            d ? (
              <button
                key={i}
                type="button"
                onClick={() => openDay(d)}
                /* aria-label overrides everything inside the cell, so the dot's
                   `title` no longer reaches a screen reader — the state has to
                   be part of the name itself or the calendar reads as 42
                   identical dates. */
                aria-label={
                  new Date(d.key + 'T00:00:00').toLocaleDateString(undefined, {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                  }) + (d.sessionId ? ', trained' : d.workoutId ? ', planned' : '')
                }
                aria-current={d.key === today ? 'date' : undefined}
                /* `min-h-0` is load-bearing, not decoration. tokens.css gives
                   every <button> a 44px min-height under `pointer: coarse`,
                   which is right for a control a thumb hits and wrong for a
                   cell in a 7-column grid: on a 360px phone the track is
                   ~38.6px, so 44px + `aspect-square` pushes each cell past its
                   column and the month overflows sideways. The utilities layer
                   ships after `base`, so this wins the cascade. The whole grid
                   is the touch target here; a single date is not. */
                className={cx(
                  'aspect-square min-h-0 rounded-sm border p-0.5 text-center transition-colors duration-120',
                  d.key === today ? 'border-gold-line bg-gold-wash' : 'border-line bg-panel2 hover:border-line2',
                )}
              >
                <div className="num text-2 text-muted">{d.n}</div>
                <div className="mt-0.5 flex justify-center gap-0.5">
                  {d.sessionId ? <span className="h-1 w-1 rounded-pill bg-gold2" title="trained" /> : null}
                  {d.workoutId && !d.sessionId ? (
                    <span className="h-1 w-1 rounded-pill border border-gold2" title="planned" />
                  ) : null}
                </div>
              </button>
            ) : (
              <div key={i} />
            ),
          )}
        </div>
        <div className="mt-1.5 flex gap-2 border-t border-line pt-1 text-2 text-dim">
          <span className="flex items-center gap-0.5">
            <span className="h-1 w-1 rounded-pill bg-gold2" /> trained
          </span>
          <span className="flex items-center gap-0.5">
            <span className="h-1 w-1 rounded-pill border border-gold2" /> planned
          </span>
        </div>
      </Card>

      <Button variant="brass" className="mt-2 w-full" onClick={() => nav('/library')}>
        Schedule something
      </Button>
    </>
  );
}

interface Cell {
  key: string;
  n: number;
  workoutId?: string;
  sessionId?: string;
}

function buildMonth(cursor: Date, workouts: Workout[], sessions: Session[]): (Cell | null)[] {
  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  const first = new Date(y, m, 1);
  const total = new Date(y, m + 1, 0).getDate();

  const trainedByDate = new Map(
    sessions.filter((s) => s.status !== 'active' && hasLoggedWork(s)).map((s) => [s.date, s.id]),
  );

  const cells: (Cell | null)[] = [];
  for (let i = 0; i < first.getDay(); i++) cells.push(null);
  for (let n = 1; n <= total; n++) {
    const date = new Date(y, m, n);
    const key = ymd(date);
    const dow = date.getDay();
    const matchedWorkout = workouts.find((w) => (w.dates || []).includes(key) || (w.days || []).includes(dow));
    cells.push({ key, n, workoutId: matchedWorkout?.id, sessionId: trainedByDate.get(key) });
  }
  return cells;
}
