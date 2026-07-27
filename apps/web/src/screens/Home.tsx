import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  conZones,
  isCondWorkout,
  recoveryBand,
  rpeGapInfo,
  sessionVolume,
  todayRecovery,
  ymd,
  type Session,
  type Workout,
  type Zones,
} from '@hybrid/engine';
import { useDb } from '../store/db';
import { Button, Card, Empty, Kicker, Ring, ScreenTitle, SectionHead, cx } from '../ui';

/*
 * Home answers one question: what should I do today, given how I've recovered?
 *
 * Layout order is the vanilla app's: the one dominant tap first (resume, or
 * start today's session), the week at a glance, then readiness — because it
 * changes the answer — then the zone model the conditioning screen will hold
 * you to, and the week's honest totals last.
 *
 * The routes that have no tab of their own are reached from here by meaningful
 * doors rather than a pill row: the week strip and its header open /calendar,
 * the zones card offers /conditioning, and the 7-day totals link to /history.
 */

/** Emissive zone colours for lit dots and strips (01-foundations-colour-06):
 * glow brighter than the band inks, never used for text. */
const ZONE_NEON: Record<string, string> = {
  low: 'var(--color-neon-strain)',
  mod: 'var(--color-neon-ok)',
  high: 'var(--color-neon-bad)',
};

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
  // The live session already has its own card — repeating its workout under
  // "Today's plan" would offer Start for work that is mid-flight.
  const plannedToShow = useMemo(
    () => planned.filter((w) => !(activeSession && activeSession.workoutId === w.id)),
    [planned, activeSession],
  );

  const week7 = useMemo(
    () =>
      sessions.filter(
        (s) => s.status !== 'active' && s.completedAt && Date.now() - s.completedAt < 7 * 864e5,
      ),
    [sessions],
  );
  const recentVolume = useMemo(() => week7.reduce((n, s) => n + sessionVolume(s), 0), [week7]);

  const bandColor =
    band === 'good' ? 'var(--color-neon-ok)' : band === 'watch' ? 'var(--color-neon-warn)' : 'var(--color-neon-bad)';

  const dateLine = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const subLine = activeSession
    ? 'One session in progress.'
    : planned.length === 1
      ? 'One session planned.'
      : planned.length > 1
        ? `${planned.length} sessions planned.`
        : 'Rest day — nothing scheduled.';

  return (
    <>
      <Kicker>Welcome back</Kicker>
      <ScreenTitle>Train today</ScreenTitle>
      <p className="mt-0.5 text-4 text-muted">
        {dateLine} · {subLine}
      </p>

      <div className="mt-2 mb-1 flex items-baseline justify-between gap-1">
        <span className="text-1 font-[750] uppercase tracking-[.14em] text-dim">This week</span>
        <button onClick={() => nav('/calendar')} className="rounded-sm text-3 font-[650] text-gold2">
          Calendar ›
        </button>
      </div>
      <WeekStrip workouts={db.workouts} sessions={sessions} today={today} onOpen={() => nav('/calendar')} />

      {activeSession ? (
        <SessionCard className="mt-2 border-gold-line">
          <Kicker className="text-1">In progress</Kicker>
          <h3 className="mt-0.5 truncate text-7 font-[800]">{activeSession.name || 'Live session'}</h3>
          <Button variant="brass" size="lg" className="mt-1.5 w-full" onClick={() => nav('/training')}>
            Resume session →
          </Button>
        </SessionCard>
      ) : null}

      <SectionHead title="Today's plan" />
      {plannedToShow.length ? (
        <ul className="flex flex-col gap-1">
          {plannedToShow.map((w, i) => (
            <PlanRow
              key={w.id}
              w={w}
              primary={i === 0 && !activeSession}
              onStart={() => nav('/training')}
            />
          ))}
        </ul>
      ) : activeSession ? (
        <p className="text-4 text-muted">Nothing else on today. Finish what you started.</p>
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

      <SectionHead title="Readiness" />
      <Card className="flex items-center gap-2">
        <Ring
          frac={rec == null ? 0 : rec / 100}
          size={104}
          color={rec == null ? 'var(--color-ring-idle)' : bandColor}
          glow={rec != null}
        >
          {rec == null ? (
            <span className="text-3 text-dim">no score</span>
          ) : (
            <>
              <span className="num text-8 font-[900]" style={{ color: bandColor }}>
                {rec}
              </span>
              <span className="text-1 font-[750] uppercase tracking-[.1em] text-dim">recovery</span>
            </>
          )}
        </Ring>
        <div className="min-w-0 flex-1">
          <p className="text-6 font-[750]">
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

      {/* Title is asserted verbatim by checks/react-smoke.mjs — keep the string. */}
      <SectionHead
        title="Your zones today"
        right={
          <button onClick={() => nav('/conditioning')} className="rounded-sm text-3 font-[650] text-gold2">
            Start a run ›
          </button>
        }
      />
      <ZonesCard zones={zones} />

      <SectionHead
        title="Last 7 days"
        right={
          <button onClick={() => nav('/history')} className="rounded-sm text-3 font-[650] text-gold2">
            History ›
          </button>
        }
      />
      <div className="grid grid-cols-2 gap-1">
        <Stat value={recentVolume.toLocaleString()} label="kg lifted" tint />
        <Stat value={String(week7.length)} label={week7.length === 1 ? 'session' : 'sessions'} />
      </div>
    </>
  );
}

/** Seven days, today lit, a brass dot on any day with planned or logged work.
 * Every cell is a door into the calendar (04-athlete-01). */
function WeekStrip({
  workouts,
  sessions,
  today,
  onOpen,
}: {
  workouts: Workout[];
  sessions: Session[];
  today: string;
  onOpen: () => void;
}) {
  const days = useMemo(() => {
    const start = new Date();
    start.setDate(start.getDate() - start.getDay());
    const trained = new Set(sessions.filter((s) => s.status !== 'active').map((s) => s.date));
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = ymd(d);
      const has =
        trained.has(key) ||
        workouts.some((w) => (w.dates || []).includes(key) || (w.days || []).includes(d.getDay()));
      return {
        key,
        dw: 'SMTWTFS'[i],
        n: d.getDate(),
        has,
        label: d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }),
      };
    });
  }, [workouts, sessions]);

  return (
    <div className="flex gap-0.5">
      {days.map((d) => {
        const isToday = d.key === today;
        return (
          <button
            key={d.key}
            onClick={onOpen}
            aria-label={`${d.label} — open calendar`}
            aria-current={isToday ? 'date' : undefined}
            className={cx(
              'flex-1 rounded-sm border py-1 text-center transition-colors duration-120',
              isToday ? 'border-gold-line bg-gold-wash' : 'border-line bg-panel3 hover:border-line2',
            )}
          >
            <span
              className={cx(
                'block text-1 font-[750] uppercase tracking-[.1em]',
                isToday ? 'text-gold2' : 'text-dim',
              )}
            >
              {d.dw}
            </span>
            <b className={cx('num block text-5 font-[650]', isToday ? 'text-gold2' : 'text-text')}>{d.n}</b>
            <span
              aria-hidden
              className={cx('mx-auto mt-0.5 block h-0.5 w-0.5 rounded-pill', d.has ? 'bg-gold' : 'bg-transparent')}
            />
          </button>
        );
      })}
    </div>
  );
}

