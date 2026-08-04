import type { SessionProposal } from '@hybrid/coordinator';
import type { SharedCoreState } from '@hybrid/shared-core';
import {
  conAdapt,
  condEffort,
  conPrescription,
  type CondFmtKey,
  type CondResult,
  type EffortKey,
  type Settings,
  type WhoopSample,
} from '@hybrid/engine';

export const CONDITIONING_ENGINE_VERSION = '1.0.0';

/** Conditioning owns modality, interval and cardiovascular progression. */
export { conAdapt, condEffort, conPrescription } from '@hybrid/engine';
export type { CondFmtKey, CondResult, EffortKey, Settings, WhoopSample } from '@hybrid/engine';

export interface ConditioningProposalOptions {
  priority?: SessionProposal['priority'];
  goalWeight?: number;
  staleness?: number;
  preferredWeekdays?: number[];
  preferredDates?: string[];
  lockedDate?: string;
  durationMinutes?: number;
  effort?: SessionProposal['effort'];
  tags?: SessionProposal['tags'];
}

export interface ConditioningProposalInput {
  id: string;
  title?: string;
  format?: CondFmtKey;
  effort?: EffortKey;
  modality?: string;
  preferredWeekdays?: number[];
  preferredDates?: string[];
}

export function conditioningToProposal(input: ConditioningProposalInput, options: ConditioningProposalOptions = {}): SessionProposal {
  const hard = options.effort === 'hard' || input.effort === 'hard' || input.format === 'tempo' || input.format === 'intervals';
  return {
    schemaVersion: 1,
    id: input.id,
    domain: 'conditioning',
    title: input.title || `${input.modality || 'Conditioning'} session`,
    durationMinutes: options.durationMinutes ?? 30,
    effort: options.effort ?? (hard ? 'hard' : input.effort === 'easy' ? 'easy' : 'moderate'),
    priority: options.priority ?? 'preferred',
    goalWeight: options.goalWeight ?? 1,
    staleness: options.staleness ?? 0,
    preferredWeekdays: options.preferredWeekdays ?? input.preferredWeekdays,
    preferredDates: options.preferredDates ?? input.preferredDates,
    lockedDate: options.lockedDate,
    tags: options.tags ?? (hard ? ['high_intensity'] : ['easy_aerobic']),
    estimatedLoad: hard ? 70 : 30,
    minimumSpacingDays: 1,
    sourceEngineVersion: CONDITIONING_ENGINE_VERSION,
    sourceDomain: 'conditioning',
  };
}

export interface ConditioningStateContext {
  settings: Settings;
  whoop?: WhoopSample | null;
  core?: SharedCoreState;
}
