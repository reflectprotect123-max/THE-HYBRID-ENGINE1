import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  conZones,
  recoveryBand,
  rpeGapInfo,
  sessionVolume,
  todayRecovery,
  ymd,
  type Workout,
} from '@hybrid/engine';
import { useDb } from '../store/db';
import { Button, Card, Empty, Kicker, Ring, ScreenTitle, SectionHead } from '../ui';

/*
 * Home answers one question: what should I do today, given how I've recovered?
 *
 * Readiness first because it changes the answer; then today's plan; then the
 * zone model, so the numbers the conditioning screen will hold you to are
 * visible before you commit to a session rather than after.
 */
export function Home() {
  const nav = useNavigate();
  const { db, whoop, hr, activeSession, sessions } = useDb();

  const today = ymd(new Date());
  const rec = todayRecovery(whoop);
  const band = recoveryBand(rec);
  const zones = useMemo(() => conZones(hr), [hr]);
  const gap = useMemo(() => rpeGapInfo(sessions), [sessions]);

  const dow = new Date().getDay();
  const planned = useMemo(
    () => db.workouts.filter((w) => (w.dates || []).includes(today) || (w.days || []).includes(dow)),
    [db.workouts, today, dow],
  );

  const recentVolume = useMemo(
    () =>
      sessions
        .filter((s) => s.status !== 'active' && s.completedAt && Date.now() - s.completedAt < 7 * 864e5)
        .reduce((n, s) => n + sessionVolume(s), 0),
    [sessions],
  );

  const bandColor =
    band === 'good' ? 'var(--color-neon-ok)' : band === 'watch' ? 'var(--color-neon-warn)' : 'var(--color-neon-bad)';

  return (
    <>
      <Kicker>Today</Kicker>
      <ScreenTitle>
        {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
      </ScreenTitle>

      <Card className="mt-2 flex items-center gap-2">
        <Ring frac={rec == null ? 0 : rec / 100} color={rec == null ? 'var(--color-ring-idle)' : bandColor}>
          {rec == null ? (
            <span className="text-3 text-dim">no score</span>
          ) : (
            <>
              <span className="num text-8 font-[900]" style={{ color: bandColor }}>
                {rec}
              </span>
              <span className="text-2 text-dim">recovery</span>
            </>
          )}
        </Ring>
        <div className="min-w-0 flex-1">
          <Kicker>Readiness</Kicker>
          <p className="mt-0.5 text-6 font-[750]">
            {band === 'good' ? 'Strong' : band === 'watch' ? 'Steady' : band === 'low' ? 'Low' : 'No score yet'}
          </p>
          <p className="mt-0.5 text-4 text-muted">
            {band === 'low'
              ? 'Zones are eased today and conditioning is dialled back a notch.'
              : band === 'good'
                ? 'Zones widened slightly at the top. Good day to push.'
                : band === 'watch'
                  ? 'Nothing adjusted. Train as prescribed.'
                  : 'Connect WHOOP in Settings, or set a resting HR to sharpen your zones.'}
          </p>
          {gap ? (
            <p className="mt-1 text-3 text-dim">
              Last session felt {gap.gap > 0.25 ? 'harder' : gap.gap < -0.25 ? 'easier' : 'about as'} {' '}
              {Math.abs(gap.gap) <= 0.25 ? 'hard as asked' : 'than asked'} ({gap.gap > 0 ? '+' : ''}
              {gap.gap.toFixed(1)} RPE over {gap.n} rated {gap.n === 1 ? 'set' : 'sets'}).
            </p>
          ) : null}
        </div>
      </Card>

      {activeSession ? (
        <Card className="mt-2 border-gold-line bg-gold-wash">
          <Kicker>In progress</Kicker>
          <p className="mt-0.5 text-6 font-[750]">{activeSession.name || 'Live session'}</p>
          <Button variant="brass" className="mt-1.5 w-full" onClick={() => nav('/training')}>
            Resume session
          </Button>
        </Card>
      ) : null}

      <SectionHead title="Today's plan" />
      {planned.length ? (
        <ul className="flex flex-col gap-1">
          {planned.map((w) => (
            <PlanRow key={w.id} w={w} onStart={() => nav('/training')} />
          ))}
        </ul>
      ) : (
        <Empty
          title="Nothing planned today"
          body="Pick something from your Library, or let a rest day be a rest day."
          action={
            <Button variant="brass" onClick={() => nav('/library')}>
              Open Library
            </Button>
          }
        />
      )}

      <SectionHead title="Your zones today" />
      <Card>
        <div className="num flex items-baseline justify-between text-3 text-dim">
          <span>
            {zones.method === 'hrr' ? 'Karvonen · resting ' + zones.rest : 'percent of max'} · max {zones.max}
          </span>
          {zones.adj !== 0 ? <span className="text-gold2">re-zoned for recovery</span> : null}
        </div>
        <ul className="mt-1 flex flex-col gap-0.5">
          {zones.list.map((b) => (
            <li key={b.key} className="flex items-center gap-1">
              <span
                className="h-1 w-1 shrink-0 rounded-pill"
                style={{
                  background:
                    b.key === 'low'
                      ? 'var(--color-z-low)'
                      : b.key === 'mod'
                        ? 'var(--color-z-mod)'
                        : 'var(--color-z-high)',
                }}
              />
              <span className="flex-1 text-4 font-[650]">{b.name}</span>
              <span className="num text-4 text-muted">
                {b.lo}–{b.hi}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <SectionHead title="Elsewhere" />
      <div className="flex flex-wrap gap-1">
        <Button onClick={() => nav('/history')}>History</Button>
        <Button onClick={() => nav('/calendar')}>Calendar</Button>
        <Button onClick={() => nav('/import')}>Import a workout</Button>
        <Button onClick={() => nav('/conditioning')}>Conditioning</Button>
      </div>

      <SectionHead title="Last 7 days" />
      <Card className="num flex items-baseline gap-2">
        <div>
          <div className="text-8 font-[900] text-gold2">{recentVolume.toLocaleString()}</div>
          <div className="text-2 text-dim">kg volume</div>
        </div>
        <div>
          <div className="text-8 font-[900]">
            {sessions.filter((s) => s.status !== 'active' && s.completedAt && Date.now() - s.completedAt < 7 * 864e5).length}
          </div>
          <div className="text-2 text-dim">sessions</div>
        </div>
      </Card>
    </>
  );
}

function PlanRow({ w, onStart }: { w: Workout; onStart: () => void }) {
  const n = w.blocks.length;
  return (
    <li>
      <Card className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          <p className="truncate text-5 font-[750]">{w.name || 'Session'}</p>
          <p className="text-3 text-dim">
            {n} {n === 1 ? 'block' : 'blocks'}
            {w.origin === 'coach' ? ' · from your coach' : ''}
          </p>
        </div>
        <Button variant="brass" onClick={onStart}>
          Start
        </Button>
      </Card>
    </li>
  );
}
