import { useMemo, useState } from 'react';
import { useNutrition } from '../../store/nutrition';
import { PillarBack } from './PillarBack';
import { buildCoachNutritionReview } from '../nutrition-review';
import '../coach-redesign.css';

/*
 * The mockup's `<section id="view-nutrition">`, ported to JSX.
 *
 * Every number below comes from `buildCoachNutritionReview` — the same pure
 * projection `CoachNutrition.tsx`'s self-coach view used — over the
 * signed-in account's own `useNutrition()` slice. Nothing here computes
 * macro maths itself; `@hybrid/nutrition-engine` already owns that, and this
 * screen only reads what `nutrition-review.ts` hands back.
 *
 * This pillar is read-only context. It never writes to the athlete's diary,
 * never edits a program, and never feeds a value into a weekly plan — the
 * Coordinator stays the only writer of that.
 *
 * ACCEPTED ROSTER REGRESSION (decided 11 August 2026, see task-6 brief):
 * `CoachNutrition.tsx` served roster clients through a real layer-3 backend
 * (`getNutritionSummary` / `getNutritionWindow` / `hasNutritionGrant`). This
 * pillar reads local stores only, so a roster client is blocked by
 * `ClientDetailGate` instead of shown a summary. That capability loss is
 * deliberate and owner-approved for Stage 1 — it is not restored here, and
 * it is not silently re-added.
 *
 * WHAT ELSE THE MOCKUP HAS NO SLOT FOR (beyond the roster branch above —
 * reported, not preserved, per the task-6 brief's Step 1: "report anything
 * it shows that the mockup has no place for, rather than dropping it
 * silently"). `CoachNutrition.tsx`'s self-coach view also read and rendered:
 *   - `review.exceptions` — the "Now / N items to understand" panel;
 *   - `review.program` — goal, target rate, `goalLabel()`;
 *   - `review.days` — the full seven-day ledger table (date/status/macros/
 *     entries), as opposed to just today's macro bars below;
 *   - `review.checkIn` — the weekly expenditure check-in card (previous /
 *     observed / proposed expenditure, proposed calories, engine modules);
 *   - `review.summary.estimate.estimateKcal` and `.explanation` — only the
 *     estimate's `confidence` word survives, into the "Estimate" metric;
 *   - the static "Coach boundary" note (no scanner/logger/diary-edit exists
 *     on this route);
 *   - `dataRecovered` — a corrupt-local-storage fallback banner. Dropped
 *     without a mockup slot, same as the sibling pillars: `useDb()` carries
 *     the identical field and Readiness/Strength/Conditioning do not surface
 *     it either.
 * The mockup's `#view-nutrition` is four elements — back link, an unlogged-
 * days alert, an adherence/macro panel, and a weight-trend panel — and this
 * file builds exactly those four, using its class names and structure.
 */

function capitalize(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s;
}

function weekdayLabel(value: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
}

function joinWithAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function Metric({ label, value, unit, numeric = true }: { label: string; value: string; unit?: string; numeric?: boolean }) {
  return (
    <div className="rd-metric">
      <p className="rm-label">{label}</p>
      <p className={`rm-value${numeric ? ' num' : ''}`}>
        {value}
        {unit && <span className="rm-unit"> {unit}</span>}
      </p>
    </div>
  );
}

/**
 * One of the three `.rd-loadbar`s inside `.rd-macro-bars`. `target === null`
 * ("no program target for this day") and `logged === false` ("today is
 * unlogged, so `actual` is not evidence of anything") are both absent-data
 * states and both say so in words rather than drawing a 0g bar against a
 * real target — the same rule the unlogged-days alert follows.
 */
