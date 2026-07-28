import { describe, expect, it } from 'vitest';
import { detectPRs, exLogFor, newWarmupBlock, sessionVolume } from '../src/session';
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
