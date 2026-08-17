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
  const upTo = events
    .filter(e => e.effectiveAt <= asOf)
    .sort((a, b) => b.effectiveAt.localeCompare(a.effectiveAt));
  if (!upTo.length) return null;
  const latest = upTo[0];
  const latestManual = upTo.find(e => e.source !== 'auto_estimate');
  if (latestManual && latestManual.effectiveAt >= latest.effectiveAt) return latestManual;
  return latest;
}
