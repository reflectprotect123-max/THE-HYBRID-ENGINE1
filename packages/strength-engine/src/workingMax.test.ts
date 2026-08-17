import { describe, it, expect } from 'vitest';
import { currentWorkingMax, type WorkingMaxEvent } from './workingMax';

function ev(overrides: Partial<WorkingMaxEvent>): WorkingMaxEvent {
  return {
    id: 'e', athleteId: 'a', exerciseId: 'sq', valueKg: 100,
    source: 'auto_estimate', formula: 'epley', fromSetId: null,
    effectiveAt: '2026-08-01T00:00:00Z', ...overrides,
  };
}

describe('currentWorkingMax', () => {
  it('returns null with no events', () => {
    expect(currentWorkingMax([], '2026-08-20')).toBeNull();
  });

  it('returns the latest event when all events are auto-estimates', () => {
    const events = [ev({ valueKg: 95, effectiveAt: '2026-08-01T00:00:00Z' }), ev({ valueKg: 100, effectiveAt: '2026-08-10T00:00:00Z' })];
    expect(currentWorkingMax(events, '2026-08-20')?.valueKg).toBe(100);
  });

  it('prefers a manual event over a later auto event only when the manual is not older', () => {
    const events = [
      ev({ valueKg: 100, source: 'coach_set', effectiveAt: '2026-08-10T00:00:00Z' }),
      ev({ valueKg: 95, source: 'auto_estimate', effectiveAt: '2026-08-05T00:00:00Z' }),
    ];
    expect(currentWorkingMax(events, '2026-08-20')?.valueKg).toBe(100);
  });

  it('an auto event after a manual event wins if it is genuinely later', () => {
    const events = [
      ev({ valueKg: 100, source: 'coach_set', effectiveAt: '2026-08-01T00:00:00Z' }),
      ev({ valueKg: 105, source: 'auto_estimate', effectiveAt: '2026-08-15T00:00:00Z' }),
    ];
    expect(currentWorkingMax(events, '2026-08-20')?.valueKg).toBe(105);
  });

  it('ignores events after the asOf date', () => {
    const events = [ev({ valueKg: 100, effectiveAt: '2026-08-01T00:00:00Z' }), ev({ valueKg: 999, effectiveAt: '2026-09-01T00:00:00Z' })];
    expect(currentWorkingMax(events, '2026-08-20')?.valueKg).toBe(100);
  });
});
