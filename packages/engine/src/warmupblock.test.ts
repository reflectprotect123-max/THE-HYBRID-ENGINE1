import { describe, expect, it } from 'vitest';
import {
  bestE1rmByLift,
  detectPRs,
  exLogFor,
  newWarmupBlock,
  rpeGapInfo,
  sessionRpe,
  sessionVolume,
} from './session';
import { liftMoves } from './lift';
import type { CondBlock, LoggedSet, Session, StrengthBlock } from './types';

/*
 * A whole block of prep.
 *
 * Real movements you tick off, but nothing inside may reach tonnage, an e1RM,
 * a PR, or an earned working weight. The failure this guards against is
 * concrete: warm bench up with an empty bar at RPE 3, and without these the
 * progression learns your working bench is 20kg and offers it back next week.
 */
const set = (kg: string, reps: string, felt = '3'): LoggedSet =>
  ({ done: true, aVal: kg, aVal2: reps, felt }) as LoggedSet;

const sess = (warmup: boolean): Session =>
  ({
    id: 's',
    date: '2026-01-02',
    status: 'completed',
    completedAt: Date.parse('2026-01-02T18:00:00Z'),
    blocks: [
      {
        ...(newWarmupBlock() as StrengthBlock<LoggedSet>),
        warmup,
        exercises: [
          { id: 'e', name: 'Bench press', mode: 'reps_kg', rest: 90, sets: [set('20', '10')] },
        ],
      },
    ],
  }) as unknown as Session;

describe('warm-up / cooldown blocks', () => {
  it('adds nothing to tonnage', () => {
    expect(sessionVolume(sess(true))).toBe(0);
    // ...and the same block without the flag does count, so the test is not
    // passing because the fixture is empty.
    expect(sessionVolume(sess(false))).toBe(200);
  });

  it('never teaches the earned working weight', () => {
    // The one that matters: an empty-bar warm-up must not become your bench.
    expect(liftMoves(sess(true))).toEqual([]);
    expect(liftMoves(sess(false))).toHaveLength(1);
  });

  it('stays out of a movement’s history', () => {
    expect(exLogFor('Bench press', [sess(true)])).toEqual([]);
    expect(exLogFor('Bench press', [sess(false)])).toHaveLength(1);
  });

  it('can never register a personal record', () => {
    expect(detectPRs(sess(true), [])).toEqual([]);
    expect(detectPRs(sess(false), [])).toHaveLength(1);
  });

  it('is named for both ends of the session', () => {
    // One block type, used to warm up or to cool down — the rule is identical.
    expect(newWarmupBlock().heading).toBe('Warm-up / Cooldown');
    expect(newWarmupBlock().warmup).toBe(true);
  });
});

/*
 * E1/E2/E4 — the per-set `isWarmup` guard on its own is not enough: a whole
 * warm-up BLOCK carries ordinary targets on ordinary-looking sets (the coach
 * flow forces an RPE onto them — C3), so any walk that only checks the set
 * marker still lets a warm-up block's rated sets leak into RPE and e1RM math.
 */
const rated = (rpe: string, felt: string, aVal = '20', aVal2 = '10'): LoggedSet =>
  ({ done: true, rpe, felt, aVal, aVal2 }) as LoggedSet;

const twoBlockSess = (mainSet: LoggedSet, warmupSet: LoggedSet, name = 'Bench press'): Session =>
  ({
    id: 's',
    date: '2026-01-02',
    status: 'completed',
    completedAt: Date.parse('2026-01-02T18:00:00Z'),
    blocks: [
      {
        id: 'main',
        heading: 'Main work',
        superset: false,
        exercises: [{ id: 'e1', name, mode: 'reps_kg', rest: 90, sets: [mainSet] }],
      },
      {
        ...(newWarmupBlock() as StrengthBlock<LoggedSet>),
        id: 'wu',
        warmup: true,
        exercises: [{ id: 'e2', name, mode: 'reps_kg', rest: 90, sets: [warmupSet] }],
      },
    ],
  }) as unknown as Session;

