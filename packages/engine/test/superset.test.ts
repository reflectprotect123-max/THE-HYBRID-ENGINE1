import { describe, expect, it } from 'vitest';
import { advanceAfterSet, sessionLetters, ssGroups } from '../src/logger';
import type { Exercise, LoggedSet, Session, StrengthBlock } from '../src/types';

/*
 * Supersetting individual exercises.
 *
 * `superset` was a flag on the BLOCK, so it was all-or-nothing: either every
 * exercise in the block was chained or none was. A real session is "bench
 * paired with dips, then three straight sets" — one flag cannot say that, so
 * pairing two movements meant splitting the block, which nobody is going to do
 * mid-set on a gym floor.
 *
 * `ssNext` links one exercise to the next. The block flag still means "every
 * exercise links to the next", and these assert the two agree.
 */

const ex = (name: string, sets: number, over: Partial<Exercise<LoggedSet>> = {}): Exercise<LoggedSet> =>
  ({
    id: name,
    name,
    mode: 'reps_kg',
    rest: 90,
    sets: Array.from({ length: sets }, () => ({}) as LoggedSet),
    ...over,
  }) as Exercise<LoggedSet>;

const done = (e: Exercise<LoggedSet>): Exercise<LoggedSet> => ({
  ...e,
  sets: e.sets.map((s) => ({ ...s, done: true, aVal: '100', aVal2: '5' })),
});

const block = (exercises: Exercise<LoggedSet>[], superset = false): StrengthBlock<LoggedSet> =>
  ({ id: 'b', heading: 'Main', superset, exercises }) as StrengthBlock<LoggedSet>;

const sess = (blocks: StrengthBlock<LoggedSet>[]): Session =>
  ({ id: 's', date: '2026-01-01', status: 'active', blocks }) as unknown as Session;

describe('ssGroups', () => {
  it('leaves unlinked exercises as groups of one', () => {
    expect(ssGroups(block([ex('a', 2), ex('b', 2), ex('c', 2)]))).toEqual([[0], [1], [2]]);
  });

  it('pairs just the two that are linked, leaving the rest alone', () => {
    // The case the block flag could not express.
    const b = block([ex('bench', 3, { ssNext: true }), ex('dip', 3), ex('curl', 3)]);
    expect(ssGroups(b)).toEqual([[0, 1], [2]]);
  });

  it('chains three into a triset from consecutive links', () => {
    const b = block([ex('a', 2, { ssNext: true }), ex('b', 2, { ssNext: true }), ex('c', 2)]);
    expect(ssGroups(b)).toEqual([[0, 1, 2]]);
  });

  it('still treats a block-level superset as one chain', () => {
    // Back-compat: every session authored before ssNext existed.
    expect(ssGroups(block([ex('a', 2), ex('b', 2)], true))).toEqual([[0, 1]]);
  });

  it('ignores a link on the last exercise, which points at nothing', () => {
    // What a half-finished edit leaves behind — it must not crash or wrap.
    expect(ssGroups(block([ex('a', 2), ex('b', 2, { ssNext: true })]))).toEqual([[0], [1]]);
  });
});

describe('advanceAfterSet with a pair', () => {
  it('goes straight to the partner with NO rest', () => {
    // This is the whole point of a superset.
    const s = sess([block([ex('bench', 2, { ssNext: true }), ex('dip', 2), ex('curl', 2)])]);
    expect(advanceAfterSet(s, 0, 0)).toEqual({ next: { bi: 0, ei: 1 }, restSec: 0 });
  });

  it('rests only once the pair is complete, then loops back', () => {
    const s = sess([block([ex('bench', 2, { ssNext: true }), ex('dip', 2), ex('curl', 2)])]);
    expect(advanceAfterSet(s, 0, 1)).toEqual({ next: { bi: 0, ei: 0 }, restSec: 90 });
  });

  it('does not drag the unpaired exercise after it into the chain', () => {
    // The regression this whole change exists to prevent: 'curl' is a straight
    // set and must rest on itself, not become part of bench+dip.
    const s = sess([block([ex('bench', 2, { ssNext: true }), ex('dip', 2), ex('curl', 2)])]);
    expect(advanceAfterSet(s, 0, 2)).toEqual({ next: { bi: 0, ei: 2 }, restSec: 90 });
  });

  it('leaves the pair once both are finished', () => {
    const s = sess([
      block([done(ex('bench', 2, { ssNext: true })), done(ex('dip', 2)), ex('curl', 2)]),
    ]);
    expect(advanceAfterSet(s, 0, 1).next).toBeNull();
  });

  it('skips a finished partner rather than sending you back to it', () => {
    const b = block([ex('bench', 2, { ssNext: true }), done(ex('dip', 2)), ex('curl', 2)]);
    expect(advanceAfterSet(sess([b]), 0, 0)).toEqual({ next: { bi: 0, ei: 0 }, restSec: 90 });
  });
});

describe('sessionLetters', () => {
  it('shares a letter across a pair and numbers within it', () => {
    const s = sess([block([ex('bench', 2, { ssNext: true }), ex('dip', 2), ex('curl', 2)])]);
    expect(sessionLetters(s)[0]).toEqual(['A1', 'A2', 'B']);
  });

  it('never numbers a lone exercise, which would imply a partner', () => {
    const s = sess([block([ex('a', 2), ex('b', 2)])]);
    expect(sessionLetters(s)[0]).toEqual(['A', 'B']);
  });

  it('matches the old block-superset labelling exactly', () => {
    const s = sess([block([ex('a', 2), ex('b', 2)], true)]);
    expect(sessionLetters(s)[0]).toEqual(['A1', 'A2']);
  });
});
