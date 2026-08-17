import { useEffect, useMemo, useState } from 'react';
import { useDb } from '../../store/db';
import { useConcept2 } from '../../cloud/concept2';
import { useSync, supabaseClient } from '../../cloud/sync';
import { getMyArcOrgId, pushTrendSnapshots, pushReadinessTrendSnapshot } from '../../cloud/arc-athlete-sync';
import { cx } from '../../ui';
import { useCoachWorkspace } from '../data/CoachWorkspaceContext';
import type { AthleteTrendSnapshot } from '../data/contracts';
import { ergTrend, weeklyHardBudget, type TrendSeries } from '../data/trends';

/*
 * "Where they're at." Capacity bands come from whole-athlete-state; the
 * trend is Concept2's synced results grouped into one honest test distance.
 * Lift trends (the engine's e1RM math) were removed with the strength engine
 * deletion (CLAUDE.md). Chart colors are the validated chart-grade pair (see
 * coach.css) — brand brass and blue fail the chart lightness/chroma checks
 * and stay reserved for UI chrome.
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
        stroke="var(--color-panel3)"
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

interface ReadinessPoint {
  date: string;
  recovery: number | null;
  strain: number | null;
  hrvMs?: number | null;
  restingHr?: number | null;
  sleepPerformance?: number | null;
}

function readinessLine(p: ReadinessPoint): string {
  const parts: string[] = [];
  if (p.hrvMs != null) parts.push(`${p.hrvMs}ms HRV`);
  if (p.restingHr != null) parts.push(`${p.restingHr}bpm RHR`);
  if (p.sleepPerformance != null) parts.push(`${p.sleepPerformance}% sleep`);
  if (p.strain != null) parts.push(`${p.strain} strain`);
  if (p.recovery != null) parts.push(`${p.recovery}% recovery`);
  return parts.join(' · ');
}

function RosterReadinessView({ clientId, clientName }: { clientId: string; clientName: string }) {
  const { repository } = useCoachWorkspace();
  const [granted, setGranted] = useState<boolean | null>(null);
  const [snapshot, setSnapshot] = useState<AthleteTrendSnapshot | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    /* `?.()` alone short-circuits to `undefined` when unimplemented (an
       older build, or the mock repository) — chaining `.then` on that
       throws rather than degrading. `?? Promise.resolve(...)` substitutes
       the same "not available" fallback every other branch already renders. */
    (repository.hasReadinessGrant?.(clientId) ?? Promise.resolve(false))
      .then((v) => { if (active) setGranted(v); }).catch(() => { if (active) setGranted(false); });
    (repository.getTrendSnapshot?.(clientId, 'readiness_trend') ?? Promise.resolve(null))
      .then((v) => { if (active) setSnapshot(v); }).catch(() => { if (active) setSnapshot(null); });
    return () => { active = false; };
  }, [repository, clientId]);

  const points = useMemo(() => {
    const raw = (snapshot?.points ?? []) as unknown as ReadinessPoint[];
    return [...raw].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7);
  }, [snapshot]);

  return (
    <section className="mt-1 rounded border border-line bg-panel3 p-1">
      <h3 className="text-[10px] uppercase tracking-wider text-dim">Readiness — needs {clientName}&rsquo;s consent</h3>
      {granted === false && (
        <p className="mt-0.5 text-[11px] text-muted">
          {clientName} has not granted raw readiness access to your account. Ask them to grant it from their own device — it can be revoked at any time and every read is logged to their receipt trail.
        </p>
      )}
      {granted && snapshot === undefined && <p className="mt-0.5 text-[11px] text-muted">Loading…</p>}
      {granted && snapshot === null && <p className="mt-0.5 text-[11px] text-muted">Not available.</p>}
      {granted && snapshot && points.length === 0 && (
        <p className="mt-0.5 text-[11px] text-muted">No readiness history yet.</p>
      )}
      {granted && snapshot && points.length > 0 && (
        <>
          {points.map((p) => (
            <div key={p.date} className="mt-0.5 flex items-center gap-1">
              <span className="text-[10px] tabular-nums text-dim">{p.date}</span>
              <span className="ml-auto text-[10px] tabular-nums text-muted">{readinessLine(p)}</span>
            </div>
          ))}
          <p className="mt-0.5 text-[10px] text-dim">This read was logged to {clientName}&rsquo;s receipt trail.</p>
        </>
      )}
    </section>
  );
}

export function AthleteStatus({ clientId, clientName }: { clientId?: string; clientName?: string } = {}) {
  if (clientId) return <RosterReadinessView clientId={clientId} clientName={clientName ?? 'This athlete'} />;
  return <SelfAthleteStatus />;
}

function SelfAthleteStatus() {
  const { db, workouts, sessions, athleteState } = useDb();
  const c2 = useConcept2();
  const today = new Date().toISOString().slice(0, 10);

  const erg = useMemo(() => ergTrend(c2.results), [c2.results]);
  const schedule = db.core?.schedule;
  const budgetTarget =
    (schedule?.strengthSessionsPerWeek ?? 0) + (schedule?.conditioningSessionsPerWeek ?? 0) || 3;
  const hard = useMemo(
    () => weeklyHardBudget(workouts, sessions, today, budgetTarget),
    [workouts, sessions, today, budgetTarget],
  );
  const { capacity } = athleteState;

  /*
   * Best-effort push of what THIS component already computes, to the ARC
   * backend, so a coach's `get_athlete_trend_series` has something to read.
   * Fires only when the computed series actually change (the deps below),
   * never on every render — and, like every ARC call in this codebase,
   * silently no-ops for the overwhelming majority of accounts that have no
   * coach and therefore no organisation membership at all.
   */
  const { user } = useSync();
  useEffect(() => {
    if (!supabaseClient || !user) return;
    void (async () => {
      const orgId = await getMyArcOrgId(supabaseClient, user.id);
      if (!orgId) return;
      await pushTrendSnapshots(supabaseClient, orgId, [], erg, hard);
      await pushReadinessTrendSnapshot(supabaseClient, orgId, (db.settings.whoopDaily ?? []) as { date: string; recovery: number | null; strain: number | null; hrvMs?: number | null; restingHr?: number | null; sleepPerformance?: number | null }[]);
    })();
    // `hard` and `erg` are plain objects recomputed by useMemo above and
    // compared by reference here, which is intentional — pushing only when
    // the computed VALUE actually changed (their own deps arrays already
    // guarantee that) is the point, not pushing on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, erg, hard]);

  return (
    // Pure trend reference — never itself a decision point, so it recedes
    // the same way the rail's other telemetry (Signal, the ledger) does.
    <section className="mt-1 rounded border border-line bg-panel3 p-1">
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

      {!erg ? (
        <p className="mt-0.5 text-[11px] text-dim">
          Trends appear after three synced erg tests — not enough history yet.
        </p>
      ) : (
        <TrendRow
          series={erg}
          color="var(--chart-blue)"
          fmt={paceFmt}
          deltaFmt={(d) => `${d <= 0 ? '−' : '+'}${paceFmt(Math.abs(d))} /500m`}
        />
      )}
    </section>
  );
}
