import { describe, expect, it } from 'vitest';
import {
  bestE1rmByLift,
  detectPRs,
  exLogFor,
  newWarmupBlock,
  rpeGapInfo,
  sessionRpe,
  sessionVolume,
} from '../src/session';
import { liftMoves } from '../src/lift';
import type { LoggedSet, Session, StrengthBlock } from '../src/types';

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
