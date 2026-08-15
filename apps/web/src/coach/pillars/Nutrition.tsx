import { useEffect, useMemo, useState } from 'react';
import { useNutrition } from '../../store/nutrition';
import { PillarBack } from './PillarBack';
import { useCoachWorkspace } from '../data/CoachWorkspaceContext';
import { weekStartOfLocalDate } from '../data/coach-week';
import type { AthleteNutritionSummary, AthleteNutritionWindow } from '../data/contracts';
import { buildCoachNutritionReview, type NutritionReviewException } from '../data/nutrition-review';
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
 * The mockup's `#view-nutrition` is four elements — back link, an alert, an
 * adherence/macro panel, and a weight-trend panel — and this file builds
 * exactly those four, using its class names and structure.
 *
 * FIX (task-6 review, 11 August 2026): `review.exceptions` is NOT dropped —
 * it is what the alert renders. `CoachCommandCenter`'s tile badges this
 * screen with `review.exceptions.length` across six kinds (`no-program`,
 * `check-in-pending`, `check-in-held`, `sparse-weigh-ins`,
 * `logging-coverage`, `macro-overshoot` — see `nutrition-review.ts`), so a
 * coach clicking "N exceptions" needs to find all N here, not just the days
 * that are fully unlogged. One `.rd-alert` per exception, `'attention'`
 * before `'information'`, body carrying both `detail` and the actionable
 * `next`. There is deliberately no separate hand-rolled unlogged-days path
 * beside it — `logging-coverage` already covers that ground (and covers it
 * more correctly: it fires on any partial day too, not only a fully
 * unlogged one), so a second, narrower path would just be two things a coach
 * could watch drift apart.
 */

function capitalize(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** `'attention'` outranks `'information'` — same two-tier idea
 *  `packages/coordinator/src/coordinator.ts`'s own priority-to-rank mapping
 *  uses (`must` > `preferred` > default), just with two tiers instead of
 *  three. `Array.prototype.sort` is stable (ES2019+), so exceptions of equal
 *  priority keep `nutrition-review.ts`'s own emission order. */
function exceptionRank(exception: NutritionReviewException): number {
  return exception.priority === 'attention' ? 0 : 1;
}

/** One `.rd-alert` per `NutritionReviewException` — the mockup's alert is a
 *  generic collapsible (icon, title, chevron, expandable body), and
 *  `{title, detail, next}` is exactly that shape. `next` is the actionable
 *  half of the pair and is never dropped. */
function ExceptionAlert({ exception, open, onToggle }: { exception: NutritionReviewException; open: boolean; onToggle: () => void }) {
  return (
    <div className={`rd-alert${open ? ' open' : ''}`}>
      <button type="button" className="rd-alert-head" onClick={onToggle} aria-expanded={open}>
        <span className="a-ic">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 9v4M12 17h.01M10.3 3.9L2.5 17.5a1.7 1.7 0 0 0 1.5 2.5h16a1.7 1.7 0 0 0 1.5-2.5L13.7 3.9a1.7 1.7 0 0 0-3.4 0z" />
          </svg>
        </span>
        <span className="alert-title">{exception.title}</span>
        <svg className="a-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
      <div className="rd-alert-body">
        <p>{exception.detail}</p>
        <p>
          <strong>Next</strong> · {exception.next}
        </p>
      </div>
    </div>
  );
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
 * real target — the same "unlogged means unknown, never zero" discipline the
 * exceptions above carry.
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


/**
 * A roster athlete's Nutrition pillar.
 *
 * Two tiers, and the split is the whole point. The SUMMARY — days logged,
 * trend direction, confidence — is an ordinary roster read. The WINDOW —
 * daily status, weigh-ins, macro targets, the latest check-in — is a
 * privileged read behind `nutrition_read_grants`, revocable by the athlete
 * at any time and logged to their receipt trail on every read.
 *
 * So the grant is checked before the window is shown, and a refusal is
 * stated as a refusal rather than rendered as an empty athlete. "No grant"
 * and "granted, nothing logged" are completely different facts about a
 * person and this screen never conflates them.
 *
 * Per CLAUDE.md, nutrition here is a FACT surface. Nothing on it prescribes,
 * and the macro targets shown are the athlete's own, read — never a target
 * this bench computed for them.
 */
function RosterNutrition({ clientId, clientName }: { clientId: string; clientName: string }) {
  const { repository } = useCoachWorkspace();
  const weekStart = useMemo(() => weekStartOfLocalDate(new Date()), []);
  const [summary, setSummary] = useState<AthleteNutritionSummary | null | undefined>(undefined);
  const [granted, setGranted] = useState<boolean | null>(null);
  const [window_, setWindow] = useState<AthleteNutritionWindow | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    setSummary(undefined);
    setGranted(null);
    setWindow(undefined);
    /* `?.()` alone short-circuits to `undefined` on a repository that does
       not implement the method; chaining `.then` on that throws rather than
       degrading. Same guard as every other roster read on this bench. */
    (repository.getNutritionSummary?.(clientId, weekStart) ?? Promise.resolve(null))
      .then((v) => { if (active) setSummary(v); }).catch(() => { if (active) setSummary(null); });
    (repository.hasNutritionGrant?.(clientId) ?? Promise.resolve(false))
      .then((v) => { if (active) setGranted(v); }).catch(() => { if (active) setGranted(false); });
    (repository.getNutritionWindow?.(clientId, weekStart) ?? Promise.resolve(null))
      .then((v) => { if (active) setWindow(v); }).catch(() => { if (active) setWindow(null); });
    return () => { active = false; };
  }, [repository, clientId, weekStart]);

  return (
    <div className="rd-content">
      <PillarBack />
      <p className="rd-section-label">Adherence · {clientName}</p>
      {summary === undefined && <p className="rd-panel-note" role="status">Loading adherence…</p>}
      {summary === null && (
        <div className="rd-panel">
          <p className="lib-sub">No nutrition summary has been shared yet.</p>
          <p className="rd-panel-note">Their device pushes this when it syncs. Nothing has arrived for them yet.</p>
        </div>
      )}
      {summary && (
        <div className="rd-panel">
          <div className="rd-panel-grid">
            <div>
              <p className="rd-section-label">Days logged</p>
              <p className="c-num num">{summary.loggedDays} / {summary.windowDays}</p>
            </div>
            <div>
              <p className="rd-section-label">Weight trend</p>
              <p className="c-num num">{summary.trendDirection ?? 'unknown'}</p>
            </div>
            <div>
              <p className="rd-section-label">Estimate</p>
              <p className="c-num num">{summary.estimateConfidence ?? 'unknown'}</p>
            </div>
          </div>
          {/* `null` is a real answer here, not a gap: the engine declines to
              call a direction it cannot support, and saying "unknown" is the
              honest render of that rather than picking "stable". */}
          {(summary.trendDirection === null || summary.estimateConfidence === null) && (
            <p className="rd-panel-note">
              Unknown means the engine declined to call it, not that data is missing.
            </p>
          )}
        </div>
      )}

      <p className="rd-section-label">Daily detail</p>
      {granted === false && (
        <div className="rd-panel">
          <p className="lib-sub">{clientName} has not granted daily nutrition access.</p>
          <p className="rd-panel-note">
            They can grant it from their own device, and revoke it at any time. Every read is written
            to their receipt trail.
          </p>
        </div>
      )}
      {granted === null && <p className="rd-panel-note" role="status">Checking consent…</p>}
      {granted && window_ === undefined && <p className="rd-panel-note" role="status">Loading daily detail…</p>}
      {granted && window_ === null && <p className="rd-panel-note">Not available.</p>}
      {granted && window_ && window_.dailyStatus.length === 0 && (
        <p className="rd-panel-note">Access is granted; {clientName} has logged no days this week.</p>
      )}
      {granted && window_ && window_.dailyStatus.length > 0 && (
        <>
          <div className="rd-panel">
            {window_.dailyStatus.map((day) => (
              <div className="cc-sysrow" key={day.date}>
                <span className="sn num">{day.date.slice(5)}</span>
                <span className="sd">{day.status}</span>
                {day.note && <span className="ss">{day.note}</span>}
              </div>
            ))}
          </div>
          <p className="rd-panel-note">This read was logged to {clientName}&rsquo;s receipt trail.</p>
        </>
      )}
    </div>
  );
}

