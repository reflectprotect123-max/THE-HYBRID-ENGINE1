import { useMemo, useState, type CSSProperties } from 'react';
import { FN } from '@hybrid/config';
import { useDb } from '../../store/db';
import { PillarBack } from './PillarBack';
import '../coach-redesign.css';

/*
 * The mockup's `<section id="view-readiness">`, ported to JSX.
 *
 * Two independent numbers drive this screen, and they come from two
 * different places on purpose:
 *  - the brass gauge is WHOOP's own recovery score for the most recent
 *    synced day (`db.settings.whoopDaily`) — absent when nothing has
 *    synced, per "absent data is stated, never faked";
 *  - the band bar below it is `whole-athlete-state`'s readiness estimate
 *    (`athleteState.readiness`), which folds WHOOP in with manual
 *    recovery, life load and training history rather than reading WHOOP
 *    alone.
 * The mockup's placeholder wiring (`RECOVERY_BY_BAND`) conflated the two;
 * this file does not.
 */

interface WhoopDailyRow {
  date: string;
  recovery: number | null;
  strain: number | null;
  hrvMs?: number | null;
  restingHr?: number | null;
  sleepPerformance?: number | null;
}

const RING_CIRCUMFERENCE = 452.4;

/** The mockup's 12-tick chronograph bezel (`drawTicks`), precomputed once —
 *  the geometry is fixed, so there is nothing to compute at render time. */
const TICKS: { x1: number; y1: number; x2: number; y2: number; major: boolean }[] = [
  { x1: 96, y1: 16, x2: 96, y2: 6, major: true },
  { x1: 138, y1: 23.25, x2: 141, y2: 18.06, major: false },
  { x1: 168.75, y1: 54, x2: 173.94, y2: 51, major: false },
  { x1: 176, y1: 96, x2: 186, y2: 96, major: true },
  { x1: 168.75, y1: 138, x2: 173.94, y2: 141, major: false },
  { x1: 138, y1: 168.75, x2: 141, y2: 173.94, major: false },
  { x1: 96, y1: 176, x2: 96, y2: 186, major: true },
  { x1: 54, y1: 168.75, x2: 51, y2: 173.94, major: false },
  { x1: 23.25, y1: 138, x2: 18.06, y2: 141, major: false },
  { x1: 16, y1: 96, x2: 6, y2: 96, major: true },
  { x1: 23.25, y1: 54, x2: 18.06, y2: 51, major: false },
  { x1: 54, y1: 23.25, x2: 51, y2: 18.06, major: false },
];

function whoopRows(raw: unknown): WhoopDailyRow[] {
  return Array.isArray(raw) ? (raw as WhoopDailyRow[]) : [];
}

/** WHOOP's own three-band recovery colouring (green/yellow/red at
 *  67%/34%), applied to the gauge itself — independent of the readiness
 *  band bar underneath it, which uses whole-athlete-state's thresholds. */
function ringColor(pct: number | null): string {
  if (pct == null) return 'var(--color-dim)';
  if (pct >= 67) return 'var(--color-neon-ok)';
  if (pct >= 34) return 'var(--color-neon-warn)';
  return 'var(--color-neon-bad)';
}

function bandColor(band: string): string {
  switch (band) {
    case 'high':
      return 'var(--color-ok)';
    case 'moderate':
      return 'var(--color-warn)';
    case 'low':
      return 'var(--color-bad)';
    default:
      return 'var(--color-dim)';
  }
}

function bandLabel(band: string): string {
  switch (band) {
    case 'high':
      return 'High';
    case 'moderate':
      return 'Moderate';
    case 'low':
      return 'Low';
    default:
      return 'Unknown';
  }
}

