import { useMemo } from 'react';
import { ymd } from '@hybrid/engine';
import { ensureSharedCore } from '@hybrid/engine';
import {
  checkInFor,
  goalLabel,
  nutritionContext,
  nutritionSummary,
  round,
  weekEndOf,
  weekStartOf,
  weighInCoverage,
} from '@hybrid/nutrition-adapter';
import { deriveAthleteState } from '@hybrid/whole-athlete-state';
import { useDb } from '../store/db';
import { useNutrition } from '../store/nutrition';
import { cx } from '../ui';

/*
 * The athlete's nutrition, on the coach bench.
 *
 * READ-ONLY, and read-only by construction rather than by discipline: this file
 * calls `useNutrition()` for `nutrition` and never destructures `update` or
 * `replace`, and everything it renders comes from `@hybrid/nutrition-adapter`,
 * which exports no writer at all. A coach cannot log the athlete's food and
 * cannot set their targets from here. That is a Phase 4 decision, not a
 * permanent one — but until a coach-authored macro program exists as a
 * reviewed, athlete-consented flow, a bench that could silently rewrite an
 * athlete's calories is worse than a bench that can only look.
 *
 * The numbers are the same `nutritionSummary` the athlete's own dashboard card
 * renders. A coach quoting a figure the athlete has never seen is the failure
 * mode this shares a projection to avoid.
 */

const CONFIDENCE: Record<string, string> = {
  holding: 'no estimate yet',
  low: 'low confidence',
  medium: 'medium confidence',
  high: 'high confidence',
};

const STATUS_LINE: Record<string, string> = {
  pending: 'A proposal is waiting for the athlete',
  accepted: 'Accepted for this week',
  declined: 'Declined for this week',
  // 'held' is a recorded, normal outcome — stated as a fact, not a failure.
  held: 'Held — recorded, with what was missing',
};

