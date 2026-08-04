import type { SessionProposal } from '@hybrid/coordinator';
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

export interface StrengthProposalOptions {
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

/**
 * Adapter boundary used by the Coordinator. The workout remains owned by the
 * Strength app; only a small, versioned proposal leaves this package.
 */
export function workoutToStrengthProposal(w: Workout, options: StrengthProposalOptions = {}): SessionProposal {
  const hasLower = /squat|deadlift|hinge|lunge|leg|clean|snatch/i.test(
    (w.blocks || []).flatMap((b) => b.kind === 'conditioning' || b.kind === 'text' ? [] : b.exercises || []).map((x) => x.name).join(' '),
  );
  return {
    schemaVersion: 1,
    id: w.id,
    domain: 'strength',
    title: w.name || 'Strength session',
    durationMinutes: options.durationMinutes ?? 45,
    effort: options.effort ?? 'moderate',
    priority: options.priority ?? 'preferred',
    goalWeight: options.goalWeight ?? 1,
    staleness: options.staleness ?? 0,
    preferredWeekdays: options.preferredWeekdays ?? w.days?.map((x) => x === 0 ? 7 : x),
    preferredDates: options.preferredDates ?? w.dates,
    lockedDate: options.lockedDate,
    tags: options.tags ?? (hasLower ? ['heavy_lower'] : ['full_body']),
    estimatedLoad: Math.max(0, (w.blocks || []).reduce((n, b) => n + (b.kind === 'conditioning' || b.kind === 'text' ? 0 : (b.exercises || []).length * 10), 0)),
    minimumSpacingDays: 1,
    sourceEngineVersion: STRENGTH_ENGINE_VERSION,
    sourceDomain: 'strength',
  };
}

export function strengthProposals(workouts: Workout[], options: StrengthProposalOptions = {}): SessionProposal[] {
  return workouts.filter((w) => w.kind !== 'conditioning').map((w) => workoutToStrengthProposal(w, options));
}

export interface StrengthStateContext {
  settings: Settings;
  whoop?: WhoopSample | null;
  core?: SharedCoreState;
}

export type { Exercise as StrengthExercise };
