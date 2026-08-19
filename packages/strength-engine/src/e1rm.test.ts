import { describe, it, expect } from 'vitest';
import { e1rm, BRZYCKI_MAX_REPS } from './e1rm';

describe('e1rm', () => {
  it('returns the load unchanged at 1 rep', () => {
    expect(e1rm(140, 1)).toBe(140);
  });

  it('computes Epley by default', () => {
    expect(e1rm(100, 5)).toBeCloseTo(100 * (1 + 5 / 30), 5);
  });

  it('computes Brzycki when requested', () => {
    expect(e1rm(100, 5, 'brzycki')).toBeCloseTo(100 * (36 / (37 - 5)), 5);
  });

  it('clamps Brzycki reps at BRZYCKI_MAX_REPS instead of silently switching formula', () => {
    // 37+ reps used to fall through to Epley while callers recorded
    // formula: 'brzycki' as provenance. The result must stay a Brzycki
    // number — the clamped one — and stay finite and positive.
    expect(e1rm(100, 37, 'brzycki')).toBe(e1rm(100, BRZYCKI_MAX_REPS, 'brzycki'));
    expect(e1rm(100, 40, 'brzycki')).toBe(e1rm(100, BRZYCKI_MAX_REPS, 'brzycki'));
    expect(Number.isFinite(e1rm(100, 40, 'brzycki'))).toBe(true);
    expect(e1rm(100, 40, 'brzycki')).toBeGreaterThan(0);
    expect(e1rm(100, 40, 'brzycki')).not.toBeCloseTo(e1rm(100, 40, 'epley'), 5);
  });

  it('throws for zero or negative reps', () => {
    expect(() => e1rm(100, 0)).toThrow();
    expect(() => e1rm(100, -1)).toThrow();
  });
});
