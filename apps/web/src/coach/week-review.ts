import type { Session } from '@hybrid/engine';
import type { WeeklyPlan } from '@hybrid/coordinator-adapter';
import type { LedgerEntry } from '../autocoach/ledger';

export type ReviewStatus = 'completed' | 'partial' | 'planned-not-logged' | 'unplanned';

export interface ReviewLedgerRow {
  id: string;
  date: string;
  domain: 'strength' | 'conditioning';
  status: ReviewStatus;
  plannedTitle: string | null;
  actualTitle: string | null;
  decisionReason: string;
}

export interface WeekReviewModel {
  weekStart: string;
  weekEnd: string;
  rows: ReviewLedgerRow[];
  dropped: WeeklyPlan['decisions'];
  safetyDrops: WeeklyPlan['decisions'];
  interventions: LedgerEntry[];
}

function addDays(iso: string, days: number): string {
  const value = new Date(`${iso}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function domainOf(session: Session): 'strength' | 'conditioning' {
  return session.kind === 'conditioning' ? 'conditioning' : 'strength';
}

function sameTitle(left: string | undefined, right: string): boolean {
  return (left ?? '').trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}

function statusFor(session: Session): Extract<ReviewStatus, 'completed' | 'partial'> {
  return session.status === 'completed' ? 'completed' : 'partial';
}

/**
 * Reconcile the Coordinator's resolved intent with recorded athlete work.
 *
 * Pairing is deliberately conservative: a stable workout id wins, followed by
 * an exact date/domain/title match. Ambiguous work stays unplanned rather than
 * being silently credited to a prescription it may not represent.
 */
export function buildWeekReview(
  plan: WeeklyPlan,
  sessions: Session[],
  interventions: LedgerEntry[],
): WeekReviewModel {
  const weekEnd = addDays(plan.weekStart, 6);
  const inWeek = sessions
    .filter((session) => session.date >= plan.weekStart && session.date <= weekEnd)
    .sort((a, b) => a.date.localeCompare(b.date));
  const unused = new Set(inWeek.map((session) => session.id));

  const rows: ReviewLedgerRow[] = plan.entries.map((entry) => {
    const exact = inWeek.find(
      (session) => unused.has(session.id) && session.workoutId === entry.proposalId,
    );
    const fallback = inWeek.find(
      (session) =>
        unused.has(session.id) &&
        session.date === entry.date &&
        domainOf(session) === entry.domain &&
        sameTitle(session.name, entry.title),
    );
    const actual = exact ?? fallback;
    if (actual) unused.delete(actual.id);

    return {
      id: `planned:${entry.id}`,
      date: entry.date,
      domain: entry.domain,
      status: actual ? statusFor(actual) : 'planned-not-logged',
      plannedTitle: entry.title,
      actualTitle: actual?.name ?? (actual ? entry.title : null),
      decisionReason:
        plan.decisions.find((decision) => decision.proposalId === entry.proposalId)?.explanation ??
        (entry.locked ? 'Carried forward as a locked entry.' : 'Accepted by the Coordinator.'),
    };
  });

  for (const session of inWeek) {
    if (!unused.has(session.id)) continue;
    rows.push({
      id: `actual:${session.id}`,
      date: session.date,
      domain: domainOf(session),
      status: 'unplanned',
      plannedTitle: null,
      actualTitle: session.name ?? (domainOf(session) === 'strength' ? 'Strength session' : 'Conditioning session'),
      decisionReason: 'Recorded work with no unambiguous resolved-plan match.',
    });
  }

  rows.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const dropped = plan.decisions.filter((decision) => decision.action === 'dropped');
  const safetyDrops = dropped.filter(
    (decision) =>
      decision.reasonCode === 'dropped_pain_safety' ||
      decision.reasonCode === 'dropped_illness_safety',
  );

  return {
    weekStart: plan.weekStart,
    weekEnd,
    rows,
    dropped,
    safetyDrops,
    interventions: interventions
      .filter((entry) => entry.date >= plan.weekStart && entry.date <= weekEnd)
      .sort((a, b) => b.at - a.at),
  };
}
