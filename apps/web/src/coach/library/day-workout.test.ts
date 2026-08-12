import { describe, expect, it } from 'vitest';
import type { Workout } from '@hybrid/engine';
import { dayBuilderToWorkout, workoutToDayBuilder, INSTRUCTIONS_HEADING } from './day-workout';
import type { DayBuilderValue } from './DayBuilder';

/*
 * The day builder used to throw everything the coach typed away — both its
 * buttons were stubs that printed "not connected yet". This module is the
 * translation that lets it persist, so the property that matters most is that
 * a session survives the round trip UNCHANGED. A lossy save is worse than no
 * save: it silently rewrites a coach's programming.
 */

function value(): DayBuilderValue {
  return {
    instructions: 'Ease into it. Stop the top set if the bar slows.',
    blocks: [
      {
        id: 'b0',
        category: 'Warm-up',
        exercises: [
          {
            id: 'e0',
            name: 'Bike',
            columnA: 'seconds',
            columnB: '',
            sets: [{ id: 'e0-s0', a: '300', b: '' }],
          },
        ],
      },
      {
        id: 'b1',
        category: 'Strength/Power',
        exercises: [
          {
            id: 'e1',
            name: 'Back squat',
            columnA: 'reps',
            columnB: 'weight_kg',
            sets: [
              { id: 'e1-s0', a: '5', b: '100' },
              { id: 'e1-s1', a: '5', b: '105' },
              { id: 'e1-s2', a: '3', b: '110' },
            ],
          },
        ],
      },
    ],
  };
}

describe('dayBuilderToWorkout', () => {
  it('survives a round trip unchanged', () => {
    const before = value();
    const after = workoutToDayBuilder(dayBuilderToWorkout(before, { id: 'w1', date: '2026-08-14' }));
    expect(after).toEqual(before);
  });

  it('records the authored column pair, not just the closest engine mode', () => {
    // reps × meters has no exact ModeKey. Without `cols` the coach would
    // reopen the builder and find columns they never chose.
    const w = dayBuilderToWorkout(
      {
        instructions: '',
        blocks: [{
          id: 'b0',
          category: 'Conditioning',
          exercises: [{ id: 'e0', name: 'Row', columnA: 'reps', columnB: 'meters', sets: [{ id: 's0', a: '4', b: '500' }] }],
        }],
      },
      { id: 'w1' },
    );
    const ex = (w.blocks[0] as { exercises: { cols?: { a: string; b: string } }[] }).exercises[0];
    expect(ex.cols).toEqual({ a: 'reps', b: 'meters' });
  });

  it('puts each set value in the two slots the engine already has for them', () => {
    const w = dayBuilderToWorkout(value(), { id: 'w1' });
    const squat = (w.blocks[2] as { exercises: { sets: { aVal?: string; aVal2?: string }[] }[] }).exercises[0];
    expect(squat.sets.map((s) => [s.aVal, s.aVal2])).toEqual([['5', '100'], ['5', '105'], ['3', '110']]);
  });

  it('names a reps-and-kilos pair as the engine names it', () => {
    const w = dayBuilderToWorkout(value(), { id: 'w1' });
    const squat = (w.blocks[2] as { exercises: { mode: string }[] }).exercises[0];
    expect(squat.mode).toBe('reps_kg');
  });

  it('marks a warm-up block as a warm-up, so its sets never earn a working weight', () => {
    const w = dayBuilderToWorkout(value(), { id: 'w1' });
    const warm = w.blocks[1] as { warmup?: boolean; heading?: string };
    expect(warm.warmup).toBe(true);
    expect(warm.heading).toBe('Warm-up');
    const strength = w.blocks[2] as { warmup?: boolean };
    expect(strength.warmup).toBeUndefined();
  });

  it('carries the coach instructions as a real block the athlete can read', () => {
    const w = dayBuilderToWorkout(value(), { id: 'w1' });
    const first = w.blocks[0] as { kind?: string; heading?: string; body?: string };
    expect(first.kind).toBe('text');
    expect(first.heading).toBe(INSTRUCTIONS_HEADING);
    expect(first.body).toContain('Ease into it');
  });

  it('writes no instructions block when the coach wrote none', () => {
    const w = dayBuilderToWorkout({ instructions: '   ', blocks: [] }, { id: 'w1' });
    expect(w.blocks).toEqual([]);
  });

  it('schedules a dated session on that date and nothing else', () => {
    const w = dayBuilderToWorkout(value(), { id: 'w1', date: '2026-08-14' });
    expect(w.dates).toEqual(['2026-08-14']);
    expect(w.days).toBeUndefined();
  });

  it('leaves a library session unscheduled', () => {
    const w = dayBuilderToWorkout(value(), { id: 'w1' });
    expect(w.dates).toBeUndefined();
  });

  it('calls an all-conditioning session conditioning, and anything else strength', () => {
    const cond = dayBuilderToWorkout(
      { instructions: '', blocks: [{ id: 'b0', category: 'Conditioning', exercises: [] }] },
      { id: 'w1' },
    );
    expect(cond.kind).toBe('conditioning');
    expect(dayBuilderToWorkout(value(), { id: 'w2' }).kind).toBe('strength');
  });

  it('leaves an empty session with no kind at all rather than guessing one', () => {
    // types.ts: "Absent on a workout with no blocks yet: sanitizeDB infers a
    // kind, it never guesses one". Neither does this.
    expect(dayBuilderToWorkout({ instructions: '', blocks: [] }, { id: 'w1' }).kind).toBeUndefined();
  });
});

describe('workoutToDayBuilder', () => {
  it('opens an empty session as an empty builder, not a crash', () => {
    expect(workoutToDayBuilder({ id: 'w1', blocks: [] })).toEqual({ instructions: '', blocks: [] });
  });

  it('reads a workout authored somewhere else without inventing columns for it', () => {
    // GuidedBuilder and Planner write `t`/`rpe`, never aVal/aVal2 or cols. The
    // builder must open those too — showing empty cells, not fabricated ones.
    const w: Workout = {
      id: 'w1',
      blocks: [{
        id: 'b0',
        heading: 'Main',
        exercises: [{ id: 'e0', name: 'Bench', mode: 'reps_kg', sets: [{ t: '5', rpe: '8' }] }],
      }],
    };
    const value = workoutToDayBuilder(w);
    expect(value.blocks[0].exercises[0].name).toBe('Bench');
    expect(value.blocks[0].exercises[0].sets).toEqual([{ id: 'e0-s0', a: '', b: '' }]);
    expect(value.blocks[0].exercises[0].columnA).toBe('reps');
    expect(value.blocks[0].exercises[0].columnB).toBe('weight_kg');
  });

  it('renders a conditioning block, which has no exercises, as an empty block rather than dropping it', () => {
    const w: Workout = {
      id: 'w1',
      kind: 'conditioning',
      blocks: [{ id: 'b0', kind: 'conditioning', heading: 'Row', condFmt: 'steady' }],
    };
    const value = workoutToDayBuilder(w);
    expect(value.blocks).toHaveLength(1);
    expect(value.blocks[0].exercises).toEqual([]);
  });

  it('maps an unrecognised block heading to a real category rather than a blank dropdown', () => {
    const w: Workout = {
      id: 'w1',
      blocks: [{ id: 'b0', heading: 'Accessories', exercises: [] }],
    };
    expect(workoutToDayBuilder(w).blocks[0].category).toBe('Strength/Power');
  });
});
