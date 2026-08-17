export * from './metric';
export * from './exercise';
export * from './rounding';
export * from './prescription';
export * from './resolve';
export * from './session';
export * from './performed';
export * from './e1rm';
export * from './workingMax';
export * from './pr';
export * from './load';

export interface StrengthBlockItem {
  id: string;
  kind: 'strength';
  exerciseId: string;
  groupingKey: string | null;
  sets: import('./prescription').PrescribedSet[];
}
