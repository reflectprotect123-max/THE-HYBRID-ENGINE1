/*
 * rpeGapInfo must survive a corrupt/prototype-named conditioning effort.
 *
 * A stored CondResult whose `effort` is "constructor" made the direct
 * `CON_EFFORTS[effort]` lookup in rpeGapInfo resolve to Object.prototype's
 * constructor (truthy), which then had no `.rpe`, throwing inside
 * condEffortGap and white-screening Home. The guarded condEffort() must be
 * the only resolver. (Finding E9.)
 */
import { describe, expect, it } from 'vitest';
import { rpeGapInfo } from './session';
import type { Session } from './types';

const withCondEffort = (effort: string): Session => ({
  id: 's1',
  date: '2026-01-02',
  status: 'completed',
  completedAt: Date.now(),
  blocks: [
    {
      id: 'c1',
      kind: 'conditioning',
      condFmt: 'steady',
      condResult: { effort: effort as never, felt: 8, targetRpe: 6 } as never,
    },
  ],
});

describe('rpeGapInfo hostile effort', () => {
  it('does not throw on a prototype-named effort, and treats it as a normal gap', () => {
    expect(() => rpeGapInfo([withCondEffort('constructor')])).not.toThrow();
    expect(() => rpeGapInfo([withCondEffort('__proto__')])).not.toThrow();
    // A real effort still resolves and produces a finite gap.
    const ok = rpeGapInfo([withCondEffort('easy')]);
    expect(ok && Number.isFinite(ok.gap)).toBe(true);
  });
});
