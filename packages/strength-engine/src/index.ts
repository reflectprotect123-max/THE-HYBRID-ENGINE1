import type { SharedCoreState } from '@hybrid/shared-core';
import {
  liftAdapt,
  nextWorkingWeight,
  prefillPrimary,
  type Exercise,
  type Profile,
  type Settings,
  type Session,
  type Workout,
  type WhoopSample,
} from '@hybrid/engine';

export const STRENGTH_ENGINE_VERSION = '1.0.0';

/** Strength owns lifting progression and performance interpretation. */
export { liftAdapt, nextWorkingWeight, prefillPrimary } from '@hybrid/engine';
export type { Exercise, Profile, Settings, Session, Workout, WhoopSample } from '@hybrid/engine';

/*
 * THE PROPOSAL BOUNDARY IS GONE (14 August 2026).
 *
 * `StrengthProposalOptions`, `workoutToStrengthProposal` and
 * `strengthProposals` lived here to hand a small versioned proposal to the
 * Coordinator, which arbitrated a week out of them. The Coordinator is
 * deleted, and nothing else ever called these — the only consumer was
 * `@hybrid/coordinator-adapter`, deleted with it.
 *
 * They are removed rather than kept as a no-op export. A proposal type with
 * no arbitrator is not a boundary, it is a shape nobody reads, and leaving it
 * would suggest the handoff still exists. Weeks are authored by a coach now
 * (see CLAUDE.md, "Who owns the week"); this package owns lifting
 * progression and performance interpretation, which is what remains below.
 */

export interface StrengthStateContext {
  settings: Settings;
  whoop?: WhoopSample | null;
  core?: SharedCoreState;
}

export type { Exercise as StrengthExercise };
