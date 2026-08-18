import { describe, it, expect } from 'vitest';
import { progressionQueryText } from './queryText';
import type { Exercise } from './exercise';
import type { StrengthExposure } from './exposure';

const squat: Exercise = {
  id: 'sq', ownerId: null, name: 'Back Squat', videoAssetId: null, cues: null,
  equipment: null, defaultMetrics: ['reps', 'load'], referenceMaxExerciseId: null,
  trackAsExerciseId: null, e1rmFormula: 'epley',
};

function exposure(overrides: Partial<StrengthExposure>): StrengthExposure {
  return {
    exerciseId: 'sq', assignedSessionId: 'as1', reps: 5, loadKg: 100, rated: true,
    onTarget: true, painFlagged: false, exposureClass: 'successful',
    performedSetId: 'p1', performedAt: '2026-08-20T10:00:00Z', ...overrides,
  };
}

describe('progressionQueryText', () => {
  it('names the exercise, calibration state, and recent exposure classes', () => {
    const exposures = [
      exposure({ performedSetId: 'p1', exposureClass: 'successful', performedAt: '2026-08-10T10:00:00Z' }),
      exposure({ performedSetId: 'p2', exposureClass: 'missed', performedAt: '2026-08-15T10:00:00Z' }),
      exposure({ performedSetId: 'p3', exposureClass: 'missed', performedAt: '2026-08-20T10:00:00Z' }),
    ];
    const text = progressionQueryText(squat, exposures, 'calibrated');
    expect(text).toBe('Back Squat: calibration=calibrated, recent exposures: successful, missed, missed');
  });

  it('flags a pain-flagged exposure inline', () => {
    const exposures = [exposure({ exposureClass: 'pain_blocked', painFlagged: true })];
    const text = progressionQueryText(squat, exposures, 'building');
    expect(text).toBe('Back Squat: calibration=building, recent exposures: pain_blocked (pain flagged)');
  });

  it('only names the last 3 exposures, oldest of the window first', () => {
    const exposures = Array.from({ length: 5 }, (_, i) => exposure({
      performedSetId: `p${i}`,
      exposureClass: i < 3 ? 'missed' : 'successful',
      performedAt: `2026-08-${10 + i}T10:00:00Z`,
    }));
    const text = progressionQueryText(squat, exposures, 'calibrated');
    expect(text).toBe('Back Squat: calibration=calibrated, recent exposures: missed, successful, successful');
  });

  it('sorts out-of-order exposures by performedAt before taking the last 3 — an arbitrary caller cannot be trusted to arrive oldest-first', () => {
    const outOfOrder = [
      exposure({ performedSetId: 'p5', exposureClass: 'successful', performedAt: '2026-08-25T10:00:00Z' }),
      exposure({ performedSetId: 'p1', exposureClass: 'missed', performedAt: '2026-08-10T10:00:00Z' }),
      exposure({ performedSetId: 'p3', exposureClass: 'successful', performedAt: '2026-08-18T10:00:00Z' }),
      exposure({ performedSetId: 'p4', exposureClass: 'missed', performedAt: '2026-08-20T10:00:00Z' }),
      exposure({ performedSetId: 'p2', exposureClass: 'missed', performedAt: '2026-08-15T10:00:00Z' }),
    ];
    const inOrder = [...outOfOrder].sort((a, b) => a.performedAt.localeCompare(b.performedAt));
    expect(progressionQueryText(squat, outOfOrder, 'calibrated')).toBe(progressionQueryText(squat, inOrder, 'calibrated'));
    expect(progressionQueryText(squat, outOfOrder, 'calibrated')).toBe(
      'Back Squat: calibration=calibrated, recent exposures: successful, missed, successful'
    );
  });

  it('is deterministic — the same inputs always produce the same text, so the same query embeds the same way', () => {
    const exposures = [exposure({})];
    expect(progressionQueryText(squat, exposures, 'building')).toBe(progressionQueryText(squat, exposures, 'building'));
  });
});
