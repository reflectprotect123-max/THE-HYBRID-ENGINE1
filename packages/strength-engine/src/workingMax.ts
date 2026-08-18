import type { E1rmFormula } from './e1rm';

export interface WorkingMaxEvent {
  id: string;
  athleteId: string;
  exerciseId: string;
  valueKg: number;
  source: 'auto_estimate' | 'coach_set' | 'athlete_set' | 'test_result';
  formula: E1rmFormula | null;
  fromSetId: string | null;
  effectiveAt: string;
}

export function currentWorkingMax(events: WorkingMaxEvent[], asOf: string): WorkingMaxEvent | null {
  // `asOf` (ResolveCtx.scheduledDate) is date-only, e.g. '2026-08-20', while
  // `effectiveAt` is a full ISO timestamp. A raw string compare puts the
  // date-only value BEFORE any timestamp on the same day, so an event set
  // earlier that same day would compare as "after" asOf and vanish. Normalize
  // to end-of-day so same-day events are visible.
  const asOfEnd = asOf.length === 10 ? `${asOf}T23:59:59.999Z` : asOf;
  const upTo = events
    .filter(e => e.effectiveAt <= asOfEnd)
    .sort((a, b) => b.effectiveAt.localeCompare(a.effectiveAt));
  if (!upTo.length) return null;
  const latest = upTo[0];
  const latestManual = upTo.find(e => e.source !== 'auto_estimate');
  if (latestManual && latestManual.effectiveAt >= latest.effectiveAt) return latestManual;
  return latest;
}
