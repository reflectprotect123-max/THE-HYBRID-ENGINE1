/*
 * pickSession — cloud merge conflict resolution for two copies of the same
 * session id. The comment on the function promises that logged work always
 * outranks an empty session, however recently the empty one was touched;
 * `updatedAt` is only meant to break ties WITHIN the same amount of work.
 */
import { describe, expect, it } from 'vitest';
import { pickSession } from './db';
import type { Session, StrengthBlock, LoggedSet } from './types';

const doneSet = (): LoggedSet => ({ t: '5', rpe: '8', aVal: '100', done: true });

const strengthBlock = (sets: LoggedSet[]): StrengthBlock<LoggedSet> => ({
  id: 'b1',
  exercises: [{ id: 'e1', name: 'Back Squat', mode: 'reps_kg', sets }],
});

const session = (over: Partial<Session>): Session => ({
  id: 's1',
  date: '2026-07-30',
  status: 'completed',
  blocks: [],
  ...over,
});

describe('pickSession', () => {
  it('keeps a session with a logged set over an empty session touched much later', () => {
    const logged = session({
      completedAt: 1_000_000,
      updatedAt: 1_000_000,
      blocks: [strengthBlock([doneSet()])],
    });
    const emptyButRecent = session({
      completedAt: 2_100_001,
      updatedAt: 2_100_001,
      blocks: [strengthBlock([{ t: '5', rpe: '8' }])],
    });
    expect(pickSession(logged, emptyButRecent)).toBe(logged);
    expect(pickSession(emptyButRecent, logged)).toBe(logged);
  });

  it('prefers more logged sets over fewer, regardless of timestamps', () => {
    const twoSets = session({
      updatedAt: 1,
      blocks: [strengthBlock([doneSet(), doneSet()])],
    });
    const oneSet = session({
      updatedAt: 999_999_999,
      blocks: [strengthBlock([doneSet()])],
    });
    expect(pickSession(oneSet, twoSets)).toBe(twoSets);
  });

  it('falls back to the most recently updated copy when work is equal', () => {
    const older = session({ updatedAt: 100, blocks: [strengthBlock([doneSet()])] });
    const newer = session({ updatedAt: 200, blocks: [strengthBlock([doneSet()])] });
    expect(pickSession(older, newer)).toBe(newer);
  });
});
