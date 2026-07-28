import { describe, expect, it } from 'vitest';
import { todayRecovery, type EngineDB } from '@hybrid/engine';
import { latestWhoop } from '../src/Dashboard';

/*
 * The readiness tile.
 *
 * This exists because of a bug that was invisible in every way a bug can be:
 * it type-checked, it threw nothing, it rendered without complaint, and it
 * showed a dash — which is also exactly what the tile is SUPPOSED to show when
 * WHOOP has never synced. So a permanently broken tile and a correctly empty
 * one looked identical, on every dashboard, for every athlete.
 *
 * The cause was a cast. `whoopDaily` rows are `{ date, recovery, strain }`;
 * casting them to `WhoopSample` told the compiler they had `recoveryScore`,
 * `todayRecovery` read that field, got undefined, and returned null forever.
 *
 * The assertion that matters is the round trip: a stored row must survive all
 * the way through `todayRecovery` to a number. Asserting the mapped object's
 * shape alone would pass just as happily against the next field rename.
 */

const db = (whoopDaily: unknown): EngineDB => ({
  workouts: [],
  sessions: [],
  settings: { whoopDaily } as EngineDB['settings'],
});

describe('reading the stored daily WHOOP row', () => {
  it('carries a stored recovery all the way to a number', () => {
    const d = db([
      { date: '2026-07-26', recovery: 40, strain: 11 },
      { date: '2026-07-27', recovery: 71, strain: 14.2 },
    ]);
    // The whole bug in one line: this used to be null.
    expect(todayRecovery(latestWhoop(d))).toBe(71);
  });

  it('takes the NEWEST row, not the first', () => {
    const d = db([
      { date: '2026-07-01', recovery: 20, strain: 5 },
      { date: '2026-07-27', recovery: 88, strain: 9 },
    ]);
    expect(todayRecovery(latestWhoop(d))).toBe(88);
  });

  it('still reports nothing when there is genuinely nothing', () => {
    expect(latestWhoop(db(undefined))).toBeNull();
    expect(latestWhoop(db([]))).toBeNull();
    expect(latestWhoop(db('nonsense'))).toBeNull();
  });

  it('does not turn a missing recovery into a zero', () => {
    // A row can exist with no recovery on it. Zero is a real reading and would
    // band as "low" — telling the athlete to pull back because of a gap in the
    // data is the failure `recoveryBand` guards against elsewhere.
    const d = db([{ date: '2026-07-27', recovery: null, strain: 12 }]);
    expect(todayRecovery(latestWhoop(d))).toBeNull();
  });

  it('carries strain across too', () => {
    const d = db([{ date: '2026-07-27', recovery: 55, strain: 16.4 }]);
    expect(latestWhoop(d)?.strain).toBe(16.4);
  });
});
