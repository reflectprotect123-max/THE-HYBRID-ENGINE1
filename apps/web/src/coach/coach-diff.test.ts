import { describe, expect, it } from 'vitest';
import type { SlimPlan } from './bench-store';
import { diffPlans } from './diff';
import { deriveOnboarding, onboardingProgress } from './onboarding';

const plan = (over: Partial<SlimPlan>): SlimPlan => ({
  weekStart: '2026-08-03',
  entries: [],
  drops: [],
  ...over,
});

const entry = (proposalId: string, date: string, title: string) => ({
  proposalId,
  date,
  title,
  domain: 'strength' as const,
  locked: false,
});

describe('diffPlans', () => {
  it('is silent with no baseline or across different weeks', () => {
    expect(diffPlans(null, plan({}))).toEqual([]);
    expect(diffPlans(plan({ weekStart: '2026-07-27' }), plan({}))).toEqual([]);
  });

  it('reports added, moved, and removed entries by proposal identity', () => {
    const prev = plan({ entries: [entry('a', '2026-08-04', 'Heavy Lower'), entry('b', '2026-08-06', 'Row')] });
    const next = plan({ entries: [entry('a', '2026-08-05', 'Heavy Lower'), entry('c', '2026-08-07', 'Intervals')] });
    const lines = diffPlans(prev, next);
    expect(lines.map((l) => l.kind).sort()).toEqual(['added', 'moved', 'removed']);
    expect(lines.find((l) => l.kind === 'moved')!.text).toBe('Heavy Lower moved 08-04 → 08-05');
    expect(lines.find((l) => l.kind === 'removed')!.text).toBe('Row no longer scheduled');
  });

  it('reports only NEW drops, not ones already reviewed into the baseline', () => {
    const d = { proposalId: 'x', reasonCode: 'dropped_spacing', explanation: 'Spacing conflict.' };
    expect(diffPlans(plan({ drops: [d] }), plan({ drops: [d] }))).toEqual([]);
    const lines = diffPlans(plan({}), plan({ drops: [d] }));
    expect(lines).toEqual([{ kind: 'new-drop', text: 'New drop — Spacing conflict.' }]);
  });

  it('finds nothing when plans are identical', () => {
    const p = plan({ entries: [entry('a', '2026-08-04', 'Heavy Lower')] });
    expect(diffPlans(p, p)).toEqual([]);
  });
});

describe('deriveOnboarding', () => {
  const base = {
    hasCore: true,
    availableDays: 4,
    hasPrimaryGoal: true,
    whoopConnected: true,
    c2Connected: true,
    plannedWorkouts: 2,
    loggedSessions: 5,
    skips: {},
  };

  it('is complete when every step is observably done', () => {
    const steps = deriveOnboarding(base);
    expect(steps.every((s) => s.done)).toBe(true);
    expect(onboardingProgress(steps).complete).toBe(true);
  });

  it('derives incompleteness from real state, per step', () => {
    const steps = deriveOnboarding({ ...base, whoopConnected: false, loggedSessions: 0 });
    const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
    expect(byId['whoop']!.done).toBe(false);
    expect(byId['log']!.done).toBe(false);
    expect(onboardingProgress(steps)).toEqual({ done: 5, total: 7, complete: false });
  });

  it('skipped integrations leave the checklist completable, but a skip never hides a done step', () => {
    const steps = deriveOnboarding({ ...base, whoopConnected: false, skips: { whoop: 1 } });
    const whoop = steps.find((s) => s.id === 'whoop')!;
    expect(whoop.skipped).toBe(true);
    expect(onboardingProgress(steps)).toEqual({ done: 6, total: 6, complete: true });
    const doneAnyway = deriveOnboarding({ ...base, skips: { whoop: 1 } });
    expect(doneAnyway.find((s) => s.id === 'whoop')!.skipped).toBe(false);
  });

  it('only integrations are skippable — the core loop is not', () => {
    const steps = deriveOnboarding(base);
    expect(steps.filter((s) => s.skippable).map((s) => s.id)).toEqual(['whoop', 'c2']);
  });
});
