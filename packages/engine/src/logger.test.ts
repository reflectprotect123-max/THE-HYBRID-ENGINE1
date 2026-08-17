import { describe, expect, it } from 'vitest';
import { sessionProgress } from './logger';
import type { AnySet, Block, Session } from './types';

/*
 * THIS FILE USED TO TEST A DELETED SCREEN.
 *
 * Both of its original cases drove `prefillPrimary`, which belonged to the web
 * guided logger and went with it on 15 August 2026 (see `fold.test.ts`'s own
 * history for the case that survived it).
 *
 * What was left in `logger.ts` after that were shape questions about a
 * session that both apps still ask — `exFinished`, `ssGroups` and
 * `sessionLetters`' superset-chain numbering among them. All three of those
 * were strength-only (exercises, `ssNext`, per-exercise letters) and were
 * deleted whole on 17 August 2026 with the rest of strength — `logger.ts`'s
 * own header records that `sessionLetters` now returns `['♥']` for a
 * conditioning block and `[]` for anything else, with no per-exercise
 * numbering left to test. Their describe blocks went with them.
 *
 * `sessionProgress` is what remains genuinely alive and untested by anything
 * else — the meter both apps still show.
 */

const session = (blocks: Block<AnySet>[]): Session => ({ id: 's', blocks, status: 'active' }) as unknown as Session;

describe('sessionProgress', () => {
  it('counts sets, and reports 0% rather than dividing by zero on an empty session', () => {
    expect(sessionProgress(session([]))).toEqual({ done: 0, total: 0, pct: 0 });
  });

  it('counts a ticked text block as ONE done unit', () => {
    /* A ticked metcon is training that happened. Without this the meter sat at
       0% with the metcon complete and the finish button never turned brass. */
    const metcon = { id: 't', kind: 'text', done: true } as unknown as Block<AnySet>;
    expect(sessionProgress(session([metcon]))).toEqual({ done: 1, total: 1, pct: 100 });
  });

  it('counts a finished conditioning block as ONE done unit', () => {
    const run = { id: 'c', kind: 'conditioning', condFmt: 'steady', condResult: { fmt: 'steady' } } as unknown as Block<AnySet>;
    expect(sessionProgress(session([run]))).toEqual({ done: 1, total: 1, pct: 100 });
  });
});
