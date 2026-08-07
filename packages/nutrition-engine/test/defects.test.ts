import { describe, expect, it } from 'vitest';
import { ENGINE_DEFECTS } from '../src/defects';

/*
 * These assertions exist so the list cannot rot into decoration. A defect
 * entry that says nothing about consequence, or claims to be shown to the
 * athlete without naming where, is worse than no entry: it reads as diligence
 * while hiding the same gap.
 */
describe('inherited engine defects', () => {
  it('records all six carried forward from the reference', () => {
    expect(ENGINE_DEFECTS).toHaveLength(6);
  });

  it('every entry says what it does to the athlete and where it can be seen', () => {
    for (const d of ENGINE_DEFECTS) {
      expect(d.id, 'id').toMatch(/^[a-z0-9-]+$/);
      expect(d.problem.length, `${d.id} problem`).toBeGreaterThan(40);
      expect(d.consequence.length, `${d.id} consequence`).toBeGreaterThan(40);
      expect(d.surfacesAt.length, `${d.id} surfacesAt`).toBeGreaterThan(10);
    }
  });

  it('the two athlete-visible ones are the two the UI actually surfaces', () => {
    // If a third is ever marked visible, a screen has to show it — that is the
    // point of the flag, and this test is what makes the flag cost something.
    expect(ENGINE_DEFECTS.filter((d) => d.shownToAthlete).map((d) => d.id)).toEqual([
      'ewma-gap-carry-flattens-slope',
      'macro-targets-can-overshoot-calories',
    ]);
  });
});
