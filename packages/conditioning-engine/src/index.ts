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

/*
 * THE PROPOSAL BOUNDARY IS GONE (14 August 2026) — same cut as
 * `@hybrid/strength-engine`, same reason. `ConditioningProposalOptions`,
 * `ConditioningProposalInput` and `conditioningToProposal` existed to feed
 * the Coordinator, whose only caller was `@hybrid/coordinator-adapter`.
 * Both are deleted, so these had no consumer left.
 *
 * This package still owns modality, interval and cardiovascular
 * progression, which is the part that was never about scheduling.
 */

export interface ConditioningStateContext {
  settings: Settings;
  whoop?: WhoopSample | null;
  core?: SharedCoreState;
}
