import { computeSetAdjustment } from '../src/autoreg';

describe('computeSetAdjustment — E5 on-target hold', () => {
  it('a set exactly on target holds the weight, even off a non-plate load', () => {
    expect(computeSetAdjustment(5, 8.5, 5, 101, 8.5))
      .toEqual({ delta: 0, newWeight: 101, verdict: 'right on target', cls: 'good' });
    // an off-target set still moves (regression guard for the 142.5/center-7 case)
    expect(computeSetAdjustment(5, 7.5, 0, 142.5, 7).delta).toBe(-2.5);
  });
});
