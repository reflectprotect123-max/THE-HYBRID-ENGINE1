import { describe, expect, it } from 'vitest';
import {
  isLiftMode,
  isText,
  isWarmupBlock,
  newEx,
  newTextBlock,
  newWarmupBlock,
  ssGroups,
  type Block,
  type StrengthBlock,
  type Workout,
} from '@hybrid/engine';
import { assertPublishable, migrateLib, newSession, type CoachSession } from '../src/model';

/*
 * model.ts is the only pure module in the coach app, and it is the one that
 * decides what an athlete actually receives. `CoachSession` is now a type
 * alias for the engine's own `Workout<PlannedSet>` — these fixtures build
 * real engine shapes, not a coach-only translation of them.
 */

const session = (
  ex: { name: string; sets: { t: string; rpe?: string }[] }[],
): CoachSession => ({
  id: 'w1',
  name: 'Session',
  blocks: [
    {
      id: 'b1',
      heading: 'Main',
      minutes: '',
      format: '',
      superset: false,
      exercises: ex.map((e, i) => ({
        id: 'e' + i,
        name: e.name,
        mode: 'reps_kg',
        tempo: '',
        rest: 90,
        sets: e.sets.map((s) => ({ t: s.t, rpe: s.rpe ?? '' })),
      })),
    } as StrengthBlock,
  ],
});

const firstEx = (s: CoachSession) => {
  const w = assertPublishable(s);
  const b = w.blocks[0] as StrengthBlock;
  return b.exercises[0];
};

describe('assertPublishable is now a thin validation pass, not a translation', () => {
  it('passes an authored mode straight through', () => {
    expect(firstEx(session([{ name: 'Plank', sets: [{ t: '60' }] }])).mode).toBe('reps_kg');
  });

  it('passes an authored tempo straight through', () => {
    const s = session([{ name: 'Bench Press', sets: [{ t: '5', rpe: '8' }] }]);
    (s.blocks[0] as StrengthBlock).exercises[0].tempo = '3-1-1-0';
    expect(firstEx(s).tempo).toBe('3-1-1-0');
  });

  it('passes ssNext straight through, and ssGroups on the athlete side chains it', () => {
    const s = session([
      { name: 'Bench Press', sets: [{ t: '5', rpe: '8' }] },
      { name: 'Row', sets: [{ t: '8', rpe: '8' }] },
    ]);
    (s.blocks[0] as StrengthBlock).exercises[0].ssNext = true;
    const w = assertPublishable(s);
    const b = w.blocks[0] as StrengthBlock;
    expect(b.exercises[0].ssNext).toBe(true);
    expect(ssGroups(b)).toEqual([[0, 1]]);
  });

  it('a warm-up block survives publish and is still recognised as one', () => {
    const s: CoachSession = {
      id: 'w1',
      name: 'Session',
      blocks: [{ ...newWarmupBlock(), exercises: [{ ...newEx(), name: 'Empty bar bench', sets: [{ t: 'W10', rpe: '' }] }] }],
    };
    const w = assertPublishable(s);
    expect(isWarmupBlock(w.blocks[0])).toBe(true);
  });

  it('a text block survives publish with its body intact', () => {
    const s: CoachSession = { id: 'w1', name: 'Session', blocks: [{ ...newTextBlock(), body: 'AMRAP 12' }] };
    const w = assertPublishable(s);
    expect(isText(w.blocks[0])).toBe(true);
    expect((w.blocks[0] as { body?: string }).body).toBe('AMRAP 12');
  });

  it('throws on a set carrying a logger-owned field, same as the engine contract', () => {
    const s = session([{ name: 'Row', sets: [{ t: '5' }] }]);
    (s.blocks[0] as StrengthBlock).exercises[0].sets[0] = { t: '5', rpe: '8', done: true } as never;
    expect(() => assertPublishable(s)).toThrow(/logger field/);
  });


  it('a conditioning block carries an authored target distance through', () => {
    const s: CoachSession = {
      id: 'w1',
      name: 'Row day',
      blocks: [
        { id: 'b1', kind: 'conditioning', heading: 'Row', condFmt: 'steady', effort: 'medium', targetZone: 'mod', minutes: 20, targetDistanceM: 5000 },
      ],
    };
    const w = assertPublishable(s);
    expect((w.blocks[0] as { targetDistanceM?: number }).targetDistanceM).toBe(5000);
  });
});

