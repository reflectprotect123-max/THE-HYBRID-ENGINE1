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

/** A whole strength block — a container of one or more exercise entries, matching
 * how `strength_block_item.block_id` says one block contains many items. This is
 * the `Block<S>` union member; `StrengthBlockItem` above is the shape of a single
 * entry inside `items`, not a block on its own. */
export interface StrengthBlock {
  id: string;
  kind: 'strength';
  heading?: string;
  items: StrengthBlockItem[];
}
