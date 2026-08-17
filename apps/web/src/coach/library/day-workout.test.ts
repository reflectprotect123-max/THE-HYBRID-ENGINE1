import { describe, expect, it } from 'vitest';
import type { Workout } from '@hybrid/engine';
import { dayBuilderToWorkouts, workoutsToDayBuilder, workoutToDayBuilder, INSTRUCTIONS_HEADING } from './day-workout';
import type { DayBuilderValue } from './DayBuilder';

/*
 * The day builder used to throw everything the coach typed away — both its
 * buttons were stubs that printed "not connected yet". This module is the
 * translation that lets it persist, so the property that matters most is that
 * a session survives the round trip UNCHANGED. A lossy save is worse than no
 * save: it silently rewrites a coach's programming.
 *
 * SINCE 17 AUGUST 2026 there is no exercise/set translation here at all —
 * strength authoring (`Exercise`, `StrengthBlock`, columns, sets, rest,
 * tempo, per-set RPE) was deleted whole with the category it belonged to. A
 * non-conditioning block is now a plain free-text `TextBlock`: a heading and
 * a body, nothing else. The conditioning half (`day-conditioning.test.ts`)
 * and the mixed-day sibling split it exercises are untouched.
 */

/** The day's single workout. Every case here authors one kind, so there is
 *  exactly one; the two-sibling cases live in day-conditioning.test.ts. */
function one(value: DayBuilderValue, opts: { id: string; date?: string; name?: string }) {
  const out = dayBuilderToWorkouts(value, opts);
  expect(out).toHaveLength(1);
  return out[0];
}

function value(): DayBuilderValue {
  return {
    instructions: 'Ease into it. Keep the pace conversational.',
    blocks: [
      { id: 'b0', category: 'Warm-up', note: 'Bike 5 min, dynamic stretching' },
      { id: 'b1', category: 'Cooldown', note: 'Foam roll, box breathing' },
    ],
  };
}

describe('dayBuilderToWorkouts', () => {
  it('survives a round trip unchanged', () => {
    const before = value();
    const after = workoutsToDayBuilder(dayBuilderToWorkouts(before, { id: 'w1', date: '2026-08-14' }));
    expect(after).toEqual(before);
  });

  it('carries the coach instructions as a real block the athlete can read', () => {
    const w = one(value(), { id: 'w1' });
    const first = w.blocks[0] as { kind?: string; heading?: string; body?: string };
    expect(first.kind).toBe('text');
    expect(first.heading).toBe(INSTRUCTIONS_HEADING);
    expect(first.body).toContain('Ease into it');
  });

  it('writes no instructions block when the coach wrote none', () => {
    const w = one({ instructions: '   ', blocks: [] }, { id: 'w1' });
    expect(w.blocks).toEqual([]);
  });

  it('schedules a dated session on that date and nothing else', () => {
    const w = one(value(), { id: 'w1', date: '2026-08-14' });
    expect(w.dates).toEqual(['2026-08-14']);
    expect(w.days).toBeUndefined();
  });

  it('leaves a library session unscheduled', () => {
    const w = one(value(), { id: 'w1' });
    expect(w.dates).toBeUndefined();
  });

  it('calls an all-conditioning session conditioning, and anything else the note-block kind', () => {
    const cond = one(
      { instructions: '', blocks: [{ id: 'b0', category: 'Conditioning' }] },
      { id: 'w1' },
    );
    expect(cond.kind).toBe('conditioning');
    expect(one(value(), { id: 'w2' }).kind).toBe('strength');
  });

  it('leaves an empty session with no kind at all rather than guessing one', () => {
    // types.ts: "Absent on a workout with no blocks yet: sanitizeDB infers a
    // kind, it never guesses one". Neither does this.
    expect(one({ instructions: '', blocks: [] }, { id: 'w1' }).kind).toBeUndefined();
  });
});

describe('workoutToDayBuilder', () => {
  it('opens an empty session as an empty builder, not a crash', () => {
    expect(workoutToDayBuilder({ id: 'w1', blocks: [] })).toEqual({ instructions: '', blocks: [] });
  });

  it('renders a conditioning block, which has no exercises, without dropping it', () => {
    const w: Workout = {
      id: 'w1',
      kind: 'conditioning',
      blocks: [{ id: 'b0', kind: 'conditioning', heading: 'Row', condFmt: 'steady' }],
    };
    const value = workoutToDayBuilder(w);
    expect(value.blocks).toHaveLength(1);
  });
});

/*
 * A WARM-UP/COOLDOWN/MOBILITY BLOCK, AS A TEXTBLOCK — the only shape left for
 * a non-conditioning block since strength authoring was deleted on
 * 17 August 2026.
 */