describe('newSession', () => {
  it('produces a real, id-bearing engine workout with NO starter block', () => {
    // A blank starter block used to be seeded here; it rendered as an empty
    // "Exercise" row on the review screen and — worse — published to the
    // athlete as an unnamed 3-set exercise, since the emit contract does not
    // reject blank names. The guided flow authors every block explicitly, so
    // a fresh session starts genuinely empty.
    const s = newSession('My session');
    expect(s.id).toBeTruthy();
    expect(s.name).toBe('My session');
    expect(s.blocks.length).toBe(0);
  });
});

describe('assertPublishable on an empty session', () => {
  it('rejects a session with no blocks instead of shipping a blank one', () => {
    expect(() => assertPublishable(newSession('Empty'))).toThrow(/[Nn]othing/);
  });
});

/*
 * migrateLib's session conversion.
 *
 * The pre-blocks flat-exercise format (cols/sets rows, weight-column folding)
 * is GONE from this migration — there is no real coach programme data to
 * preserve (confirmed with the owner), so the elaborate legacy reconstruction
 * that used to live here is no longer worth its complexity. What remains is
 * the CURRENT on-disk shape (already blocks-based) converting into engine
 * shape, which is what anyone who has used the coach app recently actually
 * has stored.
 */
describe('migrateLib converts the current on-disk shape into engine shape', () => {
  const stored = (overrides: Record<string, unknown> = {}) => ({
    programs: [
      {
        id: 'p1',
        name: 'Block 1',
        weeks: [
          {
            days: [
              {
                title: 'Upper A',
                note: 'Bring straps',
                blocks: [
                  {
                    h: 'Main',
                    mins: '',
                    ss: false,
                    ex: [{ id: 'e1', name: 'Bench Press', rest: 90, cue: 'Pause each rep', sets: [{ t: '5', rpe: '8' }] }],
                  },
                ],
                ...overrides,
              },
              null, null, null, null, null, null,
            ],
          },
        ],
      },
    ],
  });

  it('maps h/mins/ss/ex onto heading/minutes/superset/exercises', () => {
    const lib = migrateLib(stored());
    const day = lib.programs[0].weeks[0].days[0] as Workout;
    const b = day.blocks[0] as StrengthBlock;
    expect(day.name).toBe('Upper A');
    expect(day.note).toBe('Bring straps');
    expect(b.heading).toBe('Main');
    expect(b.superset).toBe(false);
    expect(b.exercises[0].name).toBe('Bench Press');
    expect(b.exercises[0].sets[0]).toEqual({ t: '5', rpe: '8' });
  });

  it('infers a mode for migrated exercises, since the old shape never carried one', () => {
    const lib = migrateLib(
      stored({
        blocks: [{ h: 'Main', mins: '', ss: false, ex: [{ id: 'e1', name: 'Plank', rest: 90, cue: '', sets: [{ t: '60' }] }] }],
      }),
    );
    const day = lib.programs[0].weeks[0].days[0] as Workout;
    expect((day.blocks[0] as StrengthBlock).exercises[0].mode).toBe('seconds');
  });

  it('converts a conditioning block, keeping effort and zone in lockstep', () => {
    const lib = migrateLib(
      stored({ blocks: [{ kind: 'cond', h: 'Finisher', fmt: 'intervals', eff: 'hard' }] }),
    );
    const b = (lib.programs[0].weeks[0].days[0] as Workout).blocks[0] as Block & { targetZone?: string };
    expect(b.condFmt).toBe('intervals');
    expect((b as { effort?: string }).effort).toBe('hard');
    expect(b.targetZone).toBe('high');
  });

  it('never throws on malformed input — converts what parses, drops the rest', () => {
    for (const input of [null, [], 'nope', { programs: null }, { programs: [{ name: 'P' }] }]) {
      expect(() => migrateLib(input)).not.toThrow();
    }
  });

  it('clamps an out-of-range selection rather than indexing past the end', () => {
    const lib = migrateLib({ programs: [{ name: 'P', weeks: [] }], sel: { p: 99, w: -3, d: 12 } });
    expect(lib.sel.p).toBeGreaterThanOrEqual(0);
    expect(lib.sel.w).toBeGreaterThanOrEqual(0);
    expect(lib.sel.d).toBeGreaterThanOrEqual(0);
  });
});

