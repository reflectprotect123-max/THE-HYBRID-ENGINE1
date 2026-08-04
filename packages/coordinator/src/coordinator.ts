import type { AthleteGoals, WeeklySchedule } from '@hybrid/shared-core';
import type { AthleteStateSnapshot } from '@hybrid/whole-athlete-state';
import {
  COORDINATOR_SCHEMA_VERSION,
  type CoordinatorInput,
  type InterferenceTag,
  type LockedPlanEntry,
  type PlanDecision,
  type ProposalEffort,
  type SessionProposal,
  type SessionDomain,
  type ScheduledPlanEntry,
  type WeeklyPlan,
} from './types';

const DAY = 86_400_000;

const dateAt = (weekStart: string, offset: number): string => {
  const d = new Date(`${weekStart}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

const isoWeekday = (date: string): number => {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
};

const distance = (a: string, b: string): number => Math.round(Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY);

const effortIsHard = (effort: ProposalEffort, tags: InterferenceTag[]): boolean => effort === 'hard' || tags.includes('high_intensity');

const score = (p: SessionProposal, goals: AthleteGoals): number => {
  const priority = p.priority === 'must' ? 1000 : p.priority === 'preferred' ? 500 : 100;
  const goal = p.domain === 'strength' ? goals.priorities.strength : goals.priorities.conditioning;
  return priority + p.goalWeight * 100 + goal * 100 + p.staleness * 10 + (p.lockedDate ? 100 : 0);
};

const hasTag = (tags: InterferenceTag[], tag: InterferenceTag): boolean => tags.includes(tag);

const conflicts = (a: { effort: ProposalEffort; tags: InterferenceTag[] }, b: { effort: ProposalEffort; tags: InterferenceTag[] }): boolean => {
  if (effortIsHard(a.effort, a.tags) && effortIsHard(b.effort, b.tags)) return true;
  if ((hasTag(a.tags, 'heavy_lower') && hasTag(b.tags, 'high_intensity')) || (hasTag(b.tags, 'heavy_lower') && hasTag(a.tags, 'high_intensity'))) return true;
  if (hasTag(a.tags, 'pain_sensitive') && hasTag(b.tags, 'pain_sensitive')) return true;
  return false;
};

const availableDates = (schedule: WeeklySchedule, weekStart: string): string[] => {
  const blocked = new Set(schedule.blockedDates);
  return Array.from({ length: 7 }, (_, i) => dateAt(weekStart, i)).filter((date) =>
    schedule.availableDays.includes(isoWeekday(date)) && !blocked.has(date),
  );
};

const emptyDecision = (proposalId: string, reasonCode: PlanDecision['reasonCode'], explanation: string): PlanDecision => ({
  proposalId,
  action: 'dropped',
  reasonCode,
  explanation,
});

function safetyReason(p: SessionProposal, state: AthleteStateSnapshot): PlanDecision | null {
  if ((state.illness.status === 'active' || state.illness.status === 'suspected') && effortIsHard(p.effort, p.tags)) {
    return emptyDecision(p.id, 'dropped_illness_safety', 'High-intensity work is not automatically scheduled while an illness flag is active.');
  }
  if (state.constraints.some((c) => c.code === 'pain_hold_active' && c.hard) && (effortIsHard(p.effort, p.tags) || hasTag(p.tags, 'pain_sensitive'))) {
    return emptyDecision(p.id, 'dropped_pain_safety', 'Pain hold is active; this higher-risk proposal requires modification or reassessment first.');
  }
  return null;
}

function candidateDates(p: SessionProposal, dates: string[]): string[] {
  const preferred = new Set([...(p.preferredDates || []), ...(p.lockedDate ? [p.lockedDate] : [])]);
  const weekdays = new Set(p.preferredWeekdays || []);
  return dates.slice().sort((a, b) => {
    const rank = (date: string) => (preferred.has(date) ? 0 : weekdays.has(isoWeekday(date)) ? 1 : 2);
    return rank(a) - rank(b) || a.localeCompare(b);
  });
}

function domainCap(p: SessionProposal, schedule: WeeklySchedule, entries: Array<ScheduledPlanEntry | LockedPlanEntry>): boolean {
  const count = entries.filter((x) => x.domain === p.domain).length;
  const cap = p.domain === 'strength' ? schedule.strengthSessionsPerWeek : schedule.conditioningSessionsPerWeek;
  return count < cap;
}

function weeklyCap(schedule: WeeklySchedule, entries: Array<ScheduledPlanEntry | LockedPlanEntry>): boolean {
  return entries.length < (schedule.maxSessionsPerWeek ?? schedule.strengthSessionsPerWeek + schedule.conditioningSessionsPerWeek);
}

function canPlace(
  p: SessionProposal,
  date: string,
  entries: Array<ScheduledPlanEntry | LockedPlanEntry>,
): { ok: boolean; reasonCode?: PlanDecision['reasonCode']; explanation?: string } {
  const sameDay = entries.filter((x) => x.date === date);
  if (sameDay.some((x) => conflicts(p, x))) return { ok: false, reasonCode: 'dropped_interference', explanation: 'The proposed session conflicts with another high-interference session on that day.' };
  const sameDomain = entries.filter((x) => x.domain === p.domain);
  if (sameDomain.some((x) => distance(x.date, date) < p.minimumSpacingDays)) return { ok: false, reasonCode: 'dropped_spacing', explanation: `The proposal requires ${p.minimumSpacingDays} day(s) between sessions in this domain.` };
  return { ok: true };
}

export function reconcileWeeklyPlan(input: CoordinatorInput): WeeklyPlan {
  const dates = availableDates(input.schedule, input.weekStart);
  const entries: Array<ScheduledPlanEntry | LockedPlanEntry> = [...(input.lockedEntries || [])];
  const decisions: PlanDecision[] = (input.lockedEntries || []).map((x) => ({
    proposalId: x.proposalId || x.id,
    action: 'scheduled' as const,
    reasonCode: 'locked_existing' as const,
    explanation: 'Existing user-locked session preserved.',
  }));
  const proposals = input.proposals.slice().sort((a, b) => score(b, input.goals) - score(a, input.goals) || a.id.localeCompare(b.id));

  for (const p of proposals) {
    const safety = safetyReason(p, input.state);
    if (safety) {
      decisions.push(safety);
      continue;
    }
    if (!domainCap(p, input.schedule, entries)) {
      decisions.push(emptyDecision(p.id, 'dropped_domain_cap', `The ${p.domain} weekly cap is already full.`));
      continue;
    }
    if (!weeklyCap(input.schedule, entries)) {
      decisions.push(emptyDecision(p.id, 'dropped_weekly_cap', 'The weekly session cap is already full.'));
      continue;
    }
    const options = candidateDates(p, dates).filter((date) => !p.lockedDate || date === p.lockedDate);
    let placed: string | null = null;
    let lastFailure: { reasonCode: PlanDecision['reasonCode']; explanation: string } | null = null;
    for (const date of options) {
      const check = canPlace(p, date, entries);
      if (check.ok) {
        placed = date;
        break;
      }
      lastFailure = { reasonCode: check.reasonCode || 'dropped_no_available_slot', explanation: check.explanation || 'No compatible slot was found.' };
    }
    if (!placed) {
      decisions.push(emptyDecision(p.id, lastFailure?.reasonCode || 'dropped_no_available_slot', lastFailure?.explanation || 'No available day matches the schedule.'));
      continue;
    }
    const entry: ScheduledPlanEntry = {
      id: `plan-${p.id}-${placed}`,
      proposalId: p.id,
      date: placed,
      domain: p.domain,
      title: p.title,
      durationMinutes: p.durationMinutes,
      effort: p.effort,
      tags: p.tags.slice(),
      locked: false,
    };
    entries.push(entry);
    decisions.push({ proposalId: p.id, action: 'scheduled', reasonCode: 'accepted', explanation: `Placed on ${placed} without violating safety, spacing or interference rules.` });
  }

  const generatedAt = input.now ?? Date.now();
  return {
    schemaVersion: COORDINATOR_SCHEMA_VERSION,
    id: `weekly-${input.weekStart}`,
    weekStart: input.weekStart,
    generatedAt,
    writer: 'coordinator',
    entries: entries.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)),
    decisions,
  };
}

export type { AthleteGoals, AthleteStateSnapshot, WeeklySchedule };
