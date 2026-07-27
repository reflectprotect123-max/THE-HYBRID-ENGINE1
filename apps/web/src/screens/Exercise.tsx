import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { agoLabel, barScale, exLogFor, knownMovements, type ExerciseHistoryEntry } from '@hybrid/engine';
import { useDb } from '../store/db';
import { Card, Empty, Field, Kicker, ScreenTitle, SectionHead, cx } from '../ui';

/*
 * One movement, all of it.
 *
 * `exLogFor` and `exBest` have been in the engine since the exercise-history
 * work and NOTHING has ever called them — every completed working set of a
 * lift, session by session, computed and never once shown. This is the screen
 * they were written for.
 *
 * The trend is estimated 1RM rather than top set, because a top set means
 * nothing across changing rep ranges: 100×5 and 115×2 are the same lift on
 * different days, and only e1RM puts them on one axis. That is also why every
 * point carries the reps that produced it — an e1RM off a single is a measured
 * thing, an e1RM off twelve is an extrapolation, and the reader deserves to
 * know which they are looking at.
 */
export function Exercise() {
  const { name = '' } = useParams();
  const nav = useNavigate();
  const { db, sessions } = useDb();
  const movement = decodeURIComponent(name);

  const log = useMemo(() => exLogFor(movement, sessions), [movement, sessions]);
  const movements = useMemo(() => knownMovements(db.workouts, sessions), [db.workouts, sessions]);
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);
  /* Newest first, capped. Thirty-one sessions is an eight-thousand-pixel page
     and the recent ones are the ones anyone opens this for. */
  const shown = useMemo(() => (all ? log.slice().reverse() : log.slice(-12).reverse()), [log, all]);

  const best = useMemo(
    () => log.reduce<ExerciseHistoryEntry | null>((m, h) => (!m || h.best.e1 > m.best.e1 ? h : m), null),
    [log],
  );
  const heaviest = useMemo(
    () => log.flatMap((h) => h.sets).reduce<{ kg: number; reps: number } | null>((m, s) => (!m || s.kg > m.kg ? s : m), null),
    [log],
  );

  if (!movement) {
    return <Picker movements={movements} q={q} setQ={setQ} onPick={(m) => nav(`/exercise/${encodeURIComponent(m)}`)} />;
  }

  return (
    <>
      <Kicker>Exercise</Kicker>
      <ScreenTitle>{movement}</ScreenTitle>

      {!log.length ? (
        <Empty
          title="Nothing logged for this one yet"
          body="Working sets show up here the moment you finish a session with it in."
        />
      ) : (
        <>
          {/* One point per SESSION, not per set: the best set of each day. A
              point per set makes a sawtooth out of your warm-up ramp and buries
              the trend the chart exists to show. */}
          <SectionHead title={`Estimated 1RM · ${log.length} ${log.length === 1 ? 'session' : 'sessions'}`} />
          <Card>
            <E1rmTrend log={log} />
          </Card>

          <SectionHead title="Bests" />
          <div className="grid grid-cols-2 gap-1">
            <Stat
              label="Best estimated 1RM"
              value={best ? `${Math.round(best.best.e1)}kg` : '—'}
              sub={best ? `${best.best.kg}×${best.best.reps}${best.best.reps > 8 ? ' — a long extrapolation' : ''} · ${agoLabel(best.date)}` : ''}
              tint
            />
            <Stat
              label="Heaviest set"
              value={heaviest ? `${heaviest.kg}kg` : '—'}
              sub={heaviest ? `for ${heaviest.reps} ${heaviest.reps === 1 ? 'rep' : 'reps'}` : ''}
            />
          </div>

          <SectionHead title={shown.length < log.length ? `Last ${shown.length} sessions` : 'Every session'} />
          <ul className="flex flex-col gap-0.5">
            {shown.map((h) => (
                <li key={h.sid}>
                  <Card tone="quiet" className="py-1.5">
                    <div className="flex items-baseline gap-1">
                      <span className="num flex-1 text-4 font-[650]">{agoLabel(h.date)}</span>
                      <span className="num text-3 text-dim">{h.date}</span>
                    </div>
                    <p className="num mt-0.5 text-3 text-muted">
                      {h.sets.map((s) => `${s.kg}×${s.reps}${s.felt ? '@' + s.felt : ''}`).join('  ')}
                    </p>
                    <p className="num mt-0.5 text-2 text-dim">best e1RM {Math.round(h.best.e1)}kg</p>
                  </Card>
                </li>
            ))}
          </ul>
          {shown.length < log.length ? (
            <button onClick={() => setAll(true)} className="mt-1 w-full rounded-md border border-line bg-panel3 p-1 text-3 font-[650] text-gold2">
              Show the other {log.length - shown.length}
            </button>
          ) : null}
        </>
      )}

      <SectionHead title="Another movement" />
      <Picker movements={movements} q={q} setQ={setQ} onPick={(m) => nav(`/exercise/${encodeURIComponent(m)}`)} bare />
    </>
  );
}

