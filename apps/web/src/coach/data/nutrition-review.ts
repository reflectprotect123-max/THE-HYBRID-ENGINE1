import type { DayStatusValue, MacroProgram, NutritionDB } from '@hybrid/nutrition-core';
import {
  checkInFor,
  daySummary,
  latestWeighIn,
  macroOvershoot,
  nutritionSummary,
  trendSeries,
  weekStartOf,
  weighInCoverage,
  type DaySummary,
} from '@hybrid/nutrition-adapter';

export interface NutritionDayReview extends DaySummary {
  status: DayStatusValue;
}

export interface NutritionReviewException {
  id: string;
  priority: 'attention' | 'information';
  title: string;
  detail: string;
  next: string;
}

export interface CoachNutritionReview {
  weekStart: string;
  weekEnd: string;
  days: NutritionDayReview[];
  program: MacroProgram | null;
  summary: ReturnType<typeof nutritionSummary>;
  checkIn: ReturnType<typeof checkInFor>;
  latestWeight: ReturnType<typeof latestWeighIn>;
  weightSeries: ReturnType<typeof trendSeries>;
  coverage: ReturnType<typeof weighInCoverage>;
  exceptions: NutritionReviewException[];
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function statusFor(db: NutritionDB, summary: DaySummary): DayStatusValue {
  return db.dayStatus.find((status) => status.logDate === summary.date)?.status ??
    (summary.entryCount > 0 ? 'complete' : 'unlogged');
}

/** Pure, read-only projection for the coach nutrition surface. */
export function buildCoachNutritionReview(db: NutritionDB, today: string): CoachNutritionReview {
  const weekStart = weekStartOf(today);
  const weekEnd = addDays(weekStart, 6);
  const days = Array.from({ length: 7 }, (_, index) => {
    const summary = daySummary(db, addDays(weekStart, index));
    return { ...summary, status: statusFor(db, summary) };
  });
  const summary = nutritionSummary(db, today);
  const checkIn = checkInFor(db, weekStart);
  const coverage = weighInCoverage(summary.estimate);
  const missingDays = days.filter((day) => day.status === 'unlogged').length;
  const partialDays = days.filter((day) => day.status === 'partial').length;
  const exceptions: NutritionReviewException[] = [];

  if (!db.program) {
    exceptions.push({
      id: 'no-program',
      priority: 'information',
      title: 'No nutrition program',
      detail: 'The athlete has not established a calorie and macro program.',
      next: 'Discuss the goal before proposing targets.',
    });
  }
  if (checkIn?.status === 'pending') {
    exceptions.push({
      id: 'check-in-pending',
      priority: 'attention',
      title: 'Weekly proposal awaiting the athlete',
      detail: checkIn.explanation,
      next: 'Review the evidence and wait for the recorded athlete decision.',
    });
  } else if (checkIn?.status === 'held') {
    exceptions.push({
      id: 'check-in-held',
      priority: 'attention',
      title: 'Weekly check-in held',
      detail: checkIn.explanation,
      next: 'Resolve the missing input named by the engine; do not invent a target.',
    });
  }
  if (coverage.sparse) {
    exceptions.push({
      id: 'sparse-weigh-ins',
      priority: 'attention',
      title: 'Weight evidence is thin',
      detail: `${coverage.weightDays} weigh-in day${coverage.weightDays === 1 ? '' : 's'} across a ${coverage.windowDays}-day estimate window.`,
      next: 'Request another normal weigh-in before treating the trend as settled.',
    });
  }
  if (missingDays > 0 || partialDays > 0) {
    exceptions.push({
      id: 'logging-coverage',
      priority: 'information',
      title: 'The week contains incomplete evidence',
      detail: `${missingDays} unlogged and ${partialDays} partial day${missingDays + partialDays === 1 ? '' : 's'}.`,
      next: 'Read averages only across declared, countable days.',
    });
  }
  const target = summary.today.target;
  if (target) {
    const contradiction = macroOvershoot(target);
    if (contradiction.overKcal > 0) {
      exceptions.push({
        id: 'macro-overshoot',
        priority: 'attention',
        title: 'Macro target exceeds calorie target',
        detail: `The listed macros total ${Math.round(contradiction.macroCalories)} kcal, ${Math.round(contradiction.overKcal)} kcal above the target.`,
        next: 'Show the contradiction; do not silently rebalance the engine output.',
      });
    }
  }

  return {
    weekStart,
    weekEnd,
    days,
    program: db.program,
    summary,
    checkIn,
    latestWeight: latestWeighIn(db),
    weightSeries: trendSeries(db, today, 28),
    coverage,
    exceptions,
  };
}
