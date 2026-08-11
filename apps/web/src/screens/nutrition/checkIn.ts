import { uid } from '@hybrid/engine';
import type { CheckIn, MacroProgramDay, MacroTotals } from '@hybrid/nutrition-core';
import { addDays, type WeeklyCheckIn } from '@hybrid/nutrition-engine';

/*
 * The weekly check-in's write path, kept out of the component — same reason
 * and same shape as `entry.ts`: pure functions with no store access, so they
 * can be pinned in this app's node-environment Vitest suite, and the calling
 * screen (`CheckIn.tsx`) does its own `update()` around them.
 *
 * Unlike `entry.ts`'s writers, `@hybrid/nutrition-core` has no
 * `logEntryFrom*`-style builder for a `CheckIn` row or a `MacroProgramDay` —
 * the same gap `Weight.tsx` documents for a `WeightEntry`. Mobile's
 * `CheckIn.tsx` builds both record shapes inline inside its `update` callback;
 * this module lifts that exact construction out to where it can be tested
 * without the DOM, rather than inventing a different write shape for web.
 *
 * THE STATE MACHINE (`docs/ADAPTIVE_ENGINE_CONTRACT.md`), unchanged from
 * mobile:
 *
 *   insufficient history/coverage -> HOLDING
 *   adequate intake + weight data -> UPDATING
 *   UPDATING + accepted check-in  -> next macro-program week
 *   UPDATING + declined check-in  -> preserve current program
 */

/**
 * The `CheckIn` row a run of the live engine result produces for `weekStart`.
 *
 * Mirrors mobile's inline row exactly: `'ready'` maps to `'pending'` (the
 * engine's word vs. the schema's — `CheckInStatus` has no `'ready'`),
 * `rawEstimateKcal` (not `estimateKcal`) is the observed figure because on a
 * held result `estimateKcal` is the carried-forward anchor, and
 * `proposedExpenditureKcal` is the expenditure (not the calorie target) since
 * `dampingAnchor` reads this field to anchor the following week.
 */
export function checkInRow(args: {
  existing: CheckIn | undefined;
  programId: string;
  weekStart: string;
  weekEnd: string;
  live: WeeklyCheckIn;
  at: string;
}): CheckIn {
  const { existing, programId, weekStart, weekEnd, live, at } = args;
  return {
    id: existing?.id ?? uid(),
    // Blank for the same reason every other local write in this slice leaves
    // it blank — see Weight.tsx / entry.ts.
    userId: existing?.userId ?? '',
    programId,
    weekStart,
    weekEnd,
    status: live.status === 'ready' ? 'pending' : 'held',
    previousExpenditureKcal: live.estimate.previousEstimateKcal,
    observedExpenditureKcal: live.estimate.rawEstimateKcal,
    proposedExpenditureKcal: live.estimate.estimateKcal,
    proposedCalories: live.targets?.calories ?? null,
    proposedProteinG: live.targets?.proteinG ?? null,
    proposedCarbsG: live.targets?.carbsG ?? null,
    proposedFatG: live.targets?.fatG ?? null,
    modules: live.modules,
    explanation: live.explanation,
    createdAt: existing?.createdAt ?? at,
    // Explicitly null: a week recomputed from resolved back to pending must
    // never keep a stamp saying it was settled.
    resolvedAt: null,
    updatedAt: at,
  };
}

/** The four target numbers a row carries, or null if any of them is missing —
 *  an accept with an incomplete proposal must write nothing. */
export function completeTarget(row: CheckIn): MacroTotals | null {
  const { proposedCalories, proposedProteinG, proposedCarbsG, proposedFatG } = row;
  if (proposedCalories == null || proposedProteinG == null || proposedCarbsG == null || proposedFatG == null) {
    return null;
  }
  return { calories: proposedCalories, proteinG: proposedProteinG, carbsG: proposedCarbsG, fatG: proposedFatG };
}

/**
 * The seven `MacroProgramDay` rows an accepted check-in writes onto the
 * program, starting the week after `weekStart`. `source: 'accepted_check_in'`
 * is required provenance — a persisted day that cannot say where its numbers
 * came from is the black box `MacroProgramDay`'s own contract forbids.
 */
export function acceptedDays(programId: string, nextWeekStart: string, target: MacroTotals, at: string): MacroProgramDay[] {
  const days: MacroProgramDay[] = [];
  for (let i = 0; i < 7; i += 1) {
    days.push({
      programId,
      targetDate: addDays(nextWeekStart, i),
      ...target,
      source: 'accepted_check_in',
      createdAt: at,
    });
  }
  return days;
}
