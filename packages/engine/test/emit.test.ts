/*
 * The coach → athlete boundary.
 *
 * This is the only place a coach's writing becomes an athlete's session, and
 * the only thing preventing a published plan from overwriting logged work. It
 * gets tested directly rather than through either app.
 */
import { describe, expect, it } from 'vitest';
import { FORBIDDEN_SET_KEYS, MODE_KEYS, emit } from '../src/index';

describe('a planned set is exactly {t, rpe}', () => {
  it('newSet emits nothing else, whatever it is handed', () => {
    expect(Object.keys(emit.newSet('5', '8')).sort()).toEqual(['rpe', 't']);
    expect(emit.newSet()).toEqual({ t: '', rpe: '' });
    expect(emit.newSet(null, undefined)).toEqual({ t: '', rpe: '' });
    // Numbers become strings — the athlete app parses `t` by pattern, and a
    // number here would break `max`, ranges, and the W warm-up marker.
    expect(emit.newSet(5, 8)).toEqual({ t: '5', rpe: '8' });
  });
});

describe('assertWorkout', () => {
  const good = () =>
    emit.newWorkout('Day 1', [
      emit.newBlock('Main', [emit.newEx('Back Squat', 'reps_kg', [emit.newSet('5', '8')])]),
      emit.newCondBlock('Finisher', 'intervals', 'hard'),
    ]);

  it('accepts a well-formed session', () => {
    expect(() => emit.assertWorkout(good())).not.toThrow();
  });

  it('REFUSES a set carrying any logger-owned field', () => {
    for (const key of FORBIDDEN_SET_KEYS) {
      const w = good();
      const sets = (w.blocks[0] as unknown as { exercises: { sets: Record<string, unknown>[] }[] }).exercises[0]
        .sets;
      sets[0][key] = 'x';
      expect(() => emit.assertWorkout(w), key).toThrow(new RegExp(`logger field "${key}"`));
    }
  });

  it('refuses a bogus mode, format, zone or effort', () => {
    const badMode = good();
    (badMode.blocks[0] as unknown as { exercises: { mode: string }[] }).exercises[0].mode = 'nonsense';
    expect(() => emit.assertWorkout(badMode)).toThrow(/bad mode/);

    expect(() => emit.assertWorkout({ blocks: [{ kind: 'conditioning', condFmt: 'nope', targetZone: 'mod' }] })).toThrow(
      /bad condFmt/,
    );
    expect(() =>
      emit.assertWorkout({ blocks: [{ kind: 'conditioning', condFmt: 'intervals', targetZone: 'nope' }] }),
    ).toThrow(/bad targetZone/);
    expect(() =>
      emit.assertWorkout({ blocks: [{ kind: 'conditioning', condFmt: 'intervals', targetZone: 'mod', effort: 'nope' }] }),
    ).toThrow(/bad effort/);
  });

  it('refuses a workout that is not shaped like one at all', () => {
    expect(() => emit.assertWorkout(null as never)).toThrow();
    expect(() => emit.assertWorkout({ blocks: 'nope' } as never)).toThrow(/must be an array/);
    expect(() => emit.assertWorkout({ blocks: [null] } as never)).toThrow(/not an object/);
  });
});

describe('what the coach can actually carry across', () => {
  it('rest, tempo and the cue survive — none are hardcoded', () => {
    const rich = emit.newEx('Squat', 'reps_kg', [emit.newSet('5', '8')], {
      rest: 180,
      tempo: '30X1',
      cue: 'Prescribed load: 120kg',
    });
    expect(rich.rest).toBe(180);
    expect(rich.tempo).toBe('30X1');
    expect(rich.cue).toBe('Prescribed load: 120kg');

    const plain = emit.newEx('Squat', 'reps_kg', [emit.newSet('5', '8')]);
    expect(plain.rest, 'the default rest is 90s').toBe(90);
    expect(plain.tempo).toBe('');
    expect('cue' in plain, 'no cue means no key, not an empty one').toBe(false);
  });

  it('rest is clamped — an absurd value would leave the stage stuck', () => {
    expect(emit.newEx('x', 'reps', [], { rest: 999999 }).rest).toBe(3600);
    expect(emit.newEx('x', 'reps', [], { rest: -5 }).rest).toBe(90);
    expect(emit.newEx('x', 'reps', [], { rest: 'nonsense' }).rest).toBe(90);
  });

  it('an unknown mode falls back rather than shipping a broken session', () => {
    expect(emit.newEx('x', 'telepathy', []).mode).toBe('reps_kg');
    for (const m of MODE_KEYS) expect(emit.newEx('x', m, []).mode).toBe(m);
  });

  it('an effort emits BOTH the effort and the zone it holds', () => {
    const hard = emit.newCondBlock('Finisher', 'intervals', 'hard');
    expect([hard.effort, hard.targetZone]).toEqual(['hard', 'high']);

    // A bare zone still works, for plans authored before effort existed.
    const legacy = emit.newCondBlock('Finisher', 'intervals', 'mod');
    expect([legacy.effort, legacy.targetZone]).toEqual(['medium', 'mod']);

    // Anything unrecognised lands on medium rather than throwing at author time.
    const junk = emit.newCondBlock('Finisher', 'intervals', 'sideways');
    expect([junk.effort, junk.targetZone]).toEqual(['medium', 'mod']);
  });

  it('measureToMode maps the coach editor’s columns onto the athlete’s modes', () => {
    expect(emit.measureToMode(['Weight (kg)', 'Reps'])).toBe('reps_kg');
    expect(emit.measureToMode(['Time (min:sec)'])).toBe('seconds');
    expect(emit.measureToMode(['Reps'])).toBe('reps');
    expect(emit.measureToMode(['Distance'])).toBe('completion');
    expect(emit.measureToMode([])).toBe('completion');
  });

  it('lbToKg', () => {
    expect(emit.lbToKg(225)).toBe(102.1);
    expect(emit.lbToKg('nonsense')).toBe('');
  });
});
