import { useEffect, useMemo, useState } from 'react';
import { goalLabel } from '@hybrid/nutrition-adapter';
import { useNutrition } from '../store/nutrition';
import { CoachSection } from './CoachSection';
import { useCoachWorkspace } from './CoachWorkspaceContext';
import type { AthleteNutritionSummary, AthleteNutritionWindow } from './contracts';
import { buildCoachNutritionReview, type NutritionDayReview } from './nutrition-review';

function mondayOf(d: Date): string {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  copy.setDate(copy.getDate() - ((copy.getDay() + 6) % 7));
  return copy.toISOString().slice(0, 10);
}

/**
 * The REAL roster view, in two tiers matching the backend exactly.
 *
 * Summary (counts, a trend direction, an estimate confidence) needs no
 * consent grant — it is the same tier as the training summary counts.
 * Raw detail (macros, weight, the check-in) needs the ATHLETE's own
 * revocable grant; `getNutritionWindow` returns null for either "not
 * readable" or "no grant", and this screen must not guess which.
 */
function RosterNutritionView({ clientId, clientName }: { clientId: string; clientName: string }) {
  const { repository } = useCoachWorkspace();
  const weekStart = useMemo(() => mondayOf(new Date()), []);
  const [summary, setSummary] = useState<AthleteNutritionSummary | null | undefined>(undefined);
  const [window_, setWindow] = useState<AthleteNutritionWindow | null | undefined>(undefined);
  const [granted, setGranted] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    /* `?.()` alone short-circuits to `undefined` when unimplemented (an
       older build, or the mock repository) — chaining `.then` on that
       throws rather than degrading. `?? Promise.resolve(null)` substitutes
       the same "not available" null every other branch already renders. */
    (repository.getNutritionSummary?.(clientId, weekStart) ?? Promise.resolve(null))
      .then((v) => { if (active) setSummary(v); }).catch(() => { if (active) setSummary(null); });
    (repository.hasNutritionGrant?.(clientId) ?? Promise.resolve(false))
      .then((v) => { if (active) setGranted(v); }).catch(() => { if (active) setGranted(false); });
    (repository.getNutritionWindow?.(clientId, weekStart) ?? Promise.resolve(null))
      .then((v) => { if (active) setWindow(v); }).catch(() => { if (active) setWindow(null); });
    return () => { active = false; };
  }, [repository, clientId, weekStart]);

  const unloggedCount = window_?.dailyStatus.filter((day) => day.status === 'unlogged').length ?? 0;
  const macroTarget = window_ && window_.macroTargets.length > 0
    ? window_.macroTargets.find((t) => t.date === today()) ??
      window_.macroTargets.reduce((a, b) => (b.date > a.date ? b : a))
    : null;
  const weights = window_ ? [...window_.weightEntries].sort((a, b) => a.measuredAt.localeCompare(b.measuredAt)) : [];
  const latestWeight = weights.length > 0 ? weights[weights.length - 1] : null;
  const weightDelta = latestWeight && weights.length >= 2 ? latestWeight.weightKg - weights[0].weightKg : null;

  return (
    <main className="min-h-screen bg-bg text-text">
      <header className="border-b border-line2 px-3 py-3 sm:px-4">
        <div className="mx-auto max-w-[1240px]">
          <p className="text-[10px] uppercase tracking-[0.18em] text-gold">ARC · nutrition</p>
          <h1 className="mt-0.5 text-xl font-semibold">{clientName}&rsquo;s nutrition review</h1>
        </div>
      </header>

      <div className="mx-auto max-w-[1240px] space-y-2 p-2">
        <section className="rounded-md border border-line2 bg-panel3 p-2">
          <p className="text-[10px] uppercase tracking-wider text-gold">Summary — no consent needed</p>
          {summary === undefined && <p className="mt-0.5 text-xs text-muted">Loading…</p>}
          {summary === null && <p className="mt-0.5 text-xs text-muted">Not available.</p>}
          {summary && (
            <dl className="mt-1 grid grid-cols-3 gap-2 text-xs">
              <div><dt className="text-dim">Logged days</dt><dd className="tabular-nums">{summary.loggedDays}/{summary.windowDays}</dd></div>
              <div><dt className="text-dim">Weight trend</dt><dd className="capitalize">{summary.trendDirection ?? 'Unknown'}</dd></div>
              <div><dt className="text-dim">Estimate confidence</dt><dd className="capitalize">{summary.estimateConfidence ?? 'Unknown'}</dd></div>
            </dl>
          )}
        </section>

        <section className="rounded-md border border-line2 bg-panel3 p-2">
          <p className="text-[10px] uppercase tracking-wider text-gold">Raw detail — needs {clientName}&rsquo;s consent</p>
          {granted === false && (
            <p className="mt-0.5 text-xs text-muted">
              {clientName} has not granted raw nutrition access to your account. Ask them to grant it from their own device — it can be revoked at any time and every read is logged to their receipt trail.
            </p>
          )}
          {granted && window_ === undefined && <p className="mt-0.5 text-xs text-muted">Loading…</p>}
          {granted && window_ === null && <p className="mt-0.5 text-xs text-muted">Not available.</p>}
          {granted && window_ && (
            <div className="mt-1 space-y-1.5 text-xs">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-dim">Daily status</p>
                <ul className="mt-0.5 space-y-0.5">
                  {window_.dailyStatus.map((day) => <li key={day.date} className="flex gap-1"><span className="tabular-nums">{day.date}</span><span className="ml-auto capitalize text-muted">{day.status}</span></li>)}
                  {window_.dailyStatus.length === 0 && <li className="text-muted">No logged days this week.</li>}
                </ul>
              </div>
              {unloggedCount > 0 && (
                <p className="text-muted">{unloggedCount} day{unloggedCount === 1 ? '' : 's'} unlogged this week.</p>
              )}
              <div>
                <p className="text-[10px] uppercase tracking-wide text-dim">Today&rsquo;s macro targets</p>
                {macroTarget
                  ? <p className="mt-0.5 tabular-nums">{Math.round(macroTarget.calories)} kcal · {Math.round(macroTarget.proteinG)}g protein · {Math.round(macroTarget.carbsG)}g carbs · {Math.round(macroTarget.fatG)}g fat</p>
                  : <p className="mt-0.5 text-muted">No targets set.</p>}
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-dim">Weight trend</p>
                {latestWeight
                  ? <p className="mt-0.5 tabular-nums">{latestWeight.weightKg.toFixed(1)}kg latest{weightDelta != null ? ` · ${weightDelta >= 0 ? '+' : ''}${weightDelta.toFixed(1)}kg this week` : ''}</p>
                  : <p className="mt-0.5 text-muted">No weigh-ins this week.</p>}
              </div>
              {window_.latestCheckIn && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-dim">Latest check-in</p>
                  <p className="mt-0.5 capitalize">{window_.latestCheckIn.status}</p>
                  <p className="mt-0.5 text-muted">{window_.latestCheckIn.explanation}</p>
                </div>
              )}
              <p className="text-[10px] text-dim">This read was logged to {clientName}&rsquo;s receipt trail.</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

const STATUS_LABEL: Record<NutritionDayReview['status'], string> = {
  complete: 'Complete',
  partial: 'Partial',
  fasted: 'Declared fasted',
  unlogged: 'Unlogged',
};

const STATUS_CLASS: Record<NutritionDayReview['status'], string> = {
  complete: 'text-good',
  partial: 'text-warn',
  fasted: 'text-muted',
  unlogged: 'text-dim',
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${value}T00:00:00Z`));
}

function number(value: number | null | undefined, suffix = ''): string {
  return value == null ? 'Unknown' : `${Math.round(value)}${suffix}`;
}

export function CoachNutrition() {
  const { selectedClient } = useCoachWorkspace();
  return selectedClient && selectedClient.source === 'roster-summary'
    ? <RosterNutritionView clientId={selectedClient.id} clientName={selectedClient.name} />
    : <SelfCoachNutritionView />;
}

function SelfCoachNutritionView() {
  const { nutrition, dataRecovered } = useNutrition();
  const review = useMemo(() => buildCoachNutritionReview(nutrition, today()), [nutrition]);
  const declaredDays = review.days.filter((day) => day.status !== 'unlogged').length;
  const target = review.summary.today.target;

  return (
    <main className="min-h-screen bg-bg text-text">
      <header className="border-b border-line2 px-3 py-3 sm:px-4">
        <div className="mx-auto max-w-[1240px]">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-gold">ARC · nutrition</p>
            <h1 className="mt-0.5 text-xl font-semibold">Evidence, targets and the next conversation</h1>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1240px] p-2">
        {dataRecovered && (
          <section className="mb-2 rounded-md border border-warn bg-panel3 p-2" role="status">
            <h2 className="text-sm font-semibold">Local nutrition data was unreadable</h2>
            <p className="mt-0.5 text-xs text-muted">This is a fresh local fallback, not evidence that the athlete has no nutrition history.</p>
          </section>
        )}

        <section aria-labelledby="exceptions-title" className="card raised mb-4 overflow-hidden rounded-lg border border-gold-line bg-gold-wash/[0.03] border-l-0">
          <div className="flex items-end gap-2 border-b border-gold-line/40 bg-gold-wash px-3 py-2">
            <div>
              <p className="text-[9px] uppercase tracking-wider text-gold">Now</p>
              <h2 id="exceptions-title" className="text-base font-semibold">
                {review.exceptions.length ? `${review.exceptions.length} item${review.exceptions.length === 1 ? '' : 's'} to understand` : 'No exception identified'}
              </h2>
            </div>
          </div>
          <div className="divide-y divide-line">
            {review.exceptions.map((exception) => (
              <div key={exception.id} className={`border-l-2 px-2.5 py-2.5 ${exception.priority === 'attention' ? 'border-warn/60' : 'border-line'}`}>
                <h3 className="text-sm font-semibold">{exception.title}</h3>
                <p className="mt-0.5 text-xs text-muted">{exception.detail}</p>
                <p className="mt-1 text-[11px] text-text"><span className="text-dim">Next</span> · {exception.next}</p>
              </div>
            ))}
            {review.exceptions.length === 0 && <div className="px-3 py-5 text-center"><p className="text-xs text-muted">No exception identified this week.</p></div>}
          </div>
        </section>

        <div className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0">
            <CoachSection eyebrow="Data state" title={`${declaredDays} of 7 days declared`}>
              <p className="text-xs text-muted">Unlogged means unknown, never zero. Averages must not silently include missing days.</p>
              <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                <div><dt className="text-[10px] uppercase tracking-wide text-dim">Logged</dt><dd className="mt-0.5 font-semibold tabular-nums">{review.summary.adherence.loggedDays}/{review.summary.adherence.windowDays}</dd></div>
                <div><dt className="text-[10px] uppercase tracking-wide text-dim">Weigh-ins</dt><dd className="mt-0.5 font-semibold tabular-nums">{review.coverage.weightDays}</dd></div>
                <div><dt className="text-[10px] uppercase tracking-wide text-dim">Estimate</dt><dd className="mt-0.5 font-semibold capitalize">{review.summary.estimate.confidence}</dd></div>
              </dl>
            </CoachSection>

            <CoachSection eyebrow="Current program · read-only" title={review.program?.name ?? 'No program established'}>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Metric label="Goal" value={review.program ? goalLabel(review.program.targetRateKgPerWeek) : 'Unknown'} />
                <Metric label="Target rate" value={review.program ? `${review.program.targetRateKgPerWeek > 0 ? '+' : ''}${review.program.targetRateKgPerWeek} kg/week` : 'Unknown'} />
                <Metric label="Calories today" value={target ? number(target.calories, ' kcal') : 'No accepted target'} />
                <Metric label="Macros today" value={target ? `${number(target.proteinG)}P · ${number(target.carbsG)}C · ${number(target.fatG)}F` : 'No accepted target'} />
              </div>
              <p className="mt-2 text-[11px] text-dim">The coach can review this program here but cannot edit the athlete&rsquo;s diary or silently replace an accepted target.</p>
            </CoachSection>

            <CoachSection eyebrow="Evidence" title="Seven-day nutrition ledger">
              <p className="text-[11px] text-muted">Actual beside target, with the athlete&rsquo;s declared data state preserved.</p>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-left text-xs">
                  <thead className="bg-panel2 text-[10px] uppercase tracking-wider text-dim">
                    <tr><th className="px-2 py-1">Day</th><th className="px-2 py-1">State</th><th className="px-2 py-1">Calories</th><th className="px-2 py-1">Protein</th><th className="px-2 py-1">Carbs</th><th className="px-2 py-1">Fat</th><th className="px-2 py-1">Entries</th></tr>
                  </thead>
                  <tbody>
                    {review.days.map((day) => (
                      <tr key={day.date} className="border-t border-line">
                        <td className="whitespace-nowrap px-2 py-1.5 font-medium">{dateLabel(day.date)}</td>
                        <td className={`px-2 py-1.5 font-medium ${STATUS_CLASS[day.status]}`}>{STATUS_LABEL[day.status]}</td>
                        <MacroCell actual={day.totals.calories} target={day.target?.calories} suffix=" kcal" unknown={day.status === 'unlogged'} />
                        <MacroCell actual={day.totals.proteinG} target={day.target?.proteinG} suffix=" g" unknown={day.status === 'unlogged'} />
                        <MacroCell actual={day.totals.carbsG} target={day.target?.carbsG} suffix=" g" unknown={day.status === 'unlogged'} />
                        <MacroCell actual={day.totals.fatG} target={day.target?.fatG} suffix=" g" unknown={day.status === 'unlogged'} />
                        <td className="px-2 py-1.5 tabular-nums text-muted">{day.status === 'unlogged' ? '—' : day.entryCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CoachSection>

            <CoachSection eyebrow={`Weekly check-in · ${review.weekStart} – ${review.weekEnd}`} title={review.checkIn ? review.checkIn.status.charAt(0).toUpperCase() + review.checkIn.status.slice(1) : 'Not recorded'}>
              {review.checkIn ? (
                <>
                  <p className="text-xs text-muted">{review.checkIn.explanation}</p>
                  <div className="mt-1 grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
                    <Metric label="Previous expenditure" value={number(review.checkIn.previousExpenditureKcal, ' kcal')} />
                    <Metric label="Observed expenditure" value={number(review.checkIn.observedExpenditureKcal, ' kcal')} />
                    <Metric label="Proposed expenditure" value={number(review.checkIn.proposedExpenditureKcal, ' kcal')} />
                    <Metric label="Proposed calories" value={number(review.checkIn.proposedCalories, ' kcal')} />
                  </div>
                  {review.checkIn.modules.length > 0 && <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted">{review.checkIn.modules.map((module) => <li key={`${module.key}:${module.action}`}>{module.action}</li>)}</ul>}
                </>
              ) : <p className="text-xs text-muted">No weekly nutrition decision exists for this week.</p>}
              <p className="mt-2 text-[11px] text-dim">This phase displays the recorded state. It does not fake coach approval before backend authority and receipts exist.</p>
            </CoachSection>
          </div>

          <aside className="xl:sticky xl:top-4 xl:self-start">
            <CoachSection eyebrow="Weight and expenditure evidence" title={review.latestWeight ? `${review.latestWeight.weightKg.toFixed(1)} kg latest` : 'No weigh-in available'}>
              <WeightTrend raw={review.weightSeries.raw} trend={review.weightSeries.trend} />
              <dl className="mt-1 space-y-0.5 text-xs">
                <Row label="Direction" value={review.summary.trend.direction} />
                <Row label="Slope" value={review.summary.trend.slopeKgPerWeek == null ? 'Unknown' : `${review.summary.trend.slopeKgPerWeek > 0 ? '+' : ''}${review.summary.trend.slopeKgPerWeek.toFixed(2)} kg/week`} />
                <Row label="Expenditure" value={number(review.summary.estimate.estimateKcal, ' kcal/day')} />
                <Row label="Confidence" value={review.summary.estimate.confidence} />
              </dl>
              <p className="mt-1 text-[11px] text-muted">{review.summary.estimate.explanation}</p>
              <p className="mt-1 text-[11px] text-dim">No wearable calorie estimate is used. This evidence never schedules or edits training.</p>
            </CoachSection>

            <CoachSection eyebrow="Coach boundary" title="What this route cannot do">
              <p className="text-xs text-muted">No barcode scanner, label reader, food search, recipe builder, meal logger or diary-edit control exists on this route.</p>
            </CoachSection>
          </aside>
        </div>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded border border-line bg-panel p-1"><p className="text-[10px] uppercase tracking-wide text-dim">{label}</p><p className="mt-0.5 text-xs font-medium tabular-nums">{value}</p></div>;
}

function MacroCell({ actual, target, suffix, unknown }: { actual: number; target: number | null | undefined; suffix: string; unknown: boolean }) {
  return <td className="px-2 py-1.5 tabular-nums"><span className={unknown ? 'text-dim' : 'text-text'}>{unknown ? 'Unknown' : number(actual, suffix)}</span><span className="mt-0.5 block text-[10px] text-dim">target {target == null ? 'none' : number(target, suffix)}</span></td>;
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex gap-1"><dt className="text-muted">{label}</dt><dd className="ml-auto capitalize tabular-nums">{value}</dd></div>;
}

function WeightTrend({ raw, trend }: { raw: (number | null)[]; trend: (number | null)[] }) {
  const values = [...raw, ...trend].filter((value): value is number => value != null);
  if (values.length < 2) return <p className="mt-1 rounded border border-dashed border-line2 p-2 text-center text-[11px] text-muted">Not enough weight evidence for a trend.</p>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(0.1, max - min);
  const points = (series: (number | null)[]) => series.map((value, index) => value == null ? null : `${(index / Math.max(1, series.length - 1)) * 100},${36 - ((value - min) / range) * 32}`).filter(Boolean).join(' ');
  return (
    <svg className="mt-1 h-16 w-full rounded border border-line bg-panel" viewBox="0 0 100 40" role="img" aria-label={`Weight evidence from ${min.toFixed(1)} to ${max.toFixed(1)} kilograms`} preserveAspectRatio="none">
      <polyline points={points(trend)} fill="none" stroke="currentColor" className="text-gold" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      {raw.map((value, index) => value == null ? null : <circle key={index} cx={(index / Math.max(1, raw.length - 1)) * 100} cy={36 - ((value - min) / range) * 32} r="1" className="fill-text" />)}
    </svg>
  );
}
