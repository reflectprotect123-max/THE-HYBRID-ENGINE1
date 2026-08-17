/*
 * pickSession — cloud merge conflict resolution for two copies of the same
 * session id. The comment on the function promises that logged work always
 * outranks an empty session, however recently the empty one was touched;
 * `updatedAt` is only meant to break ties WITHIN the same amount of work.
 */
import { describe, expect, it } from 'vitest';
import { pickSession } from './db';
import type { CondBlock, Session } from './types';

const condBlock = (result?: CondBlock['condResult']): CondBlock => ({
  id: 'b1',
  kind: 'conditioning',
  condFmt: 'steady',
  condResult: result,
});

const session = (over: Partial<Session>): Session => ({
  id: 's1',
  date: '2026-07-30',
  status: 'completed',
  blocks: [],
  ...over,
});

describe('pickSession', () => {
  it('keeps a session with a logged conditioning result over an empty session touched much later', () => {
    const logged = session({
      completedAt: 1_000_000,
      updatedAt: 1_000_000,
      blocks: [condBlock({ fmt: 'steady', felt: '8' })],
    });
    const emptyButRecent = session({
      completedAt: 2_100_001,
      updatedAt: 2_100_001,
      blocks: [condBlock(undefined)],
    });
    expect(pickSession(logged, emptyButRecent)).toBe(logged);
    expect(pickSession(emptyButRecent, logged)).toBe(logged);
  });

  it('prefers more logged blocks over fewer, regardless of timestamps', () => {
    const twoBlocks = session({
      updatedAt: 1,
      blocks: [condBlock({ fmt: 'steady', felt: '8' }), condBlock({ fmt: 'steady', felt: '7' })],
    });
    const oneBlock = session({
      updatedAt: 999_999_999,
      blocks: [condBlock({ fmt: 'steady', felt: '8' })],
    });
    expect(pickSession(oneBlock, twoBlocks)).toBe(twoBlocks);
  });

  it('falls back to the most recently updated copy when work is equal', () => {
    const older = session({ updatedAt: 100, blocks: [condBlock({ fmt: 'steady', felt: '8' })] });
    const newer = session({ updatedAt: 200, blocks: [condBlock({ fmt: 'steady', felt: '8' })] });
    expect(pickSession(older, newer)).toBe(newer);
  });
});
