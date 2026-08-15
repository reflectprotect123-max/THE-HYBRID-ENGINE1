import { describe, expect, it } from 'vitest';
import { exFinished, sessionLetters, sessionProgress, ssGroups } from './logger';
import type { AnySet, Block, Exercise, LoggedSet, Session } from './types';

/*
 * THIS FILE USED TO TEST A DELETED SCREEN.
 *
 * Both of its cases drove `prefillPrimary`, which belonged to the web guided
 * logger and went with it on 15 August 2026. The second one was making a real
 * claim about the FOLD rather than about the prefill — that an unrated set
 * carries no evidence, so the next weight is priced off the plan and not off a
 * bar weight nobody vouched for — so that case moved into `fold.test.ts`
 * against `foldFromExercise` directly, where it survives the screen.
 *
 * What is left in `logger.ts` are shape questions about a session that both
 * apps still ask, and they had NO test at all: the file's only coverage was of
 * the half that is now gone. That is the trap this repository keeps meeting
 * from the other side — a suite that reports green while the thing it watches
 * has left the building.
 */

const ex = (name: string, sets: LoggedSet[]): Exercise<LoggedSet> => ({
  id: name,
  name,
  mode: 'reps_kg',
  tempo: '',
  rest: 90,
  sets,
});

const done = (n: number): LoggedSet[] => Array.from({ length: n }, () => ({ t: '5', rpe: '8', done: true }));
const open = (n: number): LoggedSet[] => Array.from({ length: n }, () => ({ t: '5', rpe: '8' }));

const strength = (exercises: Exercise<LoggedSet>[], extra: Partial<Block<AnySet>> = {}): Block<AnySet> =>
  ({ id: 'b', kind: 'strength', exercises, ...extra }) as unknown as Block<AnySet>;

const session = (blocks: Block<AnySet>[]): Session => ({ id: 's', blocks, status: 'active' }) as unknown as Session;

describe('exFinished', () => {
  it('is true only when every set is logged', () => {
    expect(exFinished(ex('Squat', done(3)))).toBe(true);
    expect(exFinished(ex('Squat', [...done(2), ...open(1)]))).toBe(false);
  });

  it('is FALSE for an exercise with no sets at all', () => {
    /* An empty exercise is not a completed one. `every` on an empty array is
       true, so without the length guard a blank exercise would report itself
       finished and the flow would skip straight past it. */
    expect(exFinished(ex('Squat', []))).toBe(false);
  });
});

describe('ssGroups', () => {
  it('reconciles the two ways a superset is written', () => {
    /* The block-level flag (every exercise links to the next) and the
       per-exercise `ssNext`. Callers are not supposed to know both exist. */
    const byFlag = strength([ex('A', []), ex('B', [])], { superset: true });
    expect(ssGroups(byFlag)).toEqual([[0, 1]]);

    const byLink = strength([{ ...ex('A', []), ssNext: true }, ex('B', []), ex('C', [])]);
    expect(ssGroups(byLink)).toEqual([[0, 1], [2]]);
  });

  it('ends the chain at a link on the LAST exercise rather than running off the end', () => {
    /* What a half-finished edit leaves behind: an exercise marked as linked
       with nothing after it to link to. */
    const dangling = strength([ex('A', []), { ...ex('B', []), ssNext: true }]);
    expect(ssGroups(dangling)).toEqual([[0], [1]]);
  });
});

describe('sessionLetters', () => {
  it('numbers a chain and leaves a lone exercise unnumbered', () => {
    /* "C1" implies a partner. A single exercise has none, so it is just "C". */
    const s = session([strength([{ ...ex('A', []), ssNext: true }, ex('B', []), ex('C', [])])]);
    expect(sessionLetters(s)[0]).toEqual(['A1', 'A2', 'B']);
  });

  it('carries the letter ACROSS blocks rather than restarting at A', () => {
    const s = session([strength([ex('A', [])]), strength([ex('B', [])])]);
    expect(sessionLetters(s)[0]).toEqual(['A']);
    expect(sessionLetters(s)[1]).toEqual(['B']);
  });
});

describe('sessionProgress', () => {
  it('counts sets, and reports 0% rather than dividing by zero on an empty session', () => {
    expect(sessionProgress(session([]))).toEqual({ done: 0, total: 0, pct: 0 });
    expect(sessionProgress(session([strength([ex('A', [...done(1), ...open(3)])])]))).toEqual({
      done: 1,
      total: 4,
      pct: 25,
    });
  });

  it('counts a ticked text block as ONE done unit', () => {
    /* A ticked metcon is training that happened. Without this the meter sat at
       0% with the metcon complete and the finish button never turned brass. */
    const metcon = { id: 't', kind: 'text', done: true } as unknown as Block<AnySet>;
    expect(sessionProgress(session([metcon]))).toEqual({ done: 1, total: 1, pct: 100 });
  });
});
