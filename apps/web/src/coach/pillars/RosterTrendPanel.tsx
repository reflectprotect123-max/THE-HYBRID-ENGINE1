import type { TrendSeries } from '../trends';
import type { RosterTrendState } from './useRosterTrend';

/*
 * A roster athlete's trend series, rendered by the pillar screens.
 *
 * This is deliberately NOT `LiftCard`/`ErgCard`. Those expand to a bigger
 * chart re-derived from the athlete's RAW sessions and erg results, and the
 * roster tier does not carry those — a coach reading a roster athlete gets
 * the aggregated series that athlete's own device pushed, and nothing
 * underneath it. That is the boundary the layer-3 design draws on purpose,
 * so this card has no expansion rather than an expansion that would have to
 * fake its contents.
 *
 * Same `.rd-card` shell as the self-coach cards, so the two read as the same
 * screen and a coach is never in doubt about which pillar they are on. No
 * CSS is added.
 */

/** The sparkline path, matching `Strength.tsx`'s own `liftSparkPath` — a
 *  series with fewer than two real points has no line to draw. */
function sparkPath(points: Array<number | null>, w: number, h: number, pad: number) {
  const real = points.map((p, i) => ({ p, i })).filter((x): x is { p: number; i: number } => x.p != null);
  if (real.length < 2) return null;
  const values = real.map((x) => x.p);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = (w - pad * 2) / Math.max(1, points.length - 1);
  const xy = real.map((x) => ({
    x: pad + x.i * step,
    y: h - pad - ((x.p - min) / span) * (h - pad * 2),
  }));
  return {
    line: xy.map((c) => `${c.x},${c.y}`).join(' '),
    area: `${pad},${h - pad} ${xy.map((c) => `${c.x},${c.y}`).join(' ')} ${xy[xy.length - 1].x},${h - pad}`,
    lastX: xy[xy.length - 1].x,
    lastY: xy[xy.length - 1].y,
  };
}

function RosterTrendCard({ series, unit }: { series: TrendSeries; unit: string }) {
  const cls = series.delta == null ? 'neutral' : series.delta >= 0 ? 'good' : 'bad';
  const color = cls === 'good' ? 'var(--color-ok)' : cls === 'bad' ? 'var(--color-bad)' : 'var(--color-muted)';
  const spark = sparkPath(series.points, 180, 38, 3);

  return (
    <div className="rd-card">
      {/* A `<div>`, not the self-coach card's `<button>`: there is nothing to
          expand here, and a control that looks pressable and does nothing is
          worse than no control. */}
      <div className="rd-card-top">
        <span className="c-label">{series.label}</span>
      </div>
      <div className="rd-card-value">
        <span className="c-num num">{series.latest}</span>
        <span className="c-unit">{unit}</span>
      </div>
      <div className={`rd-card-delta ${cls}`}>
        {series.delta == null ? '—' : `${series.delta >= 0 ? '+' : ''}${series.delta} ${unit}`} · {series.sub}
      </div>
      {spark && (
        <svg className="rd-spark" width="180" height="38" viewBox="0 0 180 38" aria-hidden>
          <polygon points={spark.area} fill={color} opacity={0.18} />
          <polyline points={spark.line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={spark.lastX} cy={spark.lastY} r={3} fill={color} />
        </svg>
      )}
    </div>
  );
}

/**
 * The four states of a roster trend read, said differently on purpose.
 *
 * "Still asking", "nothing has ever been pushed", "pushed but empty" and
 * "here it is" are four different facts about an athlete, and flattening any
 * two of them tells the coach something untrue about a person.
 */
export function RosterTrendPanel({ state, unit, label, emptyNote }: {
  state: RosterTrendState<TrendSeries>;
  unit: string;
  /** Names the pillar in the absent state, so a coach reading four screens
   *  can tell which one has nothing rather than assuming the bench is dead. */
  label: string;
  emptyNote?: string;
}) {
  if (state.status === 'loading') return <p className="rd-panel-note" role="status">Loading {label}…</p>;

  if (state.status === 'absent') {
    return (
      <div className="rd-panel">
        <p className="lib-sub">No {label} has been shared yet.</p>
        <p className="rd-panel-note">
          {emptyNote ?? 'This athlete’s device pushes these when it syncs. Nothing has arrived for them yet.'}
        </p>
      </div>
    );
  }

  if (state.points.length === 0) {
    return (
      <div className="rd-panel">
        <p className="lib-sub">{label} arrived, but there is nothing in it yet.</p>
        <p className="rd-panel-note">Their device has synced; they have not logged enough for a trend.</p>
      </div>
    );
  }

  return (
    <>
      <div className="rd-cards">
        {state.points.map((series) => (
          <RosterTrendCard key={series.label} series={series} unit={unit} />
        ))}
      </div>
      {/* WHEN, not just what. A trend snapshot is a copy taken at a moment;
          a coach acting on a fortnight-old copy should be able to see that
          it is a fortnight old. */}
      <p className="rd-panel-note">Shared by their device on {state.generatedAt.slice(0, 10)}.</p>
    </>
  );
}
