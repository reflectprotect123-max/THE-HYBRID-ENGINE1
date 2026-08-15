/*
 * The coach → athlete boundary.
 *
 * This is the only place a coach's writing becomes an athlete's session, and
 * the only thing preventing a published plan from overwriting logged work. It
 * gets tested directly rather than through either app.
 */
import { describe, expect, it } from 'vitest';
import { FORBIDDEN_SET_KEYS, MODE_KEYS, emit } from './index';

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

  

  
});
