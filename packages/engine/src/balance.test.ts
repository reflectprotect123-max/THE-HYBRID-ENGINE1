import { describe, expect, it } from 'vitest';
import { condEfforts } from './balance';
import { sanitizeDB } from './db';

/*
 * `loadBalance` — the strength-vs-conditioning trade-off readout this file
 * used to test end to end — was deleted whole on 17 August 2026 with the rest
 * of strength: it compared `sessionVolume`/`bestE1rmByLift` against
 * conditioning load, and there is no more strength side to compare. See
 * `balance.ts`'s own header.
 *
 * `condEfforts` survives — it is conditioning's own effort list, with no
 * strength dependency — so its one piece of real behaviour not already
 * covered by `restore.test.ts`'s `sanitizeDB` coverage stays here: that the
 * function itself tolerates a poisoned `settings.conditioning` array rather
 * than throwing when it reads `.startedAt` off a null/garbage entry.
 */
describe('condEfforts skips null/garbage entries in settings.conditioning instead of throwing', () => {
  it('does not throw and returns only the real record', () => {
    const good = { id: 'c10', startedAt: 123 };
    const db = sanitizeDB({ settings: { conditioning: [null, 'garbage', good, 42] } });
    expect(() => condEfforts([], db.settings)).not.toThrow();
    expect(condEfforts([], db.settings)).toEqual([good]);
  });
});
