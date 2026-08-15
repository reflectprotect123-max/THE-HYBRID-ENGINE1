import { describe, expect, it } from 'vitest';
import { sessionLetters, ssGroups } from './logger';
import { exLogFor } from './session';
import type { Exercise, LoggedSet, Session, StrengthBlock } from './types';

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

/*
 * `advanceAfterSet` was tested here and is gone (15 August 2026). It walked a
 * superset chain A→B with no rest and rested only once the pair was complete —
 * the rule that MAKES it a superset — but it belonged to the web guided
 * logger, and the phone runs `@hybrid/session-authoring`'s queue instead.
 *
 * The rule did not go with the function: `queue.ts` owns it now, and its own
 * tests are where a regression in it gets caught. What remains below is the
 * part that is still shared — how a chain is READ off a block, and what letter
 * each exercise carries.
 */
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

/*
 * Bodyweight work in exercise history.
 *
 * `exLogFor` gated every set on `epley` returning a number, and epley returns
 * null without a weight — so bodyweight sets were dropped entirely and a screen
 * headed "every session" showed a dip day of BW/+10/+20 as two sets. Reps are
 * what make it a set; the weight is what makes it estimable.
 */
describe('exLogFor keeps bodyweight sets', () => {
  const sess = (id: string, date: string, sets: Partial<LoggedSet>[]): Session =>
    ({
      id,
      date,
      status: 'completed',
      completedAt: Date.parse(date + 'T18:00:00Z'),
      blocks: [
        {
          id: 'b',
          heading: 'Main',
          exercises: [
            { id: 'e', name: 'Strict dip', mode: 'reps_kg', sets: sets.map((s) => ({ done: true, ...s })) },
          ],
        },
      ],
    }) as unknown as Session;

  it('keeps the bodyweight set alongside the loaded ones', () => {
    const log = exLogFor('Strict dip', [
      sess('s1', '2026-01-02', [{ aVal: '', aVal2: '7' }, { aVal: '10', aVal2: '7' }, { aVal: '20', aVal2: '7' }]),
    ]);
    expect(log[0].sets).toHaveLength(3);
    expect(log[0].sets[0]).toMatchObject({ kg: null, reps: 7, e1: null });
  });

  it('still picks the best LOADED set as the estimate', () => {
    // An e1RM is a claim about load; bodyweight cannot make one.
    const log = exLogFor('Strict dip', [
      sess('s1', '2026-01-02', [{ aVal: '', aVal2: '20' }, { aVal: '20', aVal2: '7' }]),
    ]);
    expect(log[0].best?.kg).toBe(20);
  });

  it('reports no estimate at all for a bodyweight-only session', () => {
    // Null, not zero — zero would plot as a collapse on the trend.
    const log = exLogFor('Strict dip', [sess('s1', '2026-01-02', [{ aVal: '', aVal2: '12' }])]);
    expect(log[0].sets).toHaveLength(1);
    expect(log[0].best).toBeNull();
  });

  it('drops a set with no reps, because that is not a set', () => {
    const log = exLogFor('Strict dip', [sess('s1', '2026-01-02', [{ aVal: '20', aVal2: '' }])]);
    expect(log).toHaveLength(0);
  });

  it('keeps bodyweight work out of the earned best across sessions', () => {
    const log = exLogFor('Strict dip', [
      sess('s1', '2026-01-02', [{ aVal: '', aVal2: '30' }]),
      sess('s2', '2026-01-09', [{ aVal: '20', aVal2: '5' }]),
    ]);
    expect(log[0].best).toBeNull();
    expect(log[1].best?.e1).toBeCloseTo(20 * (1 + 5 / 30), 5);
  });
});
