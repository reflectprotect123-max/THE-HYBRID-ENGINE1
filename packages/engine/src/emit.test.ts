/*
 * The coach → athlete boundary.
 *
 * This is the only place a coach's writing becomes an athlete's session, and
 * the only thing preventing a published plan from overwriting logged work. It
 * gets tested directly rather than through either app.
 */
import { describe, expect, it } from 'vitest';
import { emit } from './index';

/*
 * `newSet`/`newEx` and their tests were deleted whole on 17 August 2026 —
 * both built PlannedSet/Exercise content, which no longer exists.
 * `newCondBlock` is conditioning's own emit path and stays.
 */
describe('what the coach can actually carry across', () => {
  it('an effort emits BOTH the effort and the zone it holds', () => {
    const hard = emit.newCondBlock('Finisher', 'intervals', 'hard');
    expect([hard.effort, hard.targetZone]).toEqual(['hard', 'high']);

    // A bare zone still works, for plans authored before effort existed.
    const legacy = emit.newCondBlock('Finisher', 'intervals', 'mod');
    expect([legacy.effort, legacy.targetZone]).toEqual(['medium', 'mod']);

    // Anything unrecognised lands on medium rather than throwing at author time.
    const junk = emit.newCondBlock('Finisher', 'intervals', 'sideways');
    expect([junk.effort, junk.targetZone]).toEqual(['medium', 'mod']);
  });
});
