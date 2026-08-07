import { describe, expect, it } from 'vitest';
import { emptySharedCore } from '@hybrid/shared-core';
import { deriveAthleteState } from '@hybrid/whole-athlete-state';
import { buildWeeklyPlan, mondayOf, proposalsFromDB } from '.';
import type { EngineDB } from '@hybrid/engine';

const db: EngineDB = {
  workouts: [
    { id: 's', kind: 'strength', name: 'Lower A', days: [2], blocks: [{ id: 'b', exercises: [{ id: 'e', name: 'Squat', mode: 'reps_kg', sets: [{ t: '5', rpe: '7' }] }] }] },
    { id: 'c', kind: 'conditioning', name: 'Intervals', days: [4], blocks: [{ id: 'b', kind: 'conditioning', condFmt: 'intervals', effort: 'hard' }] },
  ],
  sessions: [],
  settings: {},
  core: emptySharedCore(1),
};

describe('coordinator adapter', () => {
  it('keeps the specialist proposal boundary small and typed', () => {
    const proposals = proposalsFromDB(db);
    expect(proposals.map((x) => x.domain).sort()).toEqual(['conditioning', 'strength']);
    expect(JSON.stringify(proposals)).not.toContain('aVal');
  });

  it('projects a deterministic weekly plan', () => {
    expect(mondayOf('2026-08-05')).toBe('2026-08-03');
    const core = emptySharedCore(1);
    const state = deriveAthleteState({ core, today: '2026-08-05' });
    const plan = buildWeeklyPlan(db, state, '2026-08-05', 123);
    expect(plan.writer).toBe('coordinator');
    expect(plan.entries.length).toBe(2);
    expect(plan.generatedAt).toBe(123);
  });
});
