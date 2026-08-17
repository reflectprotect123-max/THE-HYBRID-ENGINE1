import type { MetricKey } from './metric';

export interface TempoTuple {
  eccentric: number;
  pauseBottom: number;
  concentric: number;
  pauseTop: number;
}

/** Packs a 4-digit tempo (e.g. 3010) into the single numeric column used by
 * both prescribed_target and performed_measurement. */
export function encodeTempo(t: TempoTuple): number {
  return t.eccentric * 1000 + t.pauseBottom * 100 + t.concentric * 10 + t.pauseTop;
}

export function decodeTempo(n: number): TempoTuple {
  return {
    eccentric: Math.floor(n / 1000) % 10,
    pauseBottom: Math.floor(n / 100) % 10,
    concentric: Math.floor(n / 10) % 10,
    pauseTop: n % 10,
  };
}

export interface PrescribedTarget {
  metricKey: MetricKey;
  literalValue?: number;
  rangeLo?: number;
  rangeHi?: number;
  exprKind?: 'pct_of_max' | 'lwp_delta' | 'pct_of_bodyweight' | 'rpe_autoreg';
  exprArg?: number;
  exprRefExercise?: string;
}

export interface PrescribedSet {
  id: string;
  ordinal: number;
  isOptional: boolean;
  isAmrap: boolean;
  targets: PrescribedTarget[];
}
