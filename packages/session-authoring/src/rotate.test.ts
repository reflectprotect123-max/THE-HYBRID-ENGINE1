import { describe, it, expect } from 'vitest';
import type { StrengthBlock, LoggedSet } from '@hybrid/engine';
import { rotateBlock, roundStarted } from './rotate';
import { orderFor } from './queue';

const set = (done = false): LoggedSet =>
  done ? { t: '8', rpe: '8', aVal: '60', aVal2: '8', felt: '8', done: true } : { t: '8', rpe: '8' };

const pair = (a: LoggedSet[], b: LoggedSet[]): StrengthBlock<LoggedSet> => ({
  id: 'b1',
  superset: true,
  exercises: [
    { id: 'e0', name: 'Press', mode: 'reps_kg', sets: a },
    { id: 'e1', name: 'Raise', mode: 'reps_kg', sets: b },
  ],
});

describe('roundStarted', () => {
  it('is false when neither movement has logged that round', () => {
    expect(roundStarted(pair([set()], [set()]), 0)).toBe(false);
  });

  it('is true as soon as either has', () => {
    expect(roundStarted(pair([set(true)], [set()]), 0)).toBe(true);
  });
});

describe('rotateBlock', () => {
  it('rotates every round when nothing has been logged', () => {
    const b = rotateBlock(pair([set(), set()], [set(), set()]));
    expect(orderFor(b, 0)).toEqual([1, 0]);
    expect(orderFor(b, 1)).toEqual([1, 0]);
  });

  it('leaves a round that has already begun in the order it ran', () => {
    const b = rotateBlock(pair([set(true), set()], [set(), set()]));
    expect(orderFor(b, 0)).toEqual([0, 1]);   // history
    expect(orderFor(b, 1)).toEqual([1, 0]);   // preference
  });

  it('rotates back, so it is not a one-way door', () => {
    const once = rotateBlock(pair([set()], [set()]));
    expect(orderFor(rotateBlock(once), 0)).toEqual([0, 1]);
  });

  it('is a rotation, not a swap — three movements cycle', () => {
    const trio: StrengthBlock<LoggedSet> = {
      id: 'b1', superset: true,
      exercises: [0, 1, 2].map((i) => ({ id: `e${i}`, name: `M${i}`, mode: 'reps_kg' as const, sets: [set()] })),
    };
    expect(orderFor(rotateBlock(trio), 0)).toEqual([1, 2, 0]);
  });

  it('does not mutate the block it was given', () => {
    const before = pair([set()], [set()]);
    const snapshot = JSON.stringify(before);
    rotateBlock(before);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('leaves a single-movement block alone — there is nothing to rotate', () => {
    const solo: StrengthBlock<LoggedSet> = {
      id: 'b1', exercises: [{ id: 'e0', name: 'Squat', mode: 'reps_kg', sets: [set()] }],
    };
    expect(rotateBlock(solo)).toEqual(solo);
  });
});