/**
 * e1RM session by session.
 *
 * Reuses `barScale` rather than a fresh axis: a well-trained lift moves a few
 * percent over months, and zero-baselined that is a flat line for the same
 * reason the volume chart was a flat wall. The floor is labelled underneath,
 * because a truncated axis that does not say so is the dishonest kind.
 */
function E1rmTrend({ log }: { log: ExerciseHistoryEntry[] }) {
  const W = 280;
  const H = 72;
  const pts = log.map((h) => h.best.e1);
  const scale = barScale(pts);
  const x = (i: number) => (i / Math.max(1, pts.length - 1)) * W;
  const y = (v: number) => H - (scale.pct(v) / 100) * H;
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = log[log.length - 1];
  const first = log[0];

  if (pts.length < 2) {
    return (
      <p className="num text-4 text-muted">
        {Math.round(pts[0])}kg estimated 1RM from {last.best.kg}×{last.best.reps}. One session is a point, not a trend —
        the line starts at two.
      </p>
    );
  }

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-18 w-full overflow-visible"
        role="img"
        aria-label={`Estimated 1RM trend across ${pts.length} sessions, latest ${Math.round(pts[pts.length - 1])} kilos`}
      >
        <line x1="0" y1={H} x2={W} y2={H} stroke="var(--color-track)" strokeWidth="1" />
        <path d={d} fill="none" stroke="var(--color-gold2)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle
          cx={x(pts.length - 1)}
          cy={y(pts[pts.length - 1])}
          r="3.5"
          fill="var(--color-gold2)"
          stroke="var(--color-chart-dot-ring)"
          strokeWidth="2"
        />
      </svg>
      <div className="num mt-0.5 flex justify-between text-2 text-dim">
        <span>{first.date}</span>
        <span className="text-gold2">{Math.round(pts[pts.length - 1])}kg</span>
        <span>{last.date}</span>
      </div>
      <p className="num mt-1 text-3 text-muted">
        {scale.floating
          ? `${Math.round(scale.floor)}–${Math.round(scale.top)}kg · axis starts at ${Math.round(scale.floor)}`
          : `peak ${Math.round(scale.top)}kg`}
        {' · from your best set each session'}
      </p>
    </div>
  );
}

function Stat({ label, value, sub, tint }: { label: string; value: string; sub?: string; tint?: boolean }) {
  return (
    <Card tone="quiet" className="py-1.5">
      <p className="text-2 text-dim">{label}</p>
      <b className={cx('num mt-0.5 block text-7 font-[900]', tint ? 'text-gold2' : 'text-text')}>{value}</b>
      {sub ? <p className="num mt-0.5 text-2 text-dim">{sub}</p> : null}
    </Card>
  );
}

/** Find a movement by typing. 300 movements is a list nobody scrolls. */
function Picker({
  movements,
  q,
  setQ,
  onPick,
  bare,
}: {
  movements: string[];
  q: string;
  setQ: (s: string) => void;
  onPick: (m: string) => void;
  bare?: boolean;
}) {
  const hits = useMemo(() => {
    const k = q.trim().toLowerCase();
    return (k ? movements.filter((m) => m.toLowerCase().includes(k)) : movements).slice(0, 12);
  }, [movements, q]);

  return (
    <>
      {!bare ? (
        <>
          <Kicker>Exercise</Kicker>
          <ScreenTitle>Pick a movement</ScreenTitle>
        </>
      ) : null}
      <Field
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`Search ${movements.length} movements`}
        aria-label="Search movements"
        className="mt-1"
      />
      <ul className="mt-1 flex flex-col gap-0.5">
        {hits.map((m) => (
          <li key={m}>
            <button
              onClick={() => onPick(m)}
              className="w-full rounded-md border border-line bg-panel3 p-1.5 text-left text-4 font-[650] hover:border-gold-line"
            >
              {m}
            </button>
          </li>
        ))}
        {!hits.length ? <li className="p-1.5 text-4 text-dim">Nothing matches “{q}”.</li> : null}
      </ul>
    </>
  );
}

/** Named export so Progress can link a lift row straight at its own history. */
export function exerciseHref(name: string): string {
  return `/exercise/${encodeURIComponent(name)}`;
}