function MacroBar({
  label,
  actual,
  target,
  color,
  logged,
}: {
  label: string;
  actual: number;
  target: number | null;
  color: string;
  logged: boolean;
}) {
  if (target == null) {
    return (
      <div className="rd-loadbar">
        <div className="lb-top">
          <span>{label}</span>
          <span className="num">No target set</span>
        </div>
      </div>
    );
  }
  if (!logged) {
    return (
      <div className="rd-loadbar">
        <div className="lb-top">
          <span>{label}</span>
          <span className="num">Not logged yet today</span>
        </div>
      </div>
    );
  }
  const pct = target > 0 ? Math.min(100, (actual / target) * 100) : 0;
  return (
    <div className="rd-loadbar">
      <div className="lb-top">
        <span>{label}</span>
        <span className="num">
          {Math.round(actual)} of {Math.round(target)} g
        </span>
      </div>
      <div className="lb-track">
        <div className="lb-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

/** Same construction as `CoachNutrition.tsx`'s old `WeightTrend`, resized to
 *  the mockup's `#weight-spark` (220×52) and drawn from real weigh-ins and
 *  the engine's own EWMA trend — never a locally recomputed one. */
function WeightSpark({ raw, trend }: { raw: (number | null)[]; trend: (number | null)[] }) {
  const values = [...raw, ...trend].filter((v): v is number => v != null);
  if (values.length < 2) return null;
  const w = 220;
  const h = 52;
  const pad = 4;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(0.1, max - min);
  const x = (i: number, len: number) => pad + (i * (w - 2 * pad)) / Math.max(1, len - 1);
  const y = (v: number) => h - pad - ((v - min) / range) * (h - 2 * pad);
  const trendPoints = trend
    .map((v, i) => (v == null ? null : `${x(i, trend.length).toFixed(1)},${y(v).toFixed(1)}`))
    .filter((p): p is string => p != null)
    .join(' ');
  return (
    <svg
      className="rd-weight-spark"
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={`Weight evidence from ${min.toFixed(1)} to ${max.toFixed(1)} kilograms`}
    >
      <polyline points={trendPoints} fill="none" stroke="var(--color-gold)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      {raw.map((v, i) => (v == null ? null : <circle key={i} cx={x(i, raw.length)} cy={y(v)} r="1.5" fill="var(--color-text)" />))}
    </svg>
  );
}

export function Nutrition() {
  const { nutrition } = useNutrition();
  const [alertOpen, setAlertOpen] = useState(false);
  const day = today();
  const review = useMemo(() => buildCoachNutritionReview(nutrition, day), [nutrition, day]);

  const unloggedDays = useMemo(() => review.days.filter((d) => d.status === 'unlogged'), [review.days]);
  const todayReview = review.days.find((d) => d.date === day) ?? null;
  const todayLogged = todayReview != null && todayReview.status !== 'unlogged';
  const target = todayReview?.target ?? null;
  const totals = todayReview?.totals ?? null;

  const { loggedDays, windowDays: adherenceWindowDays } = review.summary.adherence;
  const { weightDays, windowDays: coverageWindowDays } = review.coverage;
  const confidence = review.summary.estimate.confidence;
  const { direction, slopeKgPerWeek } = review.summary.trend;
  const latestWeightKg = review.latestWeight?.weightKg ?? null;
  const weightSparkAvailable = [...review.weightSeries.raw, ...review.weightSeries.trend].filter((v) => v != null).length >= 2;

  return (
    <div className="rd-content">
      <PillarBack />

      {unloggedDays.length > 0 && (
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
            <span className="alert-title">
              {unloggedDays.length} day{unloggedDays.length === 1 ? '' : 's'} unlogged this week
            </span>
            <svg className="a-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
          <div className="rd-alert-body">
            <p>
              No entries were logged for {joinWithAnd(unloggedDays.map((d) => weekdayLabel(d.date)))}
              {' — a missing day means unknown, never zero. Averages below exclude '}
              {unloggedDays.length === 1 ? 'that day' : 'those days'} rather than treating{' '}
              {unloggedDays.length === 1 ? 'it' : 'them'} as zero-calorie.
            </p>
          </div>
        </div>
      )}

      <p className="rd-section-label">Adherence &amp; targets</p>
      <section className="rd-panel rd-panel-grid">
        <Metric label="Days logged" value={String(loggedDays)} unit={`of ${adherenceWindowDays}`} />
        {coverageWindowDays > 0 ? (
          <Metric label="Weigh-ins" value={String(weightDays)} unit={`of ${coverageWindowDays}`} />
        ) : (
          <Metric label="Weigh-ins" value="No data yet" numeric={false} />
        )}
        <Metric label="Estimate" value={capitalize(confidence)} numeric={false} />
        <div className="rd-macro-bars">
          <MacroBar label="Protein" actual={totals?.proteinG ?? 0} target={target?.proteinG ?? null} color="var(--color-neon-ok)" logged={todayLogged} />
          <MacroBar label="Carbs" actual={totals?.carbsG ?? 0} target={target?.carbsG ?? null} color="var(--color-neon-warn)" logged={todayLogged} />
          <MacroBar label="Fat" actual={totals?.fatG ?? 0} target={target?.fatG ?? null} color="var(--color-neon-strain)" logged={todayLogged} />
        </div>
      </section>

      <p className="rd-section-label">Weight trend</p>
      <section className="rd-panel">
        {latestWeightKg == null ? (
          <p className="rd-panel-note">No weigh-ins recorded yet.</p>
        ) : (
          <div className="rd-weight-row">
            <div>
              <p className="rm-value num" style={{ fontSize: '22px' }}>
                {latestWeightKg.toFixed(1)}
                <span className="rm-unit"> kg latest</span>
              </p>
              <p className="rd-panel-note" style={{ marginTop: '2px' }}>
                {slopeKgPerWeek == null
                  ? 'Not enough weigh-ins yet for a weekly rate.'
                  : `${slopeKgPerWeek > 0 ? '+' : ''}${slopeKgPerWeek.toFixed(1)} kg/week · ${direction}`}
              </p>
            </div>
            {weightSparkAvailable ? (
              <WeightSpark raw={review.weightSeries.raw} trend={review.weightSeries.trend} />
            ) : (
              <p className="rd-panel-note">Not enough weight evidence for a trend yet.</p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
