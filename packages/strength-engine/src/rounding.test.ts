import { describe, it, expect } from 'vitest';
import { roundLoadToEquipment } from './rounding';
import type { Equipment } from './exercise';

const barbell: Equipment = { id: 'e1', name: 'Barbell (kg)', incrementKg: 2.5, rackValuesKg: null, rounding: 'down' };
const nearestBarbell: Equipment = { ...barbell, rounding: 'nearest' };
const dbRack: Equipment = { id: 'e2', name: 'Dumbbell rack', incrementKg: null, rackValuesKg: [2.5, 5, 7.5, 10, 12.5, 15, 20, 25, 30, 35, 40], rounding: 'down' };

describe('roundLoadToEquipment', () => {
  it('returns the raw value when there is no equipment', () => {
    expect(roundLoadToEquipment(101.3, null)).toBe(101.3);
  });

  it('rounds down to the increment by default', () => {
    expect(roundLoadToEquipment(103, barbell)).toBe(102.5);
  });

  it('rounds to nearest when equipment opts in', () => {
    expect(roundLoadToEquipment(103.8, nearestBarbell)).toBe(105);
  });

  it('snaps to the nearest declared rack value', () => {
    expect(roundLoadToEquipment(23, dbRack)).toBe(20);
  });

  it('clamps to the lowest rack value below range', () => {
    expect(roundLoadToEquipment(1, dbRack)).toBe(2.5);
  });

  it('clamps to the highest rack value above range', () => {
    expect(roundLoadToEquipment(45, dbRack)).toBe(40);
  });

  it("returns the value unrounded for rounding: 'none' — no increment math, no rack snap", () => {
    const noneBarbell: Equipment = { ...barbell, rounding: 'none' };
    expect(roundLoadToEquipment(103.8, noneBarbell)).toBe(103.8);
    const noneRack: Equipment = { ...dbRack, rounding: 'none' };
    expect(roundLoadToEquipment(23.1, noneRack)).toBe(23.1);
  });

  it('treats a zero or negative increment as no increment instead of dividing by it', () => {
    expect(roundLoadToEquipment(103.8, { ...barbell, incrementKg: 0 })).toBe(103.8);
    expect(roundLoadToEquipment(103.8, { ...barbell, incrementKg: -2.5 })).toBe(103.8);
  });

  it('throws on a non-finite load instead of snapping NaN to the lightest rack value', () => {
    expect(() => roundLoadToEquipment(NaN, dbRack)).toThrow(/finite load/);
    expect(() => roundLoadToEquipment(Infinity, barbell)).toThrow(/finite load/);
    expect(() => roundLoadToEquipment(NaN, null)).toThrow(/finite load/);
  });
});