export function NutritionPanel({ onClose }: { onClose: () => void }) {
  const { db } = useDb();
  const { nutrition } = useNutrition();
  const today = ymd(new Date());

  const summary = useMemo(() => nutritionSummary(nutrition, today), [nutrition, today]);
  const weekStart = weekStartOf(today);
  const checkIn = checkInFor(nutrition, weekStart);
  const coverage = weighInCoverage(summary.estimate);

  /*
   * The whole-athlete-state view WITH the nutrition facts folded in.
   *
   * Derived here rather than taken from `useDb().athleteState` on purpose. That
   * snapshot is the one `buildWeeklyPlan` and the Auto-Coached resolver read,
   * and nutrition is deliberately kept out of it — CLAUDE.md's amended rule
   * forbids nutrition editing a weekly plan, and the cheapest way to guarantee
   * that is for the planning snapshot never to carry a nutrition fact at all.
   * This second derivation is display-only. It is not a second opinion: every
   * field except `constraints` is provably identical (see
   * `packages/whole-athlete-state/test/nutrition-context.test.ts`), and the one
   * difference is the soft fuelling row printed below.
   */
  const fuelling = useMemo(() => {
    const core = db.core || ensureSharedCore(db).core!;
    const state = deriveAthleteState({ core, today, nutrition: nutritionContext(nutrition, today) });
    return state.constraints.find((c) => c.code === 'low_energy_availability') ?? null;
  }, [db, nutrition, today]);

  return (
    <div className="fixed inset-0 z-30 grid place-items-center" role="dialog" aria-modal="true" aria-label="Athlete nutrition">
      <button aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative max-h-[80vh] w-[min(460px,calc(100vw-32px))] overflow-y-auto rounded-md border border-line2 bg-panel3 p-2 shadow-2xl">
        <div className="flex items-baseline gap-1">
          <h2 className="text-sm font-semibold">Nutrition</h2>
          <span className="ml-auto text-[10px] uppercase tracking-wider text-dim">read-only</span>
        </div>
        <p className="mt-0.5 text-[11px] text-dim">
          The athlete's food log and their macro program belong to their account. You can see both from here; neither
          can be changed from the bench.
        </p>

        <Section title="Today">
          <Row label="Logged" value={`${round(summary.today.totals.calories)} kcal`} />
          <Row
            label="Target"
            // Absent, not zeroed: no target means no check-in has been
            // accepted, which is a different fact from a target of zero.
            value={summary.today.target ? `${round(summary.today.target.calories)} kcal` : 'none set'}
          />
          <Row
            label="Macros"
            value={`${round(summary.today.totals.proteinG)}P ${round(summary.today.totals.carbsG)}C ${round(summary.today.totals.fatG)}F`}
          />
        </Section>

        <Section title="Adherence">
          <Row
            label={`Days logged (last ${summary.adherence.windowDays})`}
            value={`${summary.adherence.loggedDays} · ${Math.round(summary.adherence.pct)}%`}
          />
          <Row
            label="Weigh-ins in the estimate window"
            value={coverage.windowDays > 0 ? `${coverage.weightDays} of ${coverage.windowDays}` : 'no window yet'}
          />
          {coverage.sparse ? (
            <p className="mt-0.5 rounded border border-line2 bg-panel2 p-1 text-[11px] text-muted">
              Thin weight signal. The smoothed trend repeats the last weight across the days between weigh-ins, so it
              reads flatter than the real change — which biases the expenditure estimate, and any target built on it,
              LOW. More weigh-ins are the only fix.
            </p>
          ) : null}
        </Section>

        <Section title="Program">
          <Row
            label="Goal"
            value={
              summary.goalRateKgPerWeek == null
                ? 'no program yet'
                : `${goalLabel(summary.goalRateKgPerWeek)}${
                    summary.goalRateKgPerWeek === 0 ? '' : ` ${Math.abs(summary.goalRateKgPerWeek)} kg/week`
                  }`
            }
          />
          <Row
            label="Weight trend"
            value={
              summary.trend.slopeKgPerWeek == null
                ? 'no trend yet'
                : `${summary.trend.slopeKgPerWeek > 0 ? '+' : ''}${summary.trend.slopeKgPerWeek.toFixed(2)} kg/week`
            }
          />
        </Section>

        <Section title="Expenditure">
          <Row
            label="Estimate"
            value={summary.estimate.estimateKcal == null ? 'none yet' : `${round(summary.estimate.estimateKcal)} kcal/day`}
          />
          <Row
            label="State"
            value={`${summary.estimate.state === 'holding' ? 'holding · ' : ''}${
              CONFIDENCE[summary.estimate.confidence] ?? summary.estimate.confidence
            }`}
          />
          {/* The engine's own sentence, verbatim. A paraphrase here is where a
              coach starts being told something the engine did not say. */}
          <p className="mt-0.5 text-[11px] text-muted">{summary.estimate.explanation}</p>
        </Section>

        <Section title="Weekly check-in">
          <Row label="Week" value={`${weekStart} – ${weekEndOf(weekStart)}`} />
          <Row label="State" value={STATUS_LINE[checkIn?.status ?? ''] ?? 'Not checked in yet'} />
        </Section>

        <Section title="Effect on training">
          {fuelling ? (
            <>
              <p className="text-[11px] text-text">{fuelling.reason}</p>
              <p className="mt-0.5 text-[11px] text-muted">{fuelling.adjustment}</p>
            </>
          ) : (
            <p className="text-[11px] text-muted">
              No fuelling constraint is active. Nutrition only ever contributes advisory context here.
            </p>
          )}
          <p className="mt-0.5 text-[11px] text-dim">
            Nutrition never schedules or edits a week, and never outranks a pain or illness flag. It shows up as
            context on the day, and nowhere else.
          </p>
        </Section>

        <div className="mt-1 flex">
          <button onClick={onClose} className="ml-auto rounded border border-line2 bg-panel px-1 py-0.5 text-xs text-muted">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-1 rounded border border-line bg-panel p-1">
      <h3 className="text-[10px] uppercase tracking-wider text-dim">{title}</h3>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline gap-1 text-xs">
      <span className="text-muted">{label}</span>
      <span className={cx('ml-auto tabular-nums text-text', tone)}>{value}</span>
    </div>
  );
}
