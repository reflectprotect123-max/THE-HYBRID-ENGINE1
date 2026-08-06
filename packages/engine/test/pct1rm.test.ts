import { describe, expect, it } from 'vitest';
import { pctForSet, prescribedKgForSet } from '../src/pct1rm';
import type { Exercise, LoggedSet } from '../src/types';

const ex = (sets: LoggedSet[]): Exercise<LoggedSet> => ({
  id: 'e1',
  name: 'Back squat',
  mode: 'reps_kg',
  sets,
});

describe('pctForSet', () => {
  it('a flat percentage (lo === hi) applies to every set regardless of RPE', () => {
    const e = ex([
      { t: '5', rpe: '7', pct1rm: { lo: 65, hi: 65 } },
      { t: '5', rpe: '9', pct1rm: { lo: 65, hi: 65 } },
    ]);
    expect(pctForSet(e, 0)).toBe(65);
    expect(pctForSet(e, 1)).toBe(65);
  });

  it('ramps a range across authored RPE: 60-65% at RPE 7/8/9 -> 60/62.5/65', () => {
    const e = ex([
      { t: '5', rpe: '7', pct1rm: { lo: 60, hi: 65 } },
      { t: '5', rpe: '8', pct1rm: { lo: 60, hi: 65 } },
      { t: '5', rpe: '9', pct1rm: { lo: 60, hi: 65 } },
    ]);
    expect(pctForSet(e, 0)).toBe(60);
    expect(pctForSet(e, 1)).toBe(62.5);
    expect(pctForSet(e, 2)).toBe(65);
  });

  it('gives every set the ceiling when every rated set shares the same RPE', () => {
    const e = ex([
      { t: '5', rpe: '8', pct1rm: { lo: 60, hi: 65 } },
      { t: '5', rpe: '8', pct1rm: { lo: 60, hi: 65 } },
    ]);
    expect(pctForSet(e, 0)).toBe(65);
    expect(pctForSet(e, 1)).toBe(65);
  });

  it('excludes a warm-up set from the RPE spread even if it carried pct1rm', () => {
    const e = ex([
      { t: 'W10', rpe: '4', pct1rm: { lo: 60, hi: 65 } },
      { t: '5', rpe: '8', pct1rm: { lo: 60, hi: 65 } },
      { t: '5', rpe: '9', pct1rm: { lo: 60, hi: 65 } },
    ]);
    // If the warm-up's RPE 4 leaked into the spread, set 1 (RPE 8) would not
    // read as the floor of the two RATED sets.
    expect(pctForSet(e, 1)).toBe(60);
    expect(pctForSet(e, 2)).toBe(65);
  });

  it('returns null for a set with no pct1rm', () => {
    const e = ex([{ t: '5', rpe: '8' }]);
    expect(pctForSet(e, 0)).toBeNull();
  });

  it('returns null for a warm-up set even when it carries a stray pct1rm', () => {
    // Reachable in practice: switch an exercise into % mode, then retype a
    // rated set's target to start with `W` — `fillLinkedSets` preserves
    // pct1rm through that edit, and the mode-selector's warm-up guard only
    // ever skips writing pct1rm onto a set that is ALREADY a warm-up; it
    // does nothing once a rated set with pct1rm turns into one after the
    // fact. `targetLine` must never show "% of 1RM" on a warm-up, so the
    // invariant is enforced here, at the source, rather than by every caller.
    const e = ex([{ t: 'W5', rpe: '', pct1rm: { lo: 65, hi: 65 } }]);
    expect(pctForSet(e, 0)).toBeNull();
  });
});

describe('prescribedKgForSet', () => {
  it('computes pct-of-e1RM and rounds to the plate increment', () => {
    const e = ex([{ t: '5', rpe: '8', pct1rm: { lo: 65, hi: 65 } }]);
    // 65% of 116.67 = 75.833..., rounds to the nearest 2.5kg plate: 75.
    expect(prescribedKgForSet(e, 0, 116.67)).toBe(75);
  });

  it('returns null when the set carries no pct1rm', () => {
    const e = ex([{ t: '5', rpe: '8' }]);
    expect(prescribedKgForSet(e, 0, 116.67)).toBeNull();
  });

  it('returns null for a warm-up set even when it carries a stray pct1rm', () => {
    const e = ex([{ t: 'W5', rpe: '', pct1rm: { lo: 65, hi: 65 } }]);
    expect(prescribedKgForSet(e, 0, 116.67)).toBeNull();
  });
});
