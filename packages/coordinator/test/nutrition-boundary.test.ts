import { describe, expect, it } from 'vitest';
import { emptySharedCore } from '@hybrid/shared-core';
import { deriveAthleteState, type NutritionContext } from '@hybrid/whole-athlete-state';
import { reconcileWeeklyPlan, type SessionProposal } from '../src';

/*
 * BOUNDARY 2 of CLAUDE.md's amended nutrition rule: nutrition never edits a
 * weekly plan.
 *
 * Tested here rather than in whole-athlete-state because this is the only file
 * in which the claim can be false. The Coordinator is the one layer allowed to
 * choose the week; if a nutrition fact can change what it schedules, the wall
 * is gone no matter what the state package's own tests say.
 *
 * The assertion is deliberately total — the ENTIRE plan, entries and decisions
 * and explanations, must be byte-identical with and without the most extreme
 * fuelling deficit the context type can express. A weaker assertion (same
 * number of entries, say) would pass while a nutrition signal quietly moved a
 * session to another day.
 */

const proposal = (over: Partial<SessionProposal>): SessionProposal => ({
  schemaVersion: 1,
  id: 'p-' + (over.id || 'x'),
  domain: 'strength',
  title: 'Strength session',
  durationMinutes: 45,
  effort: 'moderate',
  priority: 'preferred',
  goalWeight: 1,
  staleness: 0,
  tags: ['full_body'],
  estimatedLoad: 50,
  minimumSpacingDays: 1,
  sourceEngineVersion: 'test',
  sourceDomain: 'strength',
  ...over,
});

/** An athlete eating 800 kcal against a 3,200 kcal expenditure, logging every
 *  day — the loudest a nutrition fact is capable of being. */
const STARVING: NutritionContext = {
  windowDays: 7,
  loggedDays: 7,
  meanIntakeKcal: 800,
  estimatedExpenditureKcal: 3200,
};

const PROPOSALS = [
  proposal({ id: 'lower', domain: 'strength', title: 'Heavy lower', effort: 'hard', tags: ['heavy_lower'] }),
  proposal({ id: 'hiit', domain: 'conditioning', title: 'Intervals', effort: 'hard', tags: ['high_intensity'] }),
  proposal({ id: 'easy', domain: 'conditioning', title: 'Easy aerobic', effort: 'easy', tags: ['easy_aerobic'] }),
  proposal({ id: 'upper', domain: 'strength', title: 'Upper', effort: 'moderate', tags: ['upper'] }),
];

const planWith = (nutrition: NutritionContext | undefined, core = emptySharedCore(1)) => {
  const state = deriveAthleteState({ core, today: '2026-08-04', nutrition });
  return reconcileWeeklyPlan({
    weekStart: '2026-08-03',
    state,
    goals: core.goals,
    schedule: { ...core.schedule, availableDays: [1, 2, 3, 4, 5, 6, 7], strengthSessionsPerWeek: 2, conditioningSessionsPerWeek: 2 },
    now: 123,
    proposals: PROPOSALS,
  });
};

const painHoldCore = () => {
  const core = emptySharedCore(1);
  core.safety = { painHold: { active: true, areas: ['knee'], updatedAt: 1 }, illness: { status: 'clear', updatedAt: 1 } };
  return core;
};

describe('nutrition cannot reach the weekly plan', () => {
  it('produces the identical week with and without nutrition facts', () => {
    expect(planWith(STARVING)).toEqual(planWith(undefined));
  });

  it('still schedules a full week for a deeply underfuelled athlete', () => {
    // The point of the previous test stated positively: the constraint exists
    // (whole-athlete-state emits it) and the Coordinator is still free to plan.
    // A nutrition fact must not become a silent scheduling veto either.
    const out = planWith(STARVING);
    expect(out.entries.length).toBeGreaterThan(0);
    expect(out.decisions.some((d) => /nutrition|energy|fuel/i.test(d.explanation))).toBe(false);
  });

  it('leaves the pain-safety drop exactly as it was, deficit or no deficit', () => {
    /* BOUNDARY 3 at plan level: the hard flag decides, and the loud nutrition
       signal beside it changes neither the outcome nor the reason given. */
    const withFacts = planWith(STARVING, painHoldCore());
    const withoutFacts = planWith(undefined, painHoldCore());
    expect(withFacts).toEqual(withoutFacts);
    expect(withFacts.decisions.find((d) => d.proposalId === 'lower')?.reasonCode).toBe('dropped_pain_safety');
  });
});
