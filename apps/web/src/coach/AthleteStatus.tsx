import { useMemo } from 'react';
import { useDb } from '../store/db';
import { useConcept2 } from '../cloud/concept2';
import { cx } from '../ui';
import { ergTrend, liftTrends, weeklyHardBudget, type TrendSeries } from './trends';

/*
 * "Where they're at." Capacity bands come from whole-athlete-state; the
 * trends are the engine's own e1RM math windowed per week, and Concept2's
 * synced results grouped into one honest test distance. Chart colors are
 * the validated chart-grade pair (see coach.css) — brand brass and blue
 * fail the chart lightness/chroma checks and stay reserved for UI chrome.
 */

const BAND_TONE: Record<string, string> = {
  high: 'text-ok outline-ok/40',
  moderate: 'text-muted outline-line2',
  low: 'text-bad outline-bad/40',
  unknown: 'text-dim outline-line2',
};

function BandChip({ label, band }: { label: string; band: string }) {
  return (
    <span
      className={cx(
        'rounded-full px-1 py-[1px] text-[10px] uppercase tracking-wide outline outline-1',
        BAND_TONE[band] ?? BAND_TONE['unknown'],
      )}
    >
      {label} {band}
    </span>
  );
}

function Spark({ series, color }: { series: TrendSeries; color: string }) {
  const w = 120;
  const h = 30;
  const pad = 3;
  const known = series.points
    .map((v, i) => ({ v, i }))
    .filter((p): p is { v: number; i: number } => p.v != null);
  if (known.length < 2) return null;
  const min = Math.min(...known.map((p) => p.v));
  const max = Math.max(...known.map((p) => p.v));
  const span = max - min || 1;
  const x = (i: number) => pad + (i * (w - 2 * pad)) / (series.points.length - 1);
  const y = (v: number) => h - pad - ((v - min) * (h - 2 * pad)) / span;
  const pts = known.map((p) => `${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const last = known[known.length - 1]!;
  const area = `${x(known[0]!.i).toFixed(1)},${h - pad} ${pts} ${x(last.i).toFixed(1)},${h - pad}`;
  return (
    <svg width={w} height={h} role="img" aria-label={`${series.label} trend`} className="shrink-0">
      <polygon points={area} fill={color} opacity={0.12} />
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle
        cx={x(last.i)}
        cy={y(last.v)}
        r={3}
        fill={color}
        stroke="var(--color-panel)"
        strokeWidth={2}
      />
      {known.map((p) => (
        <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r={6} fill="transparent">
          <title>{p.v}</title>
        </circle>
      ))}
    </svg>
  );
}

const paceFmt = (s: number): string =>
  `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

function TrendRow({
  series,
  color,
  fmt,
  deltaFmt,
}: {
  series: TrendSeries;
  color: string;
  fmt: (v: number) => string;
  deltaFmt: (d: number) => string;
}) {
  return (
    <div className="mt-0.5 flex items-center gap-1">
      <div className="w-[104px] shrink-0">
        <p className="truncate text-[11px] font-medium">{series.label}</p>
        <p className="text-[10px] text-dim">{series.sub}</p>
      </div>
      <Spark series={series} color={color} />
      <div className="ml-auto text-right">
        <p className="text-[13px] font-semibold tabular-nums">{fmt(series.latest)}</p>
        <p className="text-[10px] tabular-nums text-muted">
          {series.delta == null ? '—' : deltaFmt(series.delta)}
        </p>
      </div>
    </div>
  );
}

export function AthleteStatus() {
  const { db, workouts, sessions, athleteState } = useDb();
  const c2 = useConcept2();
  const today = new Date().toISOString().slice(0, 10);

  const lifts = useMemo(() => liftTrends(sessions, today), [sessions, today]);
  const erg = useMemo(() => ergTrend(c2.results), [c2.results]);
  const schedule = db.core?.schedule;
  const budgetTarget =
    (schedule?.strengthSessionsPerWeek ?? 0) + (schedule?.conditioningSessionsPerWeek ?? 0) || 3;
  const hard = useMemo(
    () => weeklyHardBudget(workouts, sessions, today, budgetTarget),
    [workouts, sessions, today, budgetTarget],
  );
  const { capacity } = athleteState;

  return (
    <section className="mt-1 rounded border border-line bg-panel p-1">
      <h3 className="text-[10px] uppercase tracking-wider text-dim">Where they’re at</h3>
      <div className="mt-0.5 flex flex-wrap items-center gap-1">
        <BandChip label="str" band={capacity.strength} />
        <BandChip label="cond" band={capacity.conditioning} />
        <span
          className="ml-auto flex items-center gap-[3px]"
          title={`Hard sessions this week vs the schedule's ${hard.budget}-session budget`}
        >
          {Array.from({ length: hard.budget }, (_, i) => (
            <span
              key={i}
              className={cx(
                'h-[5px] w-3 rounded-sm',
                i < Math.min(hard.count, hard.budget)
                  ? 'bg-[var(--chart-gold)]'
                  : 'bg-panel2 outline outline-1 outline-line',
              )}
            />
          ))}
          {hard.count > hard.budget && <span className="h-[5px] w-3 rounded-sm bg-bad" />}
          <span className="ml-0.5 text-[10px] tabular-nums text-dim">
            {hard.count}/{hard.budget} hard
          </span>
        </span>
      </div>

      {lifts.length === 0 && !erg ? (
        <p className="mt-0.5 text-[11px] text-dim">
          Trends appear after three weeks of logged lifting or three synced erg tests — not
          enough history yet.
        </p>
      ) : (
        <>
          {lifts.map((s) => (
            <TrendRow
              key={s.label}
              series={s}
              color="var(--chart-gold)"
              fmt={(v) => `${v} kg`}
              deltaFmt={(d) => `${d >= 0 ? '+' : ''}${d} kg`}
            />
          ))}
          {erg && (
            <TrendRow
              series={erg}
              color="var(--chart-blue)"
              fmt={paceFmt}
              deltaFmt={(d) => `${d <= 0 ? '−' : '+'}${paceFmt(Math.abs(d))} /500m`}
            />
          )}
        </>
      )}
    </section>
  );
}
