import { measurementValue } from './performed';
import type { PerformedSetWithMeasurements, PerformedSet } from './performed';
import type { PrescribedSet } from './prescription';

export interface SessionLoad {
  tonnageKg: number;
  workReps: number;
  conditioningLoad: number;
}

export function sessionLoad(sets: PerformedSetWithMeasurements[]): SessionLoad {
  let tonnageKg = 0;
  let workReps = 0;
  for (const set of sets) {
    const reps = measurementValue(set, 'reps') ?? 0;
    const load = measurementValue(set, 'load');
    if (load != null) tonnageKg += reps * load;
    else workReps += reps;
  }
  return { tonnageKg, workReps, conditioningLoad: 0 };
}

export function intensity(sets: PerformedSetWithMeasurements[], workingMax: number): number | null {
  let repWeightedLoad = 0;
  let totalReps = 0;
  for (const set of sets) {
    const reps = measurementValue(set, 'reps');
    const load = measurementValue(set, 'load');
    if (reps == null || load == null) continue;
    repWeightedLoad += reps * load;
    totalReps += reps;
  }
  if (!totalReps || !workingMax) return null;
  return (repWeightedLoad / totalReps) / workingMax;
}

export function sessionCompliance(assigned: PrescribedSet[], performed: PerformedSet[]): number {
  const required = assigned.filter(s => !s.isOptional);
  if (!required.length) return 1;
  const done = required.filter(s => performed.some(p => p.prescribedSetId === s.id && p.status === 'completed'));
  return done.length / required.length;
}

export function blockCompliance(requiredSetIds: string[], performed: PerformedSet[]): number {
  if (!requiredSetIds.length) return 1;
  const done = requiredSetIds.filter(id => performed.some(p => p.prescribedSetId === id && p.status === 'completed'));
  return done.length / requiredSetIds.length;
}
