import { useEffect, useMemo, useState } from 'react';
import { goalLabel } from '@hybrid/nutrition-adapter';
import { useNutrition } from '../store/nutrition';
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

      <div className="mx-auto grid max-w-[1240px] gap-2 p-2 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-2">
          {dataRecovered && (
            <section className="rounded-md border border-warn bg-panel3 p-2" role="status">
              <h2 className="text-sm font-semibold">Local nutrition data was unreadable</h2>
              <p className="mt-0.5 text-xs text-muted">This is a fresh local fallback, not evidence that the athlete has no nutrition history.</p>
            </section>
          )}

          <section className="rounded-md border border-line2 bg-panel3 p-2" aria-labelledby="data-state-title">
            <div className="flex flex-wrap items-start gap-2">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-gold">Data state</p>
                <h2 id="data-state-title" className="text-sm font-semibold">{declaredDays} of 7 days declared</h2>
                <p className="mt-0.5 text-xs text-muted">Unlogged means unknown, never zero. Averages must not silently include missing days.</p>
              </div>
              <dl className="ml-auto grid grid-cols-3 gap-2 text-right text-xs">
                <div><dt className="text-[10px] uppercase tracking-wide text-dim">Logged</dt><dd className="mt-0.5 font-semibold tabular-nums">{review.summary.adherence.loggedDays}/{review.summary.adherence.windowDays}</dd></div>
                <div><dt className="text-[10px] uppercase tracking-wide text-dim">Weigh-ins</dt><dd className="mt-0.5 font-semibold tabular-nums">{review.coverage.weightDays}</dd></div>
                <div><dt className="text-[10px] uppercase tracking-wide text-dim">Estimate</dt><dd className="mt-0.5 font-semibold capitalize">{review.summary.estimate.confidence}</dd></div>
              </dl>
            </div>
          </section>

          <section className="rounded-md border border-line2 bg-panel3" aria-labelledby="program-title">
            <div className="flex items-baseline border-b border-line px-2 py-1.5">
              <div><p className="text-[10px] uppercase tracking-wider text-dim">Current program</p><h2 id="program-title" className="text-sm font-semibold">{review.program?.name ?? 'No program established'}</h2></div>
              <span className="ml-auto rounded-full border border-line2 bg-panel px-1 py-0.5 text-[10px] uppercase tracking-wide text-muted">read-only</span>
            </div>
            <div className="grid gap-2 p-2 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Goal" value={review.program ? goalLabel(review.program.targetRateKgPerWeek) : 'Unknown'} />
              <Metric label="Target rate" value={review.program ? `${review.program.targetRateKgPerWeek > 0 ? '+' : ''}${review.program.targetRateKgPerWeek} kg/week` : 'Unknown'} />
              <Metric label="Calories today" value={target ? number(target.calories, ' kcal') : 'No accepted target'} />
              <Metric label="Macros today" value={target ? `${number(target.proteinG)}P · ${number(target.carbsG)}C · ${number(target.fatG)}F` : 'No accepted target'} />
            </div>
            <p className="border-t border-line px-2 py-1 text-[11px] text-dim">The coach can review this program here but cannot edit the athlete’s diary or silently replace an accepted target.</p>
          </section>

          <section className="overflow-hidden rounded-md border border-line2 bg-panel3" aria-labelledby="ledger-title">
            <div className="border-b border-line px-2 py-1.5">
              <h2 id="ledger-title" className="text-sm font-semibold">Seven-day nutrition ledger</h2>
              <p className="mt-0.5 text-[11px] text-muted">Actual beside target, with the athlete’s declared data state preserved.</p>
            </div>
            <div className="overflow-x-auto">
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
          </section>

          <section className="rounded-md border border-line2 bg-panel3 p-2" aria-labelledby="checkin-title">
            <div className="flex items-baseline gap-1"><div><p className="text-[10px] uppercase tracking-wider text-dim">Weekly check-in</p><h2 id="checkin-title" className="text-sm font-semibold capitalize">{review.checkIn?.status ?? 'Not recorded'}</h2></div><span className="ml-auto text-[10px] tabular-nums text-dim">{review.weekStart} – {review.weekEnd}</span></div>
            {review.checkIn ? (
              <>
                <p className="mt-1 text-xs text-muted">{review.checkIn.explanation}</p>
                <div className="mt-1 grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
                  <Metric label="Previous expenditure" value={number(review.checkIn.previousExpenditureKcal, ' kcal')} />
                  <Metric label="Observed expenditure" value={number(review.checkIn.observedExpenditureKcal, ' kcal')} />
                  <Metric label="Proposed expenditure" value={number(review.checkIn.proposedExpenditureKcal, ' kcal')} />
                  <Metric label="Proposed calories" value={number(review.checkIn.proposedCalories, ' kcal')} />
                </div>
                {review.checkIn.modules.length > 0 && <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted">{review.checkIn.modules.map((module) => <li key={`${module.key}:${module.action}`}>{module.action}</li>)}</ul>}
              </>
            ) : <p className="mt-1 text-xs text-muted">No weekly nutrition decision exists for this week.</p>}
            <p className="mt-1 text-[11px] text-dim">This phase displays the recorded state. It does not fake coach approval before backend authority and receipts exist.</p>
          </section>
        </div>

        <aside className="space-y-2 xl:sticky xl:top-[58px] xl:self-start">
          <section className="rounded-md border border-line2 bg-panel3 p-2" aria-labelledby="exceptions-title">
            <p className="text-[10px] uppercase tracking-wider text-gold">Actionable exceptions</p>
            <h2 id="exceptions-title" className="text-sm font-semibold">{review.exceptions.length ? `${review.exceptions.length} item${review.exceptions.length === 1 ? '' : 's'} to understand` : 'No exception identified'}</h2>
            <div className="mt-1 space-y-1">
              {review.exceptions.map((exception) => (
                <article key={exception.id} className={`rounded border bg-panel p-1.5 ${exception.priority === 'attention' ? 'border-warn/60' : 'border-line'}`}>
                  <h3 className="text-xs font-medium">{exception.title}</h3>
                  <p className="mt-0.5 text-[11px] text-muted">{exception.detail}</p>
                  <p className="mt-0.5 text-[11px] text-dim"><span className="font-medium text-text">Next:</span> {exception.next}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="rounded-md border border-line2 bg-panel3 p-2" aria-labelledby="weight-title">
            <p className="text-[10px] uppercase tracking-wider text-dim">Weight and expenditure evidence</p>
            <h2 id="weight-title" className="text-sm font-semibold">{review.latestWeight ? `${review.latestWeight.weightKg.toFixed(1)} kg latest` : 'No weigh-in available'}</h2>
            <WeightTrend raw={review.weightSeries.raw} trend={review.weightSeries.trend} />
            <dl className="mt-1 space-y-0.5 text-xs">
              <Row label="Direction" value={review.summary.trend.direction} />
              <Row label="Slope" value={review.summary.trend.slopeKgPerWeek == null ? 'Unknown' : `${review.summary.trend.slopeKgPerWeek > 0 ? '+' : ''}${review.summary.trend.slopeKgPerWeek.toFixed(2)} kg/week`} />
              <Row label="Expenditure" value={number(review.summary.estimate.estimateKcal, ' kcal/day')} />
              <Row label="Confidence" value={review.summary.estimate.confidence} />
            </dl>
            <p className="mt-1 text-[11px] text-muted">{review.summary.estimate.explanation}</p>
            <p className="mt-1 text-[11px] text-dim">No wearable calorie estimate is used. This evidence never schedules or edits training.</p>
          </section>

          <section className="rounded-md border border-gold-line bg-gold-wash p-2">
            <p className="text-[10px] uppercase tracking-wider text-gold2">Coach boundary</p>
            <p className="mt-0.5 text-xs text-muted">No barcode scanner, label reader, food search, recipe builder, meal logger or diary-edit control exists on this route.</p>
          </section>
        </aside>
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
