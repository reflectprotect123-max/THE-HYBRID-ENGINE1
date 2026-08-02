import { describe, expect, it } from 'vitest';
import { decideStrengthProgression } from '../src/adaptive/strength';
import type { LoggedSet, Session } from '../src/types';

/** A single completed, non-warmup working set with a real target attached. */
const set = (aVal: string, aVal2: string, felt: string, t: string, rpe: string): LoggedSet =>
  ({ done: true, aVal, aVal2, felt, t, rpe }) as LoggedSet;

function sessionWith(id: string, at: number, s: LoggedSet, exerciseName = 'Bench press'): Session {
  return {
    id,
    date: '2026-01-01',
    status: 'completed',
    completedAt: at,
    blocks: [
      {
        id: 'b',
        heading: 'Main',
        superset: false,
        exercises: [{ id: 'e', name: exerciseName, mode: 'reps_kg', rest: 90, sets: [s] }],
      },
    ],
  } as unknown as Session;
}

describe('decideStrengthProgression — insufficient data', () => {
  it('pauses when fewer than 3 exposures are logged', () => {
    for (const count of [0, 1, 2]) {
      const sessions = Array.from({ length: count }, (_, i) =>
        sessionWith('s' + i, (i + 1) * 1000, set('100', '8', '8', '8-10', '8')),
      );
      const out = decideStrengthProgression('Bench press', sessions, { t: '8-10', rpe: '8' });
      expect(out.action).toBe('pause_insufficient_data');
      expect(out.confidence).toBe('low');
      expect(out.reasonCodes).toEqual(['insufficient_exposure_history']);
      expect(out.prescription).toBeUndefined();
    }
  });
});

describe('decideStrengthProgression — progression', () => {
  it('suggests one more rep when on target twice, loaded, below the rep-range top', () => {
    const s = (id: string, at: number) => sessionWith(id, at, set('100', '8', '8', '8-10', '8'));
    const sessions = [s('s0', 1000), s('s1', 2000), s('s2', 3000)];
    const out = decideStrengthProgression('Bench press', sessions, { t: '8-10', rpe: '8' });
    expect(out.action).toBe('progress_reps');
    expect(out.prescription).toEqual({ reps: 9 });
    expect(out.reasonCodes).toEqual(['consistently_on_target']);
  });

  it('suggests a load step once on target at the top of the rep range', () => {
    const s = (id: string, at: number, reps: string) => sessionWith(id, at, set('100', reps, '8', '8-10', '8'));
    const sessions = [s('s0', 1000, '8'), s('s1', 2000, '10'), s('s2', 3000, '10')];
    const out = decideStrengthProgression('Bench press', sessions, { t: '8-10', rpe: '8' });
    expect(out.action).toBe('progress_load');
    expect(out.prescription).toEqual({ load: 102.5 });
    expect(out.reasonCodes).toEqual(['consistently_on_target']);
  });

  it('suggests one more rep for a bodyweight exercise regardless of the rep-range top', () => {
    const s = (id: string, at: number) => sessionWith(id, at, set('', '12', '8', '10-15', '8'), 'Pull-up');
    const sessions = [s('s0', 1000), s('s1', 2000), s('s2', 3000)];
    const out = decideStrengthProgression('Pull-up', sessions, { t: '10-15', rpe: '8' });
    expect(out.action).toBe('progress_reps');
    expect(out.prescription).toEqual({ reps: 13 });
  });
});

describe('decideStrengthProgression — deload', () => {
  it('suggests a load step down after 2 consecutive missed sessions', () => {
    const s = (id: string, at: number) => sessionWith(id, at, set('100', '3', '8', '5', '8'));
    const sessions = [s('s0', 1000), s('s1', 2000), s('s2', 3000)];
    const out = decideStrengthProgression('Bench press', sessions, { t: '5', rpe: '8' });
    expect(out.action).toBe('deload');
    expect(out.prescription).toEqual({ load: 97.5 });
    expect(out.reasonCodes).toEqual(['consistently_missed']);
  });

  it('never suggests a load below AUTOREG.stepKg, even from an already-minimal weight', () => {
    const s = (id: string, at: number) => sessionWith(id, at, set('2.5', '3', '8', '5', '8'));
    const sessions = [s('s0', 1000), s('s1', 2000), s('s2', 3000)];
    const out = decideStrengthProgression('Bench press', sessions, { t: '5', rpe: '8' });
    expect(out.action).toBe('deload');
    expect(out.prescription).toEqual({ load: 2.5 });
  });

  it('holds instead of deloading a bodyweight exercise that was missed twice — nothing to deload', () => {
    const s = (id: string, at: number) => sessionWith(id, at, set('', '3', '8', '5', '8'), 'Push-up');
    const sessions = [s('s0', 1000), s('s1', 2000), s('s2', 3000)];
    const out = decideStrengthProgression('Push-up', sessions, { t: '5', rpe: '8' });
    expect(out.action).toBe('hold');
    expect(out.prescription).toBeUndefined();
    expect(out.dataLimitations).toEqual(['no_load_to_deload']);
  });
});

