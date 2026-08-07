/*
 * These primitives exist only to keep the port bit-identical to Python, so
 * every expectation below is a value produced by CPython 3.11, not by
 * inspection of the TypeScript. Where a naive JS equivalent disagrees, the
 * disagreement is asserted too — that is the whole reason the helper exists.
 */

import { describe, expect, it } from 'vitest';

import { clamp, fmean, fsum, naiveSum, pyRound } from './numeric';

describe('fsum', () => {
  it('is exact where a running total cancels catastrophically', () => {
    expect(fsum([1e100, 1, -1e100])).toBe(1);
    expect(naiveSum([1e100, 1, -1e100])).toBe(0);
  });

  it('is exact where a running total accumulates rounding error', () => {
    const tenths = Array.from({ length: 10 }, () => 0.1);
    expect(fsum(tenths)).toBe(1);
    expect(naiveSum(tenths)).toBe(0.9999999999999999);
  });

  it('keeps both small terms beside a large one', () => {
    expect(fsum([1e16, 1, 1, -1e16])).toBe(2);
  });

  it('returns zero for no terms', () => {
    expect(fsum([])).toBe(0);
  });
});

describe('fmean', () => {
  it('matches statistics.fmean on the doc example', () => {
    expect(fmean([3.5, 4.0, 5.25])).toBe(4.25);
  });

  it('refuses an empty series rather than returning NaN', () => {
    expect(() => fmean([])).toThrow(/at least one data point/);
  });
});

describe('pyRound', () => {
  // [value, digits, Python's round(value, digits)]
  const cases: [number, number, number][] = [
    [18.25, 1, 18.2],
    [18.35, 1, 18.4],
    [2.5, 0, 2],
    [3.5, 0, 4],
    [-2.5, 0, -2],
    [0.125, 2, 0.12],
    [0.135, 2, 0.14],
    [2.675, 2, 2.67],
    [-18.25, 1, -18.2],
    [0.15, 1, 0.1],
    [2.25, 1, 2.2],
    [2.35, 1, 2.4],
    [1234.5, 0, 1234],
    [1235.5, 0, 1236],
    [360.25, 1, 360.2],
    [2500.05, 1, 2500.1],
    [1e-9, 1, 0],
    [1e21, 1, 1e21],
  ];

  for (const [value, digits, expected] of cases) {
    it(`round(${value}, ${digits}) === ${expected}`, () => {
      expect(pyRound(value, digits)).toBe(expected);
    });
  }

  it('breaks exact ties to even, where toFixed and Math.round break them up', () => {
    // A carbohydrate target is calories/4, so `.25` and `.75` ties are routine.
    expect(pyRound(18.25, 1)).toBe(18.2);
    expect(Number((18.25).toFixed(1))).toBe(18.3);
    expect(Math.round(18.25 * 10) / 10).toBe(18.3);
  });

  it('leaves non-finite values and signed zero alone', () => {
    expect(pyRound(Number.NaN, 1)).toBeNaN();
    expect(pyRound(Number.POSITIVE_INFINITY, 1)).toBe(Number.POSITIVE_INFINITY);
    expect(Object.is(pyRound(-0, 1), -0)).toBe(true);
  });
});

describe('clamp', () => {
  it('bounds on both sides', () => {
    expect(clamp(5, 1, 3)).toBe(3);
    expect(clamp(0, 1, 3)).toBe(1);
    expect(clamp(2, 1, 3)).toBe(2);
  });
});
