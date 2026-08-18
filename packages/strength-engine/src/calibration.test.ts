import { describe, it, expect } from 'vitest';
import { calibrationStateFor } from './calibration';
import type { StrengthExposure } from './exposure';

function exposure(overrides: Partial<StrengthExposure>): StrengthExposure {
  return {
    exerciseId: 'sq', assignedSessionId: 'as1', reps: 5, loadKg: 100, rated: true, painFlagged: false, onTarget: true,
    exposureClass: 'successful', performedSetId: 'p1', performedAt: '2026-08-20T10:00:00Z',
    ...overrides,
  };
}

describe('calibrationStateFor', () => {
  it('is uncalibrated with zero usable exposures', () => {
    expect(calibrationStateFor([])).toBe('uncalibrated');
  });

  it('is uncalibrated when every exposure is pain_blocked (no usable evidence)', () => {
    const exposures = [exposure({ exposureClass: 'pain_blocked' }), exposure({ exposureClass: 'pain_blocked', performedSetId: 'p2' })];
    expect(calibrationStateFor(exposures)).toBe('uncalibrated');
  });

  it('is building with 1-2 usable exposures', () => {
    expect(calibrationStateFor([exposure({}), exposure({ performedSetId: 'p2' })])).toBe('building');
  });

  it('is calibrated at exactly 3 usable exposures', () => {
    const exposures = [exposure({ performedSetId: 'p1' }), exposure({ performedSetId: 'p2' }), exposure({ performedSetId: 'p3' })];
    expect(calibrationStateFor(exposures)).toBe('calibrated');
  });

  it('pain_blocked exposures do not count toward the 3-exposure minimum', () => {
    const exposures = [exposure({ performedSetId: 'p1' }), exposure({ performedSetId: 'p2' }), exposure({ exposureClass: 'pain_blocked', performedSetId: 'p3' })];
    expect(calibrationStateFor(exposures)).toBe('building');
  });
});