describe('decideStrengthProgression — mixed results', () => {
  it('holds when the last two exposures disagree (one on target, one missed)', () => {
    const onTarget = set('100', '8', '8', '8-10', '8');
    const missed = set('100', '3', '8', '5', '8');
    const sessions = [
      sessionWith('s0', 1000, onTarget),
      sessionWith('s1', 2000, onTarget),
      sessionWith('s2', 3000, missed),
    ];
    const out = decideStrengthProgression('Bench press', sessions, { t: '5', rpe: '8' });
    expect(out.action).toBe('hold');
    expect(out.prescription).toBeUndefined();
    expect(out.reasonCodes).toEqual(['mixed_recent_results']);
  });
});

describe('decideStrengthProgression — decision table', () => {
  type Kind = 'on' | 'miss' | 'mid';
  const PATTERNS: Array<[Kind, Kind]> = [
    ['on', 'on'],
    ['miss', 'miss'],
    ['on', 'miss'],
    ['miss', 'on'],
    ['mid', 'on'],
    ['on', 'mid'],
    ['mid', 'mid'],
    ['mid', 'miss'],
    ['miss', 'mid'],
  ];
  const REP_RANGES = ['5', '5-8', '8-12'] as const;

  function repsFor(kind: Kind, repRange: string): number {
    if (kind === 'miss') return 3; // below any floor used here (5 or 8)
    // 'on' and 'mid' both stay at-or-above the floor; only felt differs.
    return repRange === '5' ? 5 : repRange === '5-8' ? 6 : 9;
  }
  function feltFor(kind: Kind): string {
    return kind === 'mid' ? '3' : '8'; // '3' is 5 points under an rpe:'8' center — 'way too light', neither missed nor on-target
  }

  for (const [prevKind, lastKind] of PATTERNS) {
    for (const loaded of [true, false]) {
      for (const repRange of REP_RANGES) {
        for (const exposureCount of [3, 6] as const) {
          it(`prev=${prevKind} last=${lastKind} loaded=${loaded} range=${repRange} exposures=${exposureCount}`, () => {
            const kg = loaded ? '100' : '';
            const older = set(kg, String(repsFor('on', repRange)), '8', repRange, '8');
            const prevSet = set(kg, String(repsFor(prevKind, repRange)), feltFor(prevKind), repRange, '8');
            const lastSet = set(kg, String(repsFor(lastKind, repRange)), feltFor(lastKind), repRange, '8');

            const filler = Array.from({ length: exposureCount - 2 }, (_, i) => sessionWith('f' + i, i, older));
            const sessions = [...filler, sessionWith('sp', exposureCount - 1, prevSet), sessionWith('sl', exposureCount, lastSet)];

            const out = decideStrengthProgression('Bench press', sessions, { t: repRange, rpe: '8' });

            const prevOn = prevKind === 'on';
            const lastOn = lastKind === 'on';
            const prevMiss = prevKind === 'miss';
            const lastMiss = lastKind === 'miss';

            if (lastOn && prevOn) {
              const repTop = parseInt(repRange.includes('-') ? repRange.split(/[-–]/)[1] : repRange, 10);
              const lastReps = repsFor(lastKind, repRange);
              if (!loaded || lastReps < repTop) {
                expect(out.action).toBe('progress_reps');
                expect(out.prescription).toEqual({ reps: lastReps + 1 });
              } else {
                expect(out.action).toBe('progress_load');
                expect(out.prescription?.load).toBeCloseTo(102.5);
              }
            } else if (lastMiss && prevMiss) {
              if (!loaded) {
                expect(out.action).toBe('hold');
                expect(out.dataLimitations).toContain('no_load_to_deload');
              } else {
                expect(out.action).toBe('deload');
                expect(out.prescription?.load).toBeCloseTo(97.5);
              }
            } else {
              expect(out.action).toBe('hold');
              expect(out.prescription).toBeUndefined();
            }
          });
        }
      }
    }
  }
});
