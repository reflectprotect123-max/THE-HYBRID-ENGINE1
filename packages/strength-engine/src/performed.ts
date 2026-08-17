import type { MetricKey } from './metric';

export interface PerformedMeasurement {
  metricKey: MetricKey;
  value: number;
}

export interface PerformedSet {
  id: string;
  assignedSessionId: string;
  exerciseId: string;
  prescribedSetId: string | null;
  ordinal: number;
  status: 'completed' | 'skipped' | 'not_reached';
  performedAt: string;
  clientCreatedAt: string;
}

export interface PerformedSetWithMeasurements extends PerformedSet {
  measurements: PerformedMeasurement[];
}

export function measurementValue(set: PerformedSetWithMeasurements, key: MetricKey): number | null {
  return set.measurements.find(m => m.metricKey === key)?.value ?? null;
}
