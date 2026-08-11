import { describe, expect, it } from 'vitest';
import { hrMaxBandSeconds } from './hr';

/*
 * The five-zone %HRmax breakdown is DISPLAY-ONLY context for the coach
 * bench. The three-zone model (`zoneSeconds`) still drives every
 * prescription and progression — see the redesign spec. These tests pin the
 * band edges and the two honesty rules: a null sample is not time, and a
 * beat below Z1 is not Z1.
 */
describe('hrMaxBandSeconds', () => {
  it('banks each sample into its %HRmax band, one `every` at a time', () => {
    // maxHr 200 → Z1 100-119, Z2 120-139, Z3 140-159, Z4 160-179, Z5 180+
    const ds = { every: 10, pts: [110, 130, 150, 170, 190] };
    expect(hrMaxBandSeconds(ds, 200)).toEqual({ z1: 10, z2: 10, z3: 10, z4: 10, z5: 10 });
  });

  it('excludes beats under 50% of max — warm-up drift is not Z1', () => {
    const ds = { every: 5, pts: [80, 99, 110] }; // 40%, 49.5%, 55%
    expect(hrMaxBandSeconds(ds, 200)).toEqual({ z1: 5, z2: 0, z3: 0, z4: 0, z5: 0 });
  });

  it('skips null samples rather than counting them as time', () => {
    const ds = { every: 10, pts: [150, null, 150] };
    expect(hrMaxBandSeconds(ds, 200).z3).toBe(20);
  });

  it('returns all zeroes for an absent trace — no HR recorded is not zero minutes trained', () => {
    expect(hrMaxBandSeconds(null, 200)).toEqual({ z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 });
    expect(hrMaxBandSeconds(undefined, 200)).toEqual({ z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 });
  });

  it('returns all zeroes rather than dividing by a nonsense max', () => {
    expect(hrMaxBandSeconds({ every: 10, pts: [150] }, 0)).toEqual({ z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 });
  });

  it('puts a beat at exactly a band edge in the higher band', () => {
    // 120 is exactly 60% of 200 → Z2, not Z1
    expect(hrMaxBandSeconds({ every: 10, pts: [120] }, 200)).toEqual({ z1: 0, z2: 10, z3: 0, z4: 0, z5: 0 });
  });
});
