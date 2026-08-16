import { describe, expect, it } from 'vitest';
import { isWarmup } from '@hybrid/engine';
import type { Workout } from '@hybrid/engine';
import { dayBuilderToWorkouts, workoutsToDayBuilder, workoutToDayBuilder, INSTRUCTIONS_HEADING } from './day-workout';
import type { DayBuilderValue } from './DayBuilder';

/*
 * The day builder used to throw everything the coach typed away — both its
 * buttons were stubs that printed "not connected yet". This module is the
 * translation that lets it persist, so the property that matters most is that
 * a session survives the round trip UNCHANGED. A lossy save is worse than no
 * save: it silently rewrites a coach's programming.
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
            columnB: '', rest: 90,
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
            columnB: 'weight_kg', rest: 90,
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

describe('dayBuilderToWorkouts', () => {
  it('survives a round trip unchanged', () => {
    const before = value();
    const after = workoutsToDayBuilder(dayBuilderToWorkouts(before, { id: 'w1', date: '2026-08-14' }));
    expect(after).toEqual(before);
  });

  it('records the authored column pair, not just the closest engine mode', () => {
    // reps × meters has no exact ModeKey. Without `cols` the coach would
    // reopen the builder and find columns they never chose.
    //
    // Authored under a STRENGTH category on purpose: a Conditioning block is
    // a real `CondBlock` now and holds no exercises at all, so it has no
    // columns to preserve. See day-conditioning.test.ts.
    const w = one(
      {
        instructions: '',
        blocks: [{
          id: 'b0',
          category: 'Cooldown',
          exercises: [{ id: 'e0', name: 'Row', columnA: 'reps', columnB: 'meters', rest: 90, sets: [{ id: 's0', a: '4', b: '500' }] }],
        }],
      },
      { id: 'w1' },
    );
    const ex = (w.blocks[0] as { exercises: { cols?: { a: string; b: string } }[] }).exercises[0];
    expect(ex.cols).toEqual({ a: 'reps', b: 'meters' });
  });

  it('authors a TARGET, and never touches the fields the athlete logs into', () => {
    /*
     * THIS TEST ASSERTED THE BUG until 16 August 2026. It read
     * "puts each set value in the two slots the engine already has for them"
     * and expected `[aVal, aVal2]` to hold the coach's numbers — but those two
     * slots belong to the LOGGER. `emit.ts` says so in as many words: the
     * athlete's logger, never the coach, writes the actual-result fields, and
     * a target must never masquerade as a logged result.
     *
     * What it cost while it stood: `t` was empty, so `repFloorOf` returned 0
     * and the reps field opened at zero; `rpe` was empty, so every set was
     * judged against the 8.5 default centre the coach never chose. The WEIGHT
     * worked by accident, because the fold takes its opener from `aVal`.
     */
    const w = one(value(), { id: 'w1' });
    const squat = (w.blocks[2] as { exercises: { sets: { t?: string; aVal?: string; aVal2?: string; done?: boolean }[] }[] })
      .exercises[0];

    // Reps first, load behind an `@` — the engine's own documented encoding,
    // because `PlannedSet` is contractually exactly `{ t, rpe }`.
    expect(squat.sets.map((s) => s.t)).toEqual(['5 @100kg', '5 @105kg', '3 @110kg']);

    for (const set of squat.sets) {
      expect(set.aVal, 'aVal is the athlete’s').toBeUndefined();
      expect(set.aVal2, 'aVal2 is the athlete’s').toBeUndefined();
      expect(set.done, 'nothing is done until the athlete does it').toBeUndefined();
    }
  });

  it('carries the rest the coach authored, so the athlete gets a countdown', () => {
    /* `restAfter` returns null at zero, so before this field existed a coach's
       session ran with no rest timer at all — the countdown, the notification
       and the rest chip never fired for published work. */
    const w = one(value(), { id: 'w1' });
    const squat = (w.blocks[2] as { exercises: { rest?: number }[] }).exercises[0];
    expect(squat.rest).toBe(90);
  });

  it('names a reps-and-kilos pair as the engine names it', () => {
    const w = one(value(), { id: 'w1' });
    const squat = (w.blocks[2] as { exercises: { mode: string }[] }).exercises[0];
    expect(squat.mode).toBe('reps_kg');
  });

  it('marks a warm-up block as a warm-up, so its sets never earn a working weight', () => {
    const w = one(value(), { id: 'w1' });
    const warm = w.blocks[1] as { warmup?: boolean; heading?: string };
    expect(warm.warmup).toBe(true);
    expect(warm.heading).toBe('Warm-up');
    const strength = w.blocks[2] as { warmup?: boolean };
    expect(strength.warmup).toBeUndefined();
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

  it('calls an all-conditioning session conditioning, and anything else strength', () => {
    const cond = one(
      { instructions: '', blocks: [{ id: 'b0', category: 'Conditioning', exercises: [] }] },
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

  it('reads a workout authored somewhere else, target and all', () => {
    /*
     * The comment this replaces said it best and then settled for less:
     * "GuidedBuilder and Planner write `t`/`rpe`, never aVal/aVal2 or cols" —
     * true, and those two were RIGHT while this screen was the odd one out.
     * It expected `a` and `b` to come back EMPTY for a real target of five
     * reps, because the reader only knew how to look in the logger's fields.
     *
     * Now that `t` is where a target lives on both sides, a session authored
     * anywhere opens with its numbers in the builder's own cells.
     */
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
    /* The RPE comes back too, since 16 August 2026. Before the bench could
       author one it was dropped here, so opening a Planner-authored workout
       and saving it silently deleted the coach's RPE targets. */
    expect(value.blocks[0].exercises[0].sets).toEqual([{ id: 'e0-s0', a: '5', b: '', rpe: '8' }]);
    expect(value.blocks[0].exercises[0].columnA).toBe('reps');
    expect(value.blocks[0].exercises[0].columnB).toBe('weight_kg');
    // No `rest` on a workout authored before the field existed: the builder's
    // own default rather than a zero, which would mean "no rest at all".
    expect(value.blocks[0].exercises[0].rest).toBe(90);
  });

  it('ROUND TRIPS: what a coach types survives a save and a reopen', () => {
    /*
     * The property the two tests above could not express between them, and the
     * one that actually protects a coach's work. Anything `toPlannedSet` can
     * write and `splitPlannedSet` cannot read back is a field the builder
     * silently erases the next time the day is saved.
     */
    const before = value();
    const after = workoutToDayBuilder(one(before, { id: 'w1' }));

    const strength = after.blocks.find((b) => b.category === 'Strength/Power')!;
    expect(strength.exercises[0].sets.map((s) => [s.a, s.b])).toEqual([
      ['5', '100'],
      ['5', '105'],
      ['3', '110'],
    ]);
    expect(strength.exercises[0].columnA).toBe('reps');
    expect(strength.exercises[0].columnB).toBe('weight_kg');
    expect(strength.exercises[0].rest).toBe(90);
  });

  it('reads a percentage back as a percentage, not as kilos', () => {
    const w: Workout = {
      id: 'w1',
      blocks: [{
        id: 'b0',
        heading: 'Main',
        exercises: [{
          id: 'e0',
          name: 'Squat',
          mode: 'reps_kg',
          cols: { a: 'reps', b: 'weight_pct' },
          sets: [{ t: '5 @80%', rpe: '' }],
        }],
      }],
    };
    expect(workoutToDayBuilder(w).blocks[0].exercises[0].sets).toEqual([{ id: 'e0-s0', a: '5', b: '80' }]);
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

/*
 * THE SECOND WARM-UP, and the one the bench could not say until 16 August 2026.
 *
 * A "Warm-up" BLOCK is prep — the phone runs it as pieces, with no rating and
 * no rest — and that half has worked since the category existed. A warm-up SET
 * is a ramp inside an ordinary lift block, on the same movement, and the
 * engine has always known about it: `isWarmup` reads a leading `W` on `t`, the
 * fold drops those sets before pricing anything, and `liftMoves` refuses to
 * earn from them.
 *
 * Typing "W10" into a reps column happened to work, because the value lands in
 * `t` and `isWarmup` only reads the first character. Undiscoverable, and
 * indistinguishable from a typo.
 */
describe('warm-up sets', () => {
  const dayWith = (sets: { id: string; a: string; b: string; warm?: boolean }[]) => ({
    instructions: '',
    blocks: [{
      id: 'b0',
      category: 'Strength/Power',
      exercises: [{ id: 'e0', name: 'Back squat', columnA: 'reps', columnB: 'weight_kg', rest: 90, sets }],
    }],
  });

  const setsOf = (w: Workout): string[] =>
    (w.blocks[0] as { exercises: { sets: { t?: string }[] }[] }).exercises[0].sets.map((s) => s.t ?? '');

  it('writes W FIRST, because that is the only place isWarmup looks', () => {
    /* Marked anywhere else in the string and the set is a working one as far
       as the fold, `liftMoves` and `openingLoadFor` are concerned — which
       would teach the progression that the working weight is the empty bar. */
    const w = one(dayWith([
      { id: 's0', a: '10', b: '20', warm: true },
      { id: 's1', a: '5', b: '100' },
    ]), { id: 'w1' });
    expect(setsOf(w)).toEqual(['W10 @20kg', '5 @100kg']);
    expect(isWarmup({ t: setsOf(w)[0] })).toBe(true);
    expect(isWarmup({ t: setsOf(w)[1] })).toBe(false);
  });

  it('marks a bare warm-up with no reps written', () => {
    const w = one(dayWith([{ id: 's0', a: '', b: '', warm: true }]), { id: 'w1' });
    expect(setsOf(w)).toEqual(['W']);
    expect(isWarmup({ t: 'W' })).toBe(true);
  });

  it('round trips, and does not leave the W in the reps cell', () => {
    /* The cell is labelled Reps. Showing "W10" in it would be wrong on its own
       terms, and saving that back would put a second W on the front. */
    const before = dayWith([{ id: 's0', a: '10', b: '20', warm: true }, { id: 's1', a: '5', b: '100' }]);
    const after = workoutToDayBuilder(one(before, { id: 'w1' }));
    expect(after.blocks[0].exercises[0].sets).toEqual([
      { id: 'e0-s0', a: '10', b: '20', warm: true },
      { id: 'e0-s1', a: '5', b: '100' },
    ]);
  });

  it('carries no `warm` key at all on a working set', () => {
    /* An explicit false on every working set would round-trip as noise through
       every stored session, for a fact that is already expressed by absence. */
    const after = workoutToDayBuilder(one(dayWith([{ id: 's0', a: '5', b: '100' }]), { id: 'w1' }));
    expect('warm' in after.blocks[0].exercises[0].sets[0]).toBe(false);
  });
});

describe('EMOM pacing survives the round trip', () => {
  /*
   * Added 16 August 2026. The two clocks are stored as two fields and the
   * absence of `every` is what puts an exercise on plain rest, so a stored
   * zero would be noise on every straight exercise ever authored.
   */
  const dayWith = (over: Partial<{ rest: number; every: number }>) => ({
    instructions: '',
    blocks: [
      {
        id: 'b0',
        category: 'Strength/Power',
        exercises: [
          {
            id: 'e0',
            name: 'Back Squat',
            columnA: 'reps',
            columnB: 'weight_kg',
            rest: 90,
            sets: [{ id: 's0', a: '5', b: '100' }],
            ...over,
          },
        ],
      },
    ],
  });

  it('carries `every` out and back', () => {
    const back = workoutsToDayBuilder(dayBuilderToWorkouts(dayWith({ every: 150 }), { id: 'w' }));
    expect(back.blocks[0].exercises[0].every).toBe(150);
  });

  it('writes NO `every` key at all for an exercise on plain rest', () => {
    const [w] = dayBuilderToWorkouts(dayWith({}), { id: 'w' });
    const ex = (w.blocks?.[0] as { exercises: unknown[] }).exercises[0];
    expect(ex).not.toHaveProperty('every');
    expect(workoutsToDayBuilder([w]).blocks[0].exercises[0]).not.toHaveProperty('every');
  });

  it('drops a zero rather than storing it', () => {
    /* `restAfter` switches on `every > 0`, so 0 and absent mean the same
       thing. Storing the 0 would make two records differ over nothing. */
    const [w] = dayBuilderToWorkouts(dayWith({ every: 0 }), { id: 'w' });
    expect((w.blocks?.[0] as { exercises: unknown[] }).exercises[0]).not.toHaveProperty('every');
  });

  it('keeps the coach’s rest number alongside it, so switching back loses nothing', () => {
    const back = workoutsToDayBuilder(dayBuilderToWorkouts(dayWith({ every: 150 }), { id: 'w' }));
    expect(back.blocks[0].exercises[0]).toMatchObject({ rest: 90, every: 150 });
  });
});

describe('the coach’s target RPE reaches the set', () => {
  const day = (rpe?: string) => ({
    instructions: '',
    blocks: [
      {
        id: 'b0',
        category: 'Strength/Power',
        exercises: [
          {
            id: 'e0',
            name: 'Back Squat',
            columnA: 'reps',
            columnB: 'weight_kg',
            rest: 90,
            sets: [{ id: 's0', a: '5', b: '100', ...(rpe === undefined ? {} : { rpe }) }],
          },
        ],
      },
    ],
  });

  it('lands in `rpe`, not in `t`, and a RANGE is a valid value', () => {
    /* `rpeCenterOf` averages every number in the string, so "7-10" is a band
       centre of 8.5 rather than a parse failure. */
    const [w] = dayBuilderToWorkouts(day('7-10'), { id: 'w' });
    const set = (w.blocks?.[0] as { exercises: { sets: { t: string; rpe: string }[] }[] }).exercises[0].sets[0];
    expect(set).toEqual({ t: '5 @100kg', rpe: '7-10' });
  });

  it('round-trips, and an unset RPE comes back UNSET rather than empty', () => {
    /* Empty and absent mean the same thing to `rpeCenterOf` — the 8.5 default
       — but only one of them survives the identity assertion on this trip. */
    expect(workoutsToDayBuilder(dayBuilderToWorkouts(day('8'), { id: 'w' })).blocks[0].exercises[0].sets[0].rpe).toBe('8');
    expect(workoutsToDayBuilder(dayBuilderToWorkouts(day(), { id: 'w' })).blocks[0].exercises[0].sets[0]).not.toHaveProperty('rpe');
  });

  it('keeps DIFFERENT RPEs per set rather than flattening them', () => {
    /* The reason it is stored per set and not per exercise. */
    const value = day('9');
    value.blocks[0].exercises[0].sets.push({ id: 's1', a: '5', b: '100', rpe: '7' });
    const back = workoutsToDayBuilder(dayBuilderToWorkouts(value, { id: 'w' }));
    expect(back.blocks[0].exercises[0].sets.map((s) => s.rpe)).toEqual(['9', '7']);
  });
});