export function Nutrition() {
  const { selectedClient, loading } = useCoachWorkspace();
  /*
   * The loading state is NOT folded into the self branch, and that is the
   * whole reason it is written out. `listClients()` is async, so for the
   * first frames after mount `selectedClient` is null — and a naive
   * `selectedClient?.source !== 'engine-local' ? roster : self` renders the
   * SELF view during those frames, which puts the signed-in coach's own
   * training on screen under a roster athlete's name. Briefly, but that is
   * exactly the leak `ClientDetailGate`'s header comment exists to prevent,
   * and "only for 200ms" is not a defence for showing one person's data
   * under another person's name. Caught by `roster-pillars.test.tsx`.
   */
  if (loading) return <main className="rd-content" aria-busy="true">Loading…</main>;
  if (selectedClient && selectedClient.source !== 'engine-local') {
    return <RosterNutrition clientId={selectedClient.id} clientName={selectedClient.name} />;
  }
  return <SelfNutrition />;
}

function SelfNutrition() {
  const { nutrition } = useNutrition();
  const [openExceptions, setOpenExceptions] = useState<ReadonlySet<string>>(new Set());
  const day = today();
  const review = useMemo(() => buildCoachNutritionReview(nutrition, day), [nutrition, day]);

  const sortedExceptions = useMemo(
    () => [...review.exceptions].sort((a, b) => exceptionRank(a) - exceptionRank(b)),
    [review.exceptions],
  );
  const toggleException = (id: string) =>
    setOpenExceptions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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

      {sortedExceptions.map((exception) => (
        <ExceptionAlert
          key={exception.id}
          exception={exception}
          open={openExceptions.has(exception.id)}
          onToggle={() => toggleException(exception.id)}
        />
      ))}

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
