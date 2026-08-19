import { describe, it, expect } from 'vitest';
import { detectPr, type PrEvent } from './pr';

const event = (over: Partial<PrEvent> = {}): PrEvent => ({
  exerciseId: 'sq',
  repCount: 5,
  valueKg: 100,
  achievedAt: '2026-08-10T10:00:00Z',
  performedSetId: 'ps1',
  ...over,
});

describe('detectPr', () => {
  it('is a PR when there is no prior history at all', () => {
    expect(detectPr({ exerciseId: 'sq', reps: 5, loadKg: 100 }, [])).toBe(true);
  });

  it('is a PR when the new load beats the prior best at this rep count', () => {
    expect(detectPr({ exerciseId: 'sq', reps: 5, loadKg: 105 }, [event()])).toBe(true);
  });

  it('is not a PR when the new load ties or is below the prior best at this rep count', () => {
    expect(detectPr({ exerciseId: 'sq', reps: 5, loadKg: 100 }, [event()])).toBe(false);
    expect(detectPr({ exerciseId: 'sq', reps: 5, loadKg: 95 }, [event()])).toBe(false);
  });

  it('compares per rep count — a heavier triple is a PR even with a heavier 5RM on record', () => {
    // pr_event is keyed (athlete, exercise, rep_count, achieved_at): 110x3 has
    // no 3-rep history to beat, so it is a PR regardless of the 120x5.
    const prior = [event({ repCount: 5, valueKg: 120 })];
    expect(detectPr({ exerciseId: 'sq', reps: 3, loadKg: 110 }, prior)).toBe(true);
  });

  it('judges only against prior events with the same rep count, taking their best', () => {
    const prior = [
      event({ repCount: 3, valueKg: 110, achievedAt: '2026-08-01T10:00:00Z' }),
      event({ repCount: 3, valueKg: 115, achievedAt: '2026-08-08T10:00:00Z' }),
      event({ repCount: 5, valueKg: 100 }),
    ];
    expect(detectPr({ exerciseId: 'sq', reps: 3, loadKg: 112 }, prior)).toBe(false);
    expect(detectPr({ exerciseId: 'sq', reps: 3, loadKg: 116 }, prior)).toBe(true);
  });

  it('ignores prior events from a different exercise', () => {
    const prior = [event({ exerciseId: 'front-squat', repCount: 5, valueKg: 200 })];
    expect(detectPr({ exerciseId: 'sq', reps: 5, loadKg: 100 }, prior)).toBe(true);
  });

  it('never registers a reps <= 0 set as a PR — a failed attempt at higher load is not a record', () => {
    expect(detectPr({ exerciseId: 'sq', reps: 0, loadKg: 999 }, [])).toBe(false);
    expect(detectPr({ exerciseId: 'sq', reps: -1, loadKg: 999 }, [event()])).toBe(false);
  });
});
