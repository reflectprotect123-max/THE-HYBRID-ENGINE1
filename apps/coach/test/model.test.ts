import { describe, expect, it } from 'vitest';
import { duplicateCoachEx, migrateLib, sanitizeSession, sessionToWorkout, type CoachEx, type CoachSession } from '../src/model';

/*
 * model.ts is the only pure module in the coach app, and it is the one that
 * decides what an athlete actually receives. Everything here is a regression
 * test for a real defect found by diffing this port against the vanilla
 * builder in coach/js/app.js — the cited line is where the behaviour is
 * specified.
 */

const session = (ex: { name: string; sets: { t: string; rpe?: string }[] }[]): CoachSession =>
  ({
    title: 'Session',
    note: '',
    blocks: [
      {
        h: 'Main',
        mins: '',
        ss: false,
        ex: ex.map((e, i) => ({
          id: 'e' + i,
          name: e.name,
          rest: 90,
          cue: '',
          sets: e.sets.map((s) => ({ t: s.t, rpe: s.rpe ?? '' })),
        })),
      },
    ],
  }) as unknown as CoachSession;

const firstEx = (s: CoachSession) => {
  const w = sessionToWorkout(s);
  const b = w.blocks[0] as { exercises: { mode: string; sets: unknown[] }[] };
  return b.exercises[0];
};

describe('the mode an athlete is given is inferred, never assumed', () => {
  // coach/js/app.js:549 toPhoneEx. The port hardcoded 'reps_kg', so a plank
  // asked for a weight and `max` was not an AMRAP.
  it('a bare number over 30 is a duration, not a rep count', () => {
    expect(firstEx(session([{ name: 'Plank', sets: [{ t: '60' }, { t: '45' }] }])).mode).toBe('seconds');
  });

  it('ordinary rep counts stay reps_kg', () => {
    expect(firstEx(session([{ name: 'Back Squat', sets: [{ t: '5' }, { t: '5' }] }])).mode).toBe('reps_kg');
  });

  it('30 is a rep count — the boundary is strictly greater', () => {
    expect(firstEx(session([{ name: 'Row', sets: [{ t: '30' }] }])).mode).toBe('reps_kg');
  });

  it('one "max" makes the whole exercise an AMRAP, and beats the duration test', () => {
    expect(firstEx(session([{ name: 'Push-up', sets: [{ t: 'max' }, { t: '60' }] }])).mode).toBe('amrap');
  });

  it('a mixed exercise is not a duration', () => {
    expect(firstEx(session([{ name: 'Carry', sets: [{ t: '60' }, { t: '8' }] }])).mode).toBe('reps_kg');
  });

  it('an exercise with no sets is not a duration', () => {
    // `every` on an empty array is true, so without the length guard a movement
    // with no sets would be published as a timed hold.
    expect(firstEx(session([{ name: 'Empty', sets: [] }])).mode).toBe('reps_kg');
  });
});

describe('a set target survives a round trip through storage', () => {
  // coach/js/app.js:35 setM() coerces with String(), so a stored library can
  // legitimately carry {t: 5}. Treating a non-string as blank empties the whole
  // prescription — the coach opens their programme and the numbers are gone.
  it('a numeric target read off disk is kept, not blanked', () => {
    const s = sanitizeSession({
      title: 'S',
      blocks: [{ h: 'Main', ex: [{ name: 'Squat', rest: 90, sets: [{ t: 5, rpe: 8 }] }] }],
    });
    expect(s).not.toBeNull();
    const set = (s as unknown as { blocks: { ex: { sets: { t: string; rpe: string }[] }[] }[] }).blocks[0].ex[0].sets[0];
    expect(set.t).toBe('5');
    expect(set.rpe).toBe('8');
  });

  it('an object target is junk and still becomes blank', () => {
    const s = sanitizeSession({
      title: 'S',
      blocks: [{ h: 'Main', ex: [{ name: 'Squat', rest: 90, sets: [{ t: { bogus: 1 }, rpe: [] }] }] }],
    });
    const set = (s as unknown as { blocks: { ex: { sets: { t: string; rpe: string }[] }[] }[] }).blocks[0].ex[0].sets[0];
    expect(set.t).toBe('');
    expect(set.rpe).toBe('');
  });
});

describe('malformed libraries do not take the app down', () => {
  for (const [label, input] of [
    ['null', null],
    ['a bare array', []],
    ['a string', 'nope'],
    ['null programs', { programs: null }],
    ['a program with no weeks', { programs: [{ name: 'P' }] }],
  ] as const) {
    it('survives ' + label, () => {
      expect(() => migrateLib(input)).not.toThrow();
      const lib = migrateLib(input);
      expect(Array.isArray(lib.programs)).toBe(true);
    });
  }

  it('clamps an out-of-range selection rather than indexing past the end', () => {
    const lib = migrateLib({ programs: [{ name: 'P', weeks: [] }], sel: { p: 99, w: -3, d: 12 } });
    expect(lib.sel.p).toBeGreaterThanOrEqual(0);
    expect(lib.sel.w).toBeGreaterThanOrEqual(0);
    expect(lib.sel.d).toBeGreaterThanOrEqual(0);
  });
});

/*
 * duplicateCoachEx — a scoped-down twin of the engine's own duplicateExercise,
 * because CoachEx does not carry ssNext (or mode, or tempo): those only exist
 * on the athlete side today. Sub-project C — the coach authoring engine types
 * directly — retires this function entirely in favour of the shared one.
 */
describe('duplicateCoachEx', () => {
  const ex = (name: string, over: Partial<CoachEx> = {}): CoachEx => ({
    id: 'orig-' + name,
    name,
    sets: [{ t: '5', rpe: '8' }],
    rest: 90,
    cue: '',
    ...over,
  });

  it('inserts a copy immediately after the original, with a fresh id', () => {
    const out = duplicateCoachEx([ex('Bench'), ex('Row')], 0);
    expect(out.map((e) => e.name)).toEqual(['Bench', 'Bench', 'Row']);
    expect(out[1].id).not.toBe(out[0].id);
  });

  it('copies sets by value, not by reference', () => {
    const out = duplicateCoachEx([ex('Bench')], 0);
    out[1].sets[0].t = '10';
    expect(out[0].sets[0].t).toBe('5');
  });

  it('returns the original array unchanged for an out-of-range index', () => {
    const exs = [ex('Bench')];
    expect(duplicateCoachEx(exs, 5)).toBe(exs);
  });
});