describe('sessionRpe excludes a warm-up BLOCK (E1)', () => {
  it('averages only the working block, not the diluting warm-up block', () => {
    const s = twoBlockSess(rated('7', '9'), rated('1', '3'));
    expect(sessionRpe(s)).toEqual({ target: 7, felt: 9 });
  });
});

describe('bestE1rmByLift excludes a warm-up BLOCK (E2)', () => {
  it('agrees with detectPRs/exLogFor instead of reporting the warm-up set’s inflated e1RM', () => {
    const s = twoBlockSess(rated('7', '7', '100', '5'), rated('3', '3', '200', '10'));
    const from = Date.parse('2026-01-01T00:00:00Z');
    const to = Date.parse('2026-01-03T00:00:00Z');
    const map = bestE1rmByLift([s], from, to);
    // 100x5 -> e1 116.7ish; the buggy warm-up 200x10 set would report ~266.7.
    expect(map.get('bench press')?.e1).toBeCloseTo(116.67, 2);
  });
});

describe('rpeGapInfo excludes a warm-up BLOCK (E4)', () => {
  it('does not let a warm-up block’s forced RPE/felt dilute the readiness gap', () => {
    const s = twoBlockSess(rated('5', '8'), rated('5', '5'));
    const info = rpeGapInfo([s], Date.parse('2026-01-02T19:00:00Z'));
    expect(info).toEqual({ gap: 3, date: '2026-01-02', n: 1 });
  });
});

/*
 * sessionRpe folds a conditioning block's banked felt RPE into the felt
 * average (it previously only ever walked `blockExercises(b)`, which is
 * always `[]` for a CondBlock — a conditioning-only or hybrid session's felt
 * effort silently never counted).
 *
 * Target is deliberately NOT pulled from the conditioning side: `condResult`
 * only ever carries `targetRpe` as a coach-authored BAND CENTER (e.g.
 * "Hard" = RPE 8-9.5, center 8.5 — see CON_EFFORTS), not a single number
 * aimed at the way a strength set's own `rpe` is. Averaging a band midpoint
 * into a set-level target average would conflate two different kinds of
 * number, and it would also retroactively change `sessionRpe`'s `target` for
 * every already-recorded conditioning result that carries a `targetRpe` —
 * which golden's own session fixture (`s2`, a conditioning block with
 * `targetRpe: 8.5`) proves happens on a real, previously-harvested input, not
 * just a hypothetical one. So only `felt` is contributed for a conditioning
 * block.
 */
const condBlock = (felt?: string): CondBlock => ({
  id: 'c',
  kind: 'conditioning',
  condFmt: 'intervals',
  condResult: felt == null ? {} : { felt },
});

describe('sessionRpe folds in a conditioning block’s felt RPE', () => {
  it('averages a rated strength set (felt 7) with a conditioning block (felt 9) to felt 8', () => {
    const s: Session = {
      id: 's',
      date: '2026-01-02',
      status: 'completed',
      completedAt: Date.parse('2026-01-02T18:00:00Z'),
      blocks: [
        {
          id: 'main',
          exercises: [{ id: 'e1', name: 'Bench press', mode: 'reps_kg', sets: [rated('7', '7')] }],
        },
        condBlock('9'),
      ],
    } as unknown as Session;
    expect(sessionRpe(s)).toEqual({ target: 7, felt: 8 });
  });

  it('a conditioning block with no felt rating contributes nothing', () => {
    const s: Session = {
      id: 's',
      date: '2026-01-02',
      status: 'completed',
      completedAt: Date.parse('2026-01-02T18:00:00Z'),
      blocks: [
        {
          id: 'main',
          exercises: [{ id: 'e1', name: 'Bench press', mode: 'reps_kg', sets: [rated('7', '7')] }],
        },
        condBlock(),
      ],
    } as unknown as Session;
    expect(sessionRpe(s)).toEqual({ target: 7, felt: 7 });
  });

  it('a strength-only session is byte-identical to before (no conditioning block present)', () => {
    const s = twoBlockSess(rated('7', '9'), rated('1', '3'));
    expect(sessionRpe(s)).toEqual({ target: 7, felt: 9 });
  });
});
