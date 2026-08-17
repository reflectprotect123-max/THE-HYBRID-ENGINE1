export interface Equipment {
  id: string;
  name: string;
  incrementKg: number | null;
  rackValuesKg: number[] | null;
  rounding: 'down' | 'nearest' | 'none';
}

export interface Exercise {
  id: string;
  ownerId: string | null;
  name: string;
  videoAssetId: string | null;
  cues: string | null;
  equipment: Equipment | null;
  defaultMetrics: import('./metric').MetricKey[];
  referenceMaxExerciseId: string | null;
  trackAsExerciseId: string | null;
  e1rmFormula: 'epley' | 'brzycki';
}

export class CycleError extends Error {
  constructor(field: 'reference_max_exercise_id' | 'track_as_exercise_id') {
    super(`${field} must point at a root (depth <= 1)`);
    this.name = 'CycleError';
  }
}

/** Thin wrapper: recognizes the trigger's own error text and re-throws typed. */
export function toCycleError(pgError: { message?: string }): CycleError | null {
  if (!pgError.message) return null;
  if (pgError.message.includes('reference_max_exercise_id must point')) return new CycleError('reference_max_exercise_id');
  if (pgError.message.includes('track_as_exercise_id must point')) return new CycleError('track_as_exercise_id');
  return null;
}
