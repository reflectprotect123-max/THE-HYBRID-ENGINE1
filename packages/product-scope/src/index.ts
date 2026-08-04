export const PRODUCT_SCOPE_SCHEMA_VERSION = 1 as const;

export type ProductId = 'strength' | 'conditioning';

export interface ProductDefinition {
  id: ProductId;
  name: string;
  shortName: string;
  owns: string[];
  canRead: string[];
  canWrite: string[];
  primaryAction: string;
}

const DEFINITIONS: Record<ProductId, ProductDefinition> = {
  strength: {
    id: 'strength',
    name: 'THE Strength System',
    shortName: 'Strength',
    owns: ['exercise selection', 'sets', 'reps', 'load', 'RPE/RIR', 'e1RM', 'lifting progression'],
    canRead: ['shared-core', 'whole-athlete-state', 'conditioning summaries', 'coordinator weekly plan'],
    canWrite: ['strength sessions', 'strength proposals', 'strength progression'],
    primaryAction: 'Start strength session',
  },
  conditioning: {
    id: 'conditioning',
    name: 'THE Conditioning System',
    shortName: 'Conditioning',
    owns: ['modality', 'interval structure', 'heart-rate targets', 'pace/power/cadence', 'conditioning progression'],
    canRead: ['shared-core', 'whole-athlete-state', 'strength summaries', 'coordinator weekly plan'],
    canWrite: ['conditioning sessions', 'conditioning proposals', 'conditioning progression'],
    primaryAction: 'Start conditioning session',
  },
};

export function parseProductId(value: unknown, fallback: ProductId = 'strength'): ProductId {
  return value === 'conditioning' ? 'conditioning' : value === 'strength' ? 'strength' : fallback;
}

export function productDefinition(id: ProductId): ProductDefinition {
  return DEFINITIONS[id];
}

export function allProductDefinitions(): ProductDefinition[] {
  return [DEFINITIONS.strength, DEFINITIONS.conditioning];
}
