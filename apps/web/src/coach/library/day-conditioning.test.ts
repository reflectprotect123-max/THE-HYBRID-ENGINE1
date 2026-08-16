import { describe, expect, it } from 'vitest';
import { sanitizeDB } from '@hybrid/engine';
import type { CondBlock, Workout } from '@hybrid/engine';
import { dayBuilderToWorkouts, workoutsToDayBuilder, condSiblingId } from './day-workout';
import type { DayBuilderValue } from './DayBuilder';

/*
 * THE RULE THIS FILE EXISTS FOR.
 *
 * `sanitizeDB`'s `splitMixedWorkout` splits any workout holding BOTH
 * conditioning and non-conditioning blocks into two siblings on load — every
 * load, every cloud pull, every restore. It is not a quirk: types.ts states it
 * as a contract ("A 'strength' workout's blocks may never contain a CondBlock
 * again").
 *
 * So a day with lifting AND conditioning cannot be one workout. The builder
 * emits the two siblings ITSELF, using the engine's own derived id
 * (`<id>-cond`) and naming convention, and reads them back as one day. Verified
 * below by running the real `sanitizeDB` over the output: if the builder ever
 * emits something the engine would split, these tests fail rather than the
 * coach discovering it when their session silently becomes two.
 */

function mixedDay(): DayBuilderValue {
  return {
    instructions: 'Lift first, then row easy.',
    blocks: [
      {
        id: 'b0',
        category: 'Strength/Power',
        exercises: [{
          id: 'e0', name: 'Back squat', columnA: 'reps', columnB: 'weight_kg', rest: 90,
          sets: [{ id: 'e0-s0', a: '5', b: '100' }],
        }],
      },
      {
        id: 'b1',
        category: 'Conditioning',
        exercises: [],
        conditioning: { fmt: 'steady', modality: 'row', effort: 'easy', minutes: '20', targetDistanceM: '4000' },
      },
    ],
  };
}

