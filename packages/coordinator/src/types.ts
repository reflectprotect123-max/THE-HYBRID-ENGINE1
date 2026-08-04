import type { AthleteGoals, ProductDomain, WeeklySchedule } from '@hybrid/shared-core';
import type { AthleteStateSnapshot } from '@hybrid/whole-athlete-state';

export const COORDINATOR_SCHEMA_VERSION = 1 as const;

export type SessionDomain = 'strength' | 'conditioning';
export type ProposalPriority = 'must' | 'preferred' | 'optional';
export type ProposalEffort = 'easy' | 'moderate' | 'hard';
export type InterferenceTag = 'heavy_lower' | 'high_intensity' | 'upper' | 'easy_aerobic' | 'full_body' | 'pain_sensitive';

export interface SessionProposal {
  schemaVersion: typeof COORDINATOR_SCHEMA_VERSION;
  id: string;
  domain: SessionDomain;
  title: string;
  durationMinutes: number;
  effort: ProposalEffort;
  priority: ProposalPriority;
  goalWeight: number;
  staleness: number;
  preferredWeekdays?: number[];
  preferredDates?: string[];
  lockedDate?: string;
  tags: InterferenceTag[];
  estimatedLoad: number;
  minimumSpacingDays: number;
  sourceEngineVersion: string;
  sourceDomain: ProductDomain;
}

export interface LockedPlanEntry {
  id: string;
  proposalId?: string;
  date: string;
  domain: SessionDomain;
  title: string;
  effort: ProposalEffort;
  tags: InterferenceTag[];
  locked: true;
}

export interface CoordinatorInput {
  weekStart: string;
  proposals: SessionProposal[];
  state: AthleteStateSnapshot;
  goals: AthleteGoals;
  schedule: WeeklySchedule;
  lockedEntries?: LockedPlanEntry[];
  now?: number;
}

export type PlanReasonCode =
  | 'accepted'
  | 'locked_existing'
  | 'dropped_illness_safety'
  | 'dropped_pain_safety'
  | 'dropped_domain_cap'
  | 'dropped_no_available_slot'
  | 'dropped_interference'
  | 'dropped_spacing'
  | 'dropped_weekly_cap';

export interface PlanDecision {
  proposalId: string;
  action: 'scheduled' | 'dropped';
  reasonCode: PlanReasonCode;
  explanation: string;
}

export interface ScheduledPlanEntry {
  id: string;
  proposalId: string;
  date: string;
  domain: SessionDomain;
  title: string;
  durationMinutes: number;
  effort: ProposalEffort;
  tags: InterferenceTag[];
  locked: false;
}

export interface WeeklyPlan {
  schemaVersion: typeof COORDINATOR_SCHEMA_VERSION;
  id: string;
  weekStart: string;
  generatedAt: number;
  writer: 'coordinator';
  entries: Array<ScheduledPlanEntry | LockedPlanEntry>;
  decisions: PlanDecision[];
}