describe('a Warm-up/Cooldown/Mobility block <-> TextBlock round trip', () => {
  it('maps a note block onto a TextBlock, heading and body', () => {
    const w = one(
      { instructions: '', blocks: [{ id: 'b0', category: 'Warm-up', note: 'Bike, dynamic stretching' }] },
      { id: 'w1' },
    );
    const block = w.blocks[0] as { kind?: string; heading?: string; body?: string };
    expect(block.kind).toBe('text');
    expect(block.heading).toBe('Warm-up');
    expect(block.body).toBe('Bike, dynamic stretching');
  });

  it('falls the heading back to the category when the coach never named the section', () => {
    const w = one({ instructions: '', blocks: [{ id: 'b0', category: 'Cooldown' }] }, { id: 'w1' });
    const block = w.blocks[0] as { heading?: string };
    expect(block.heading).toBe('Cooldown');
  });

  it('carries a coach-given section name through as the TextBlock heading', () => {
    const w = one(
      { instructions: '', blocks: [{ id: 'b0', category: 'Mobility', heading: 'HIP OPENERS' }] },
      { id: 'w1' },
    );
    const block = w.blocks[0] as { heading?: string };
    expect(block.heading).toBe('HIP OPENERS');
  });

  it('matches the category case-insensitively, so a template\'s ALL-CAPS heading still round-trips as its category', () => {
    // Every session template writes its section names in caps ("WARM-UP") —
    // the same word as the category, styled differently. TextBlock has no
    // `category` field of its own (unlike CondBlock, which keeps one exactly
    // so this problem does not exist there), so the heading is the only
    // signal available, and it must be read back tolerantly.
    const before: DayBuilderValue = { instructions: '', blocks: [{ id: 'b0', category: 'Cooldown', heading: 'COOLDOWN' }] };
    const back = workoutsToDayBuilder(dayBuilderToWorkouts(before, { id: 'w1' }));
    expect(back.blocks[0]).toMatchObject({ category: 'Cooldown', heading: 'COOLDOWN' });
  });

  it('cannot recover a category from a heading unrelated to it — TextBlock has no category field of its own', () => {
    // A GENUINELY custom name ("HIP OPENERS" for a Mobility block) carries no
    // trace of the category it was authored under. This is the accepted
    // price of TextBlock's shape: the coach's WORDS survive exactly, but the
    // dropdown reopens on the default note category rather than the one they
    // actually chose. Same fallback `workoutToDayBuilder` uses for any
    // unrecognised heading authored elsewhere.
    const before: DayBuilderValue = {
      instructions: '',
      blocks: [{ id: 'b0', category: 'Mobility', heading: 'HIP OPENERS', note: '90/90s, couch stretch' }],
    };
    const after = workoutsToDayBuilder(dayBuilderToWorkouts(before, { id: 'w1' }));
    expect(after.blocks).toEqual([{ id: 'b0', category: 'Warm-up', heading: 'HIP OPENERS', note: '90/90s, couch stretch' }]);
  });

  it('writes no body key at all when the coach left the description empty', () => {
    const w = one({ instructions: '', blocks: [{ id: 'b0', category: 'Warm-up' }] }, { id: 'w1' });
    expect(w.blocks[0]).not.toHaveProperty('body');
  });

  it('drops whitespace-only notes rather than storing them', () => {
    const w = one({ instructions: '', blocks: [{ id: 'b0', category: 'Warm-up', note: '   ' }] }, { id: 'w1' });
    expect(w.blocks[0]).not.toHaveProperty('body');
  });

});

/*
 * A BLOCK'S FREE-TEXT NOTE — a block-level description, distinct from
 * `instructions` (the whole session) and from `CondBlock.note` (conditioning's
 * own field for the same idea). It round trips through the engine's
 * `TextBlock.body`.
 */
describe('a block\'s free-text note', () => {
  it('round-trips through a Warm-up block, trimmed', () => {
    const v = value();
    v.blocks[0].note = '  5 min bike, dynamic stretching  ';
    const back = workoutsToDayBuilder(dayBuilderToWorkouts(v, { id: 'w' }));
    expect(back.blocks[0].note).toBe('5 min bike, dynamic stretching');
  });

  it('is absent, not empty, when the coach never wrote one', () => {
    const before: DayBuilderValue = { instructions: '', blocks: [{ id: 'b0', category: 'Warm-up' }] };
    const back = workoutsToDayBuilder(dayBuilderToWorkouts(before, { id: 'w' }));
    expect(back.blocks[0]).not.toHaveProperty('note');
  });

  it('is independent of the whole-session `instructions`', () => {
    const v = value();
    v.blocks[0].note = 'Bike + dynamic stretching';
    const back = workoutsToDayBuilder(dayBuilderToWorkouts(v, { id: 'w' }));
    expect(back.instructions).toBe('Ease into it. Keep the pace conversational.');
    expect(back.blocks[0].note).toBe('Bike + dynamic stretching');
  });
});
