import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { hasLoggedWork, ymd, type Session, type Workout } from '@hybrid/engine';
import { useDb } from '../store/db';
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
              <div
                key={i}
                className={cx(
                  'aspect-square rounded-sm border p-0.5 text-center',
                  d.key === today ? 'border-gold-line bg-gold-wash' : 'border-line bg-panel2',
                )}
              >
                <div className="num text-2 text-muted">{d.n}</div>
                <div className="mt-0.5 flex justify-center gap-0.5">
                  {d.sessionId ? <span className="h-1 w-1 rounded-pill bg-gold2" title="trained" /> : null}
                  {d.workoutId && !d.sessionId ? (
                    <span className="h-1 w-1 rounded-pill border border-gold2" title="planned" />
                  ) : null}
                </div>
              </div>
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