function formatStaleDate(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return `as of ${date}`;
  return `as of ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

interface MetricPoint {
  date: string;
  value: number;
}

/**
 * Every real point for this metric, oldest first — NOT sliced to any one
 * window. `db.settings.whoopDaily` is retained up to 365 days
 * (`cloud/whoop.tsx`'s `hist.slice(-365)`), so the 7/30/90-day range toggle
 * below has genuine history to draw from; `TrendCard` is the one that slices
 * a window off the end of this list, per the range the user picked.
 */
function metricPoints(
  rows: WhoopDailyRow[],
  accessor: (r: WhoopDailyRow) => number | null | undefined,
): MetricPoint[] {
  return rows
    .map((r) => ({ date: r.date, value: accessor(r) }))
    .filter((p): p is MetricPoint => typeof p.value === 'number' && Number.isFinite(p.value));
}

function sparkPath(points: number[], w: number, h: number, pad: number) {
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const pts = points.map((v, i) => {
    const x = pad + (i * (w - 2 * pad)) / (points.length - 1);
    const y = h - pad - ((v - min) * (h - 2 * pad)) / span;
    return [x, y] as const;
  });
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  const area = `${first[0].toFixed(1)},${(h - pad).toFixed(1)} ${line} ${last[0].toFixed(1)},${(h - pad).toFixed(1)}`;
  return { line, area, last };
}

const CARD_ICON_PATH: Record<string, string> = {
  hrv: 'M3 12h4l2-7 4 14 2-7h6',
  rhr: 'M20.8 8.6c0 5.6-8.8 10.6-8.8 10.6S3.2 14.2 3.2 8.6a4.8 4.8 0 0 1 8.8-2.7 4.8 4.8 0 0 1 8.8 2.7z',
  sleep: 'M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z',
  strain: 'M13 2 3 14h6l-1 8 11-13h-7l1-7z',
};

/** The mockup's `ICONS.strain` is a solid bolt (`fill="currentColor"
 *  stroke="none"`), unlike the other three metrics' stroke-only outlines —
 *  a deliberate visual distinction, not an inconsistency to normalise away. */
function CardIcon({ cardKey }: { cardKey: keyof typeof CARD_ICON_PATH }) {
  if (cardKey === 'strain') {
    return (
      <span className="c-icon">
        <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <path d={CARD_ICON_PATH.strain} />
        </svg>
      </span>
    );
  }
  return (
    <span className="c-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d={CARD_ICON_PATH[cardKey]} />
      </svg>
    </span>
  );
}

const RANGE_OPTIONS = [7, 30, 90] as const;
type RangeDays = (typeof RANGE_OPTIONS)[number];

function TrendCard({
  cardKey,
  label,
  unit,
  points,
  goodDirection,
}: {
  cardKey: keyof typeof CARD_ICON_PATH;
  label: string;
  unit: string;
  points: MetricPoint[];
  goodDirection: 'up' | 'down' | null;
}) {
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<RangeDays>(7);

  // The collapsed card's value/delta/spark always read the most recent 7
  // readings, independent of whatever range the expanded chart is set to —
  // matching the mockup, whose top-of-card numbers never move when its
  // range toggle changes.
  const previewPoints = points.slice(-7);

  if (previewPoints.length < 2) {
    return (
      <div className="rd-card">
        <div className="rd-card-top">
          <CardIcon cardKey={cardKey} />
          <span className="c-label">{label}</span>
        </div>
        <p className="rd-stale-note" style={{ textAlign: 'left', marginTop: 8 }}>Not enough history yet.</p>
      </div>
    );
  }

  const latest = previewPoints[previewPoints.length - 1]!;
  const prev = previewPoints[previewPoints.length - 2]!;
  const cls = goodDirection == null ? 'neutral' : (latest.value >= prev.value) === (goodDirection === 'up') ? 'good' : 'bad';
  const color = cls === 'good' ? 'var(--color-ok)' : cls === 'bad' ? 'var(--color-bad)' : 'var(--color-muted)';
  const diff = Math.round((latest.value - prev.value) * 10) / 10;
  const sign = diff >= 0 ? '+' : '';
  const s = sparkPath(previewPoints.map((p) => p.value), 180, 38, 3);

  // The expanded chart slices the SAME real series to whatever window is
  // selected — never padded, interpolated or jittered to fill it. When the
  // athlete's actual history is shorter than the selected window, `short`
  // says so explicitly rather than letting a partial line pass as a full
  // 30- or 90-day trend.
  const rangePoints = points.slice(-range);
  const big = rangePoints.length >= 2 ? sparkPath(rangePoints.map((p) => p.value), 500, 60, 4) : null;
  const short = rangePoints.length < range;

  return (
    <div className={`rd-card${open ? ' open' : ''}`}>
      <button
        type="button"
        className="rd-card-top"
        aria-expanded={open}
        aria-label={`Expand ${label} chart`}
        onClick={() => setOpen((v) => !v)}
      >
        <CardIcon cardKey={cardKey} />
        <span className="c-label">{label}</span>
        <span className="c-chev">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </span>
      </button>
      <div className="rd-card-value">
        <span className="c-num num">{latest.value}</span>
        <span className="c-unit">{unit}</span>
      </div>
      <div className={`rd-card-delta ${cls}`}>
        {sign}
        {diff}
        {unit ? ` ${unit}` : ''} vs previous reading
      </div>
      <svg className="rd-spark" width="180" height="38" viewBox="0 0 180 38">
        <polygon points={s.area} fill={color} opacity={0.18} />
        <polyline points={s.line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={s.last[0]} cy={s.last[1]} r={3} fill={color} />
      </svg>
      {open && (
        <div className="rd-card-expand">
          <div className="rd-card-expand-inner">
            <div className="rd-range-toggle" role="group" aria-label={`${label} chart range`}>
              {RANGE_OPTIONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={r === range ? 'active' : undefined}
                  aria-pressed={r === range}
                  onClick={() => setRange(r)}
                >
                  {r}d
                </button>
              ))}
            </div>
            {big ? (
              <>
                {short && (
                  <p className="rd-stale-note" style={{ textAlign: 'left', marginBottom: 6 }}>
                    Only {rangePoints.length} day{rangePoints.length === 1 ? '' : 's'} of history on record —
                    showing all of it, not a full {range}-day window.
                  </p>
                )}
                <svg className="rd-big-chart" viewBox="0 0 500 60">
                  <polygon points={big.area} fill={color} opacity={0.14} />
                  <polyline points={big.line} fill="none" stroke={color} strokeWidth={2} />
                </svg>
              </>
            ) : (
              <p className="rd-stale-note" style={{ textAlign: 'left' }}>Not enough history yet for this range.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function Readiness() {
  const { db, athleteState } = useDb();
  const [alertOpen, setAlertOpen] = useState(false);

  const painConstraint = athleteState.constraints.find((c) => c.code === 'pain_hold_active') ?? null;

  const rows = useMemo(() => whoopRows(db.settings.whoopDaily), [db.settings.whoopDaily]);
  const byDate = useMemo(() => [...rows].sort((a, b) => a.date.localeCompare(b.date)), [rows]);
  const recoveryRows = useMemo(() => byDate.filter((r) => r.recovery != null), [byDate]);
  const latestRecovery = recoveryRows[recoveryRows.length - 1] ?? null;

  const today = new Date().toISOString().slice(0, 10);
  const connected = latestRecovery != null;
  const stale = connected && latestRecovery!.date !== today;
  const pct = connected ? (latestRecovery!.recovery as number) : null;
  const ringStroke = connected && !stale ? ringColor(pct) : 'var(--color-dim)';
  const offset = pct != null ? RING_CIRCUMFERENCE * (1 - pct / 100) : RING_CIRCUMFERENCE;
  const needleDeg = pct != null ? (pct / 100) * 360 : 0;

  const band = athleteState.readiness.band;
  const score = athleteState.readiness.score;
  const bandPos = score != null ? Math.max(0, Math.min(100, score)) : null;

  const hrvPoints = useMemo(() => metricPoints(byDate, (r) => r.hrvMs), [byDate]);
  const rhrPoints = useMemo(() => metricPoints(byDate, (r) => r.restingHr), [byDate]);
  const sleepPoints = useMemo(() => metricPoints(byDate, (r) => r.sleepPerformance), [byDate]);
  const strainPoints = useMemo(() => metricPoints(byDate, (r) => r.strain), [byDate]);

  return (
    <div className="rd-content">
      <PillarBack />

      {painConstraint && (
        <div className={`rd-alert${alertOpen ? ' open' : ''}`}>
          <button
            type="button"
            className="rd-alert-head"
            onClick={() => setAlertOpen((v) => !v)}
            aria-expanded={alertOpen}
          >
            <span className="a-ic">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 9v4M12 17h.01M10.3 3.9L2.5 17.5a1.7 1.7 0 0 0 1.5 2.5h16a1.7 1.7 0 0 0 1.5-2.5L13.7 3.9a1.7 1.7 0 0 0-3.4 0z" />
              </svg>
            </span>
            <span className="alert-title">Pain flag active</span>
            <svg className="a-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
          <div className="rd-alert-body">
            <p>
              {painConstraint.reason} {painConstraint.adjustment}
            </p>
          </div>
        </div>
      )}

      <div className="rd-hero" style={{ '--glow-color': ringStroke } as CSSProperties}>
        <div className="rd-ring-wrap" style={connected ? undefined : { opacity: 0.35 }}>
          <svg width="192" height="192" viewBox="0 0 192 192">
            <defs>
              <linearGradient id="brassBezel" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#c8a06d" />
                <stop offset="45%" stopColor="#8a6a3f" />
                <stop offset="55%" stopColor="#8a6a3f" />
                <stop offset="100%" stopColor="#e0bc87" />
              </linearGradient>
            </defs>
            {/* instrument bezel: the one deliberate risk — this is a Command
                Center, so its hero reads as a cockpit gauge, rendered in the
                same brass this app already uses for its ARC mark, not a
                borrowed fitness-ring convention */}
            <circle className="rd-bezel" cx="96" cy="96" r="90" />
            <g className="rd-ticks">
              {TICKS.map((t, i) => (
                <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} className={t.major ? 'major' : undefined} />
              ))}
            </g>
            <g className="rd-rivets">
              <circle cx="96" cy="8" r="1.6" />
              <circle cx="184" cy="96" r="1.6" />
              <circle cx="96" cy="184" r="1.6" />
              <circle cx="8" cy="96" r="1.6" />
            </g>
            <g transform="rotate(-90 96 96)">
              <circle className="rd-ring-track" cx="96" cy="96" r="72" />
              <circle
                className="rd-ring-fill"
                cx="96"
                cy="96"
                r="72"
                stroke={ringStroke}
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={offset}
              />
            </g>
            <g className="rd-needle" style={{ transformOrigin: '96px 96px', transform: `rotate(${needleDeg}deg)` }}>
              <line x1="96" y1="96" x2="96" y2="34" />
              <circle cx="96" cy="96" r="4.5" />
            </g>
          </svg>
          <div className="rd-ring-label">
            <div className="rv num">
              {connected ? (
                <>
                  {pct}
                  <span className="unit">%</span>
                </>
              ) : null}
            </div>
            <div className="rl">Recovery</div>
          </div>
        </div>

        {stale && <p className="rd-ring-note">{formatStaleDate(latestRecovery!.date)}</p>}

        {!connected && (
          <a className="rd-connect" href={FN.whoopConnect}>
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M13 2 3 14h6l-1 8 11-13h-7l1-7z" />
            </svg>
            Connect WHOOP
          </a>
        )}

        <div className="rd-band-wrap">
          <div className="rd-band-label">
            <span>Readiness</span>
            <span className="bl-current" style={{ color: bandColor(band) }}>{bandLabel(band)}</span>
          </div>
          <div className="rd-band-bar">
            {bandPos != null && <div className="rd-band-marker" style={{ left: `${bandPos}%` }} />}
          </div>
        </div>
      </div>

      <div className="rd-cards">
        <TrendCard cardKey="hrv" label="HRV" unit="ms" points={hrvPoints} goodDirection="up" />
        <TrendCard cardKey="rhr" label="Resting HR" unit="bpm" points={rhrPoints} goodDirection="down" />
        <TrendCard cardKey="sleep" label="Sleep performance" unit="%" points={sleepPoints} goodDirection="up" />
        <TrendCard cardKey="strain" label="Strain" unit="" points={strainPoints} goodDirection={null} />
      </div>
    </div>
  );
}
