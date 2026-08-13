import { describe, expect, it } from 'vitest';
import { prefillPrimary } from './logger';
import type { Exercise, LoggedSet } from './types';

const ex = (name: string, sets: LoggedSet[]): Exercise<LoggedSet> => ({
  id: 'e1',
  name,
  mode: 'reps_kg',
  tempo: '',
  rest: 90,
  sets,
});

/** Prefill for the first set the athlete has not yet done. */
const prefillFor = (sets: LoggedSet[]): string => {
  const e = ex('Back squat', sets);
  const si = e.sets.findIndex((st) => !st.done);
  return prefillPrimary(e, si);
};

describe('prefillPrimary reads the fold', () => {
  it('prefills from the fold, so two easy sets earn more than one does', () => {
    const one = prefillFor([
      { t: '8', rpe: '8', aVal: '100', aVal2: '8', felt: '7', done: true },
      { t: '8', rpe: '8' },
    ]);
    const two = prefillFor([
      { t: '8', rpe: '8', aVal: '100', aVal2: '8', felt: '7', done: true },
      { t: '8', rpe: '8', aVal: '100', aVal2: '8', felt: '7', done: true },
      { t: '8', rpe: '8' },
    ]);
    expect(Number(two)).toBeGreaterThan(Number(one));
  });
});
