import type { AthleteEvent, RecoveryObservation } from '@hybrid/shared-core';
import type { Session, Workout } from '@hybrid/engine';

/**
 * Pure derivation for the weekly review card. No score, no rollup — raw
 * counts only. An "unknown" week (nothing checked in, nothing rated) reads
 * as zeros here, the same honesty rule `coach/trends.ts` and
 * `coach/AthleteStatus.tsx` already hold for readiness bands: absence of
 * data is never rendered as a fabricated positive.
 */

const DAY = 864e5;

function mondayMs(iso: string): number {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d.getTime();
}

function weekDates(today: string): string[] {
  const mon0 = mondayMs(today);
  return Array.from({ length: 7 }, (_, i) => new Date(mon0 + i * DAY).toISOString().slice(0, 10));
}

export interface WeeklySummary {
  weekStart: string;
  weekEnd: string;
  /** workout-day placements in the window — a recurring workout on 3 days counts 3 */
  plannedCount: number;
  completedCount: number;
  incompleteCount: number;
  /** days in the window with a recovery check-in reporting a pain area */
  painDays: number;
  /** days in the window with a recovery check-in reporting non-clear illness */
  illnessDays: number;
  feedbackCount: number;
  tagCounts: Record<string, number>;
}

/** Monday-through-Sunday window containing `today`. */
export function summarizeWeek(
  sessions: Session[],
  workouts: Workout[],
  recoveryObservations: RecoveryObservation[],
  feedbackEvents: AthleteEvent[],
  today: string,
): WeeklySummary {
  const dates = weekDates(today);
  const weekStart = dates[0]!;
  const weekEnd = dates[dates.length - 1]!;
  const dateSet = new Set(dates);

  let plannedCount = 0;
  for (const date of dates) {
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    for (const w of workouts) {
      const placed = (w.dates?.includes(date) ?? false) || (w.days?.includes(dow) ?? false);
      if (placed) plannedCount++;
    }
  }

  const weekSessions = sessions.filter((s) => dateSet.has(s.date));
  const completedCount = weekSessions.filter((s) => s.status === 'completed').length;
  const incompleteCount = weekSessions.filter((s) => s.status === 'incomplete').length;

  const weekRecovery = recoveryObservations.filter((r) => dateSet.has(r.date));
  const painDays = weekRecovery.filter((r) => (r.painAreas?.length ?? 0) > 0).length;
  const illnessDays = weekRecovery.filter((r) => r.illnessStatus != null && r.illnessStatus !== 'clear').length;

  const weekFeedback = feedbackEvents.filter(
    (e) => e.type === 'post_session_feedback' && dateSet.has(e.occurredAt.slice(0, 10)),
  );
  const tagCounts: Record<string, number> = {};
  for (const e of weekFeedback) {
    const rawTags = (e.payload as { tags?: unknown }).tags;
    const tags = Array.isArray(rawTags) ? rawTags.filter((t): t is string => typeof t === 'string') : [];
    for (const t of tags) tagCounts[t] = (tagCounts[t] ?? 0) + 1;
  }

  return {
    weekStart,
    weekEnd,
    plannedCount,
    completedCount,
    incompleteCount,
    painDays,
    illnessDays,
    feedbackCount: weekFeedback.length,
    tagCounts,
  };
}
