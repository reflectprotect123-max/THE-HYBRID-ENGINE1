import {
  reconcileWeeklyPlan,
  type SessionProposal,
  type WeeklyPlan,
} from '@hybrid/coordinator';
import { conditioningToProposal } from '@hybrid/conditioning-engine';
import { ensureSharedCore, type EngineDB, type Workout } from '@hybrid/engine';
import { type AthleteStateSnapshot } from '@hybrid/whole-athlete-state';
import { strengthProposals } from '@hybrid/strength-engine';
import type { ProductDomain } from '@hybrid/shared-core';

export const COORDINATOR_ADAPTER_VERSION = '1.0.0';

function conditioningProposal(w: Workout): SessionProposal {
  const block = w.blocks.find((b) => b.kind === 'conditioning');
  return conditioningToProposal(
    {
      id: w.id,
      title: w.name || 'Conditioning session',
      format: block?.kind === 'conditioning' ? block.condFmt : undefined,
      effort: block?.kind === 'conditioning' ? block.effort : undefined,
      modality: block?.kind === 'conditioning' ? block.modality : undefined,
      preferredWeekdays: w.days?.map((x) => (x === 0 ? 7 : x)),
      preferredDates: w.dates,
    },
    { durationMinutes: block?.kind === 'conditioning' ? Number(block.minutes) || 30 : 30 },
  );
}

export function proposalsFromDB(db: EngineDB): SessionProposal[] {
  const strength = strengthProposals(db.workouts);
  const conditioning = db.workouts.filter((w) => w.kind === 'conditioning').map(conditioningProposal);
  return [...strength, ...conditioning];
}

export function mondayOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Build the current week from specialist proposals. This is a projection for
 * the athlete apps; it does not let either product rewrite the other's
 * workouts, and it does not claim to be a medical or physiological verdict.
 */
export function buildWeeklyPlan(
  db: EngineDB,
  state: AthleteStateSnapshot,
  today: string,
  now = Date.now(),
): WeeklyPlan {
  const current = ensureSharedCore(db, now);
  return reconcileWeeklyPlan({
    weekStart: mondayOf(today),
    proposals: proposalsFromDB(current),
    state,
    goals: current.core!.goals,
    schedule: current.core!.schedule,
    now,
  });
}

/**
 * Resolve an explicitly prepared proposal set against the same athlete facts
 * as the normal app projection. Coach tooling uses this boundary to steer
 * proposal inputs without acquiring a second weekly-plan writer.
 */
export function buildWeeklyPlanFromProposals(
  db: EngineDB,
  state: AthleteStateSnapshot,
  today: string,
  proposals: SessionProposal[],
  now = Date.now(),
): WeeklyPlan {
  const current = ensureSharedCore(db, now);
  return reconcileWeeklyPlan({
    weekStart: mondayOf(today),
    proposals,
    state,
    goals: current.core!.goals,
    schedule: current.core!.schedule,
    now,
  });
}

export type { AthleteStateSnapshot, ProductDomain, SessionProposal, WeeklyPlan };