/** The session card surface from 04-athlete-02: a brass wash falling in from
 * the top-right corner. Decoration only — content stacks above it. */
function SessionCard({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <Card className={cx('relative overflow-hidden', className)}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_100%_0,var(--color-gold-wash),transparent_60%)]"
      />
      <div className="relative">{children}</div>
    </Card>
  );
}

function PlanRow({ w, onStart, primary }: { w: Workout; onStart: () => void; primary?: boolean }) {
  const n = w.blocks.length;
  const cond = n === 0 || isCondWorkout(w);
  // The kicker already names a conditioning day; repeating it below the title
  // said nothing. Strength days get the honest block count instead.
  const meta = [!cond && `${n} ${n === 1 ? 'block' : 'blocks'}`, w.origin === 'coach' && 'from your coach']
    .filter(Boolean)
    .join(' · ');
  return (
    <li>
      <SessionCard>
        <Kicker className="text-1">Today · {cond ? 'Conditioning' : 'Strength'}</Kicker>
        <div className="mt-0.5 flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-7 font-[800]">{w.name || 'Session'}</h3>
            {meta ? <p className="mt-0.5 text-3 text-muted">{meta}</p> : null}
          </div>
          {!primary ? (
            <Button variant="brass" onClick={onStart}>
              Start
            </Button>
          ) : null}
        </div>
        {primary ? (
          <Button variant="brass" size="lg" className="mt-1.5 w-full" onClick={onStart}>
            Start today&rsquo;s session →
          </Button>
        ) : null}
      </SessionCard>
    </li>
  );
}

/** HR zone rows per 04-athlete-06, lit with the neon set: glowing dot, a bar
 * whose length is each band's share of the working range, tabular bpm. */
function ZonesCard({ zones }: { zones: Zones }) {
  const span = Math.max(1, zones.max - zones.floor);
  return (
    <Card>
      <div className="num flex items-baseline justify-between gap-1 text-3 text-dim">
        <span>
          max {zones.max} bpm · {zones.method === 'hrr' ? 'Karvonen · resting ' + zones.rest : 'percent of max'}
        </span>
        {zones.adj !== 0 ? <span className="shrink-0 text-gold2">re-zoned today</span> : null}
      </div>
      <ul className="mt-1 flex flex-col">
        {zones.list.map((b) => {
          const neon = ZONE_NEON[b.key];
          return (
            <li key={b.key} className="flex items-center gap-1 py-0.5">
              <span
                aria-hidden
                className="h-1 w-1 shrink-0 rounded-pill"
                style={{ background: neon, boxShadow: `0 0 6px ${neon}` }}
              />
              <span className="w-12 shrink-0 text-4 font-[650]">{b.name}</span>
              <span className="h-0.5 min-w-0 flex-1 overflow-hidden rounded-pill bg-track">
                <span
                  className="block h-full rounded-pill"
                  style={{
                    width: `${Math.round((100 * (b.hi - b.lo)) / span)}%`,
                    background: neon,
                    boxShadow: `0 0 8px ${neon}`,
                  }}
                />
              </span>
              <span className="num w-7 shrink-0 text-right text-3 text-muted">
                {b.lo}–{b.hi}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Stat({ value, label, tint }: { value: string; label: string; tint?: boolean }) {
  return (
    <Card className="py-1.5 text-center">
      <b className={cx('num block text-7 font-[900]', tint ? 'text-gold2' : 'text-text')}>{value}</b>
      <span className="mt-0.5 block text-2 text-dim">{label}</span>
    </Card>
  );
}