describe('dayBuilderToWorkouts', () => {
  it('emits two workouts for a day that lifts and conditions', () => {
    const out = dayBuilderToWorkouts(mixedDay(), { id: 'w1', date: '2026-08-14' });
    expect(out).toHaveLength(2);
    expect(out[0].kind).toBe('strength');
    expect(out[1].kind).toBe('conditioning');
    expect(out[1].id).toBe(condSiblingId('w1'));
  });

  it('emits output the engine does not split — the whole point', () => {
    const out = dayBuilderToWorkouts(mixedDay(), { id: 'w1', date: '2026-08-14' });
    const after = sanitizeDB({ workouts: out }).workouts;
    expect(after.map((w) => w.id).sort()).toEqual(out.map((w) => w.id).sort());
  });

  it('schedules BOTH siblings on the day, so neither goes missing from the calendar', () => {
    const out = dayBuilderToWorkouts(mixedDay(), { id: 'w1', date: '2026-08-14' });
    expect(out.map((w) => w.dates)).toEqual([['2026-08-14'], ['2026-08-14']]);
  });

  it('emits ONE workout when the day is only conditioning', () => {
    const out = dayBuilderToWorkouts(
      {
        instructions: '',
        blocks: [{ id: 'b0', category: 'Mixed modal', exercises: [], conditioning: { fmt: 'free', modality: '', effort: 'medium', minutes: '30', targetDistanceM: '' } }],
      },
      { id: 'w1' },
    );
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('conditioning');
  });

  it('emits ONE workout when the day only lifts', () => {
    const out = dayBuilderToWorkouts(
      { instructions: '', blocks: [{ id: 'b0', category: 'Strength/Power', exercises: [] }] },
      { id: 'w1' },
    );
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('strength');
  });

  it('writes the coach note where a conditioning-only day can actually keep it', () => {
    // A TextBlock beside a CondBlock is exactly what splitMixedWorkout tears
    // apart, so the note rides on the block instead.
    const out = dayBuilderToWorkouts(
      {
        instructions: 'Keep it conversational.',
        blocks: [{ id: 'b0', category: 'Mixed modal', exercises: [], conditioning: { fmt: 'free', modality: '', effort: 'easy', minutes: '40', targetDistanceM: '' } }],
      },
      { id: 'w1' },
    );
    expect(out).toHaveLength(1);
    expect((out[0].blocks[0] as CondBlock).note).toBe('Keep it conversational.');
    expect(sanitizeDB({ workouts: out }).workouts).toHaveLength(1);
  });

  it('keeps the effort and its HR zone in lockstep, because every older read path uses the zone', () => {
    const out = dayBuilderToWorkouts(
      { instructions: '', blocks: [{ id: 'b0', category: 'Conditioning', exercises: [], conditioning: { fmt: 'tempo', modality: 'bike', effort: 'hard', minutes: '12', targetDistanceM: '' } }] },
      { id: 'w1' },
    );
    const block = out[0].blocks[0] as CondBlock;
    expect(block.effort).toBe('hard');
    expect(block.targetZone).toBe('high');
  });

  it('drops a duration that is not a number rather than storing NaN', () => {
    const out = dayBuilderToWorkouts(
      { instructions: '', blocks: [{ id: 'b0', category: 'Conditioning', exercises: [], conditioning: { fmt: 'steady', modality: '', effort: 'easy', minutes: 'about twenty', targetDistanceM: '' } }] },
      { id: 'w1' },
    );
    expect((out[0].blocks[0] as CondBlock).minutes).toBeUndefined();
  });

  it('leaves modality absent for a mixed-modal block, which is what mixed means', () => {
    const out = dayBuilderToWorkouts(
      { instructions: '', blocks: [{ id: 'b0', category: 'Mixed modal', exercises: [], conditioning: { fmt: 'free', modality: '', effort: 'medium', minutes: '30', targetDistanceM: '' } }] },
      { id: 'w1' },
    );
    expect((out[0].blocks[0] as CondBlock).modality).toBeUndefined();
  });

  it('prescribes no rest on a mixed-modal block — the rest timer stays the athlete’s choice', () => {
    const out = dayBuilderToWorkouts(
      { instructions: '', blocks: [{ id: 'b0', category: 'Mixed modal', exercises: [], conditioning: { fmt: 'free', modality: '', effort: 'medium', minutes: '30', targetDistanceM: '' } }] },
      { id: 'w1' },
    );
    expect(JSON.stringify(out[0])).not.toContain('rest');
  });
});

describe('workoutsToDayBuilder', () => {
  it('survives the round trip for a mixed day, both siblings back as one day', () => {
    const before = mixedDay();
    const after = workoutsToDayBuilder(dayBuilderToWorkouts(before, { id: 'w1', date: '2026-08-14' }));
    expect(after).toEqual(before);
  });

  it('survives the round trip for a conditioning-only day, note and all', () => {
    const before: DayBuilderValue = {
      instructions: 'Nose breathing throughout.',
      blocks: [{ id: 'b0', category: 'Mixed modal', exercises: [], conditioning: { fmt: 'free', modality: '', effort: 'easy', minutes: '45', targetDistanceM: '' } }],
    };
    expect(workoutsToDayBuilder(dayBuilderToWorkouts(before, { id: 'w1' }))).toEqual(before);
  });

  it('reads a conditioning workout authored elsewhere without inventing values', () => {
    const w: Workout = {
      id: 'w1',
      kind: 'conditioning',
      blocks: [{ id: 'b0', kind: 'conditioning', condFmt: 'intervals' }],
    };
    const value = workoutsToDayBuilder([w]);
    expect(value.blocks[0].conditioning).toEqual({
      fmt: 'intervals', modality: '', effort: 'easy', minutes: '', targetDistanceM: '',
    });
  });
});
