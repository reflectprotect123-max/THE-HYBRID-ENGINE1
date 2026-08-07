import { describe, expect, it } from 'vitest';
import { geoDownsample, haversineM, paceSecPerKm, totalDistanceM } from './geo';
import { fmtDistance, fmtPace } from './num';

describe('haversineM', () => {
  it('is zero for the same point', () => {
    expect(haversineM({ lat: 51.5, lon: -0.1 }, { lat: 51.5, lon: -0.1 })).toBe(0);
  });

  it('matches the known ~111.3km-per-degree scale at the equator', () => {
    const d = haversineM({ lat: 0, lon: 0 }, { lat: 0, lon: 0.01 });
    expect(d).toBeGreaterThan(1000);
    expect(d).toBeLessThan(1200);
  });
});

describe('totalDistanceM', () => {
  it('sums a plausible run', () => {
    const d = totalDistanceM([
      { t: 0, lat: 0, lon: 0 },
      { t: 10, lat: 0.00027, lon: 0 },
    ]);
    expect(d).toBeGreaterThan(25);
    expect(d).toBeLessThan(35);
  });

  it('drops a hop implying a speed above the plausible ceiling (~10 m/s)', () => {
    const d = totalDistanceM([
      { t: 0, lat: 0, lon: 0 },
      { t: 10, lat: 0.00027, lon: 0 }, // ~30m over 10s — plausible, ~3 m/s
      { t: 20, lat: 0.00027, lon: 0.01 }, // ~1112m over 10s — ~111 m/s, dropped
    ]);
    expect(d).toBeGreaterThan(25);
    expect(d).toBeLessThan(35);
  });

  it('is zero for fewer than two samples', () => {
    expect(totalDistanceM([])).toBe(0);
    expect(totalDistanceM([{ t: 0, lat: 0, lon: 0 }])).toBe(0);
  });
});

describe('geoDownsample', () => {
  it('buckets samples and leaves empty buckets null, mirroring conDownsample', () => {
    const ds = geoDownsample(
      [
        { t: 0, lat: 1, lon: 2 },
        { t: 1, lat: 3, lon: 4 },
        { t: 5, lat: 10, lon: 20 },
      ],
      10,
    );
    expect(ds.every).toBe(2);
    expect(ds.pts).toHaveLength(6);
    expect(ds.pts[0]).toEqual({ lat: 2, lon: 3 });
    expect(ds.pts[1]).toBeNull();
    expect(ds.pts[2]).toEqual({ lat: 10, lon: 20 });
    expect(ds.pts[3]).toBeNull();
  });
});

describe('paceSecPerKm', () => {
  it('is null for zero or negative distance', () => {
    expect(paceSecPerKm(0, 100)).toBeNull();
    expect(paceSecPerKm(-5, 100)).toBeNull();
  });

  it('computes seconds per kilometre', () => {
    expect(paceSecPerKm(1000, 300)).toBe(300);
    expect(paceSecPerKm(500, 300)).toBe(600);
  });
});

describe('fmtPace', () => {
  it('formats seconds-per-km as m:ss/km', () => {
    expect(fmtPace(312)).toBe('5:12/km');
    expect(fmtPace(60)).toBe('1:00/km');
  });

  it('is blank for a non-positive or non-finite input', () => {
    expect(fmtPace(0)).toBe('');
    expect(fmtPace(-10)).toBe('');
    expect(fmtPace(NaN)).toBe('');
  });
});

describe('fmtDistance', () => {
  it('shows metres under a kilometre', () => {
    expect(fmtDistance(850)).toBe('850 m');
  });

  it('shows one decimal of kilometres at or above a kilometre', () => {
    expect(fmtDistance(5200)).toBe('5.2 km');
    expect(fmtDistance(1000)).toBe('1.0 km');
  });

  it('is blank for a non-positive or non-finite input', () => {
    expect(fmtDistance(0)).toBe('');
    expect(fmtDistance(NaN)).toBe('');
  });
});
