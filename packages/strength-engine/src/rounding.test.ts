import { describe, it, expect } from 'vitest';
import { roundToIncrement } from './rounding';
import type { Equipment } from './exercise';

const barbell: Equipment = { id: 'e1', name: 'Barbell (kg)', incrementKg: 2.5, rackValuesKg: null, rounding: 'down' };
const nearestBarbell: Equipment = { ...barbell, rounding: 'nearest' };
const dbRack: Equipment = { id: 'e2', name: 'Dumbbell rack', incrementKg: null, rackValuesKg: [2.5, 5, 7.5, 10, 12.5, 15, 20, 25, 30, 35, 40], rounding: 'down' };

describe('roundToIncrement', () => {
  it('returns the raw value when there is no equipment', () => {
    expect(roundToIncrement(101.3, null)).toBe(101.3);
  });

  it('rounds down to the increment by default', () => {
    expect(roundToIncrement(103, barbell)).toBe(102.5);
  });

  it('rounds to nearest when equipment opts in', () => {
    expect(roundToIncrement(103.8, nearestBarbell)).toBe(105);
  });

  it('snaps to the nearest declared rack value', () => {
    expect(roundToIncrement(23, dbRack)).toBe(20);
  });

  it('clamps to the lowest rack value below range', () => {
    expect(roundToIncrement(1, dbRack)).toBe(2.5);
  });

  it('clamps to the highest rack value above range', () => {
    expect(roundToIncrement(45, dbRack)).toBe(40);
  });
});