/*
 * Round-trip: what the NEW builder persists (engine-shaped blocks) must come
 * back from migrateLib intact. migrateBlock originally understood only the
 * old dense-editor shape (h/mins/ss/ex) and rebuilt anything else as a blank
 * block — which silently WIPED every authored session on page reload.
 */
describe('migrateLib round-trips engine-shaped (new-builder) data', () => {
  const engineLib = () => ({
    programs: [{
      id: 'p1', name: 'Programme 1',
      weeks: [{
        days: [
          {
            id: 's1', name: 'Push day', note: 'Move well.',
            blocks: [
              {
                id: 'b1', heading: 'Main', minutes: '', format: '', superset: false,
                exercises: [{
                  id: 'e1', name: 'Back Squat', mode: 'reps_kg', rest: 120, tempo: '3-1-1-0',
                  cue: 'Brace hard.', ssNext: true,
                  sets: [{ t: '8', rpe: '8' }, { t: 'W10', rpe: '' }],
                }, {
                  id: 'e2', name: 'Barbell Row', mode: 'reps_kg',
                  sets: [{ t: '8', rpe: '7' }],
                }],
              },
              { id: 'b2', kind: 'conditioning', heading: 'Row', condFmt: 'steady', effort: 'medium', targetZone: 'mod', minutes: 20, targetDistanceM: 5000 },
              { id: 'b3', kind: 'text', heading: 'Metcon', body: '21-15-9\nthrusters' },
            ],
          },
          null, null, null, null, null, null,
        ],
      }],
    }],
    sel: { p: 0, w: 0, d: 0 },
  });

  it('a strength block keeps its exercises, sets, chaining, and coaching fields', () => {
    const lib = migrateLib(engineLib());
    const day = lib.programs[0].weeks[0].days[0] as CoachSession;
    const b = day.blocks[0] as StrengthBlock;
    expect(b.exercises.map((e) => e.name)).toEqual(['Back Squat', 'Barbell Row']);
    expect(b.exercises[0].sets).toEqual([{ t: '8', rpe: '8' }, { t: 'W10', rpe: '' }]);
    expect(b.exercises[0].ssNext).toBe(true);
    expect(b.exercises[0].tempo).toBe('3-1-1-0');
    expect(b.exercises[0].cue).toBe('Brace hard.');
    expect(b.exercises[0].rest).toBe(120);
    expect(day.name).toBe('Push day');
    expect(day.note).toBe('Move well.');
  });

  it('conditioning and text blocks pass through with their content', () => {
    const lib = migrateLib(engineLib());
    const day = lib.programs[0].weeks[0].days[0] as CoachSession;
    expect(day.blocks[1]).toMatchObject({ kind: 'conditioning', condFmt: 'steady', minutes: 20, targetDistanceM: 5000 });
    expect(day.blocks[2]).toMatchObject({ kind: 'text', body: '21-15-9\nthrusters' });
  });

  it('logger-owned fields on stored sets are stripped at load, preserving the boundary', () => {
    const raw = engineLib();
    (raw.programs[0].weeks[0].days[0]!.blocks[0].exercises![0].sets[0] as Record<string, unknown>).done = true;
    const lib = migrateLib(raw);
    const day = lib.programs[0].weeks[0].days[0] as CoachSession;
    const st = (day.blocks[0] as StrengthBlock).exercises[0].sets[0];
    expect(st).toEqual({ t: '8', rpe: '8' });
    expect(() => assertPublishable(day)).not.toThrow();
  });
});
