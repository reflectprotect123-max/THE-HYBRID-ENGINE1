import { describe, it, expect } from 'vitest';
import type { StrengthBlock, LoggedSet } from '@hybrid/engine';
import { orderFor, blockQueue, nextUp, roundCount } from './queue';

const set = (t: string, done = false): LoggedSet =>
  done ? { t, rpe: '8', aVal: '60', aVal2: t, felt: '8', done: true } : { t, rpe: '8' };

const block = (sets: LoggedSet[][], over: Partial<StrengthBlock<LoggedSet>> = {}): StrengthBlock<LoggedSet> => ({
  id: 'b1',
  superset: sets.length > 1,
  exercises: sets.map((s, i) => ({ id: `e${i}`, name: `Move ${i}`, mode: 'reps_kg', sets: s })),
  ...over,
});

describe('roundCount', () => {
  it('is the longest exercise in the block', () => {
    expect(roundCount(block([[set('8'), set('8')], [set('8')]]))).toBe(2);
  });
});

describe('orderFor', () => {
  it('is the order the exercises are stored in, by default', () => {
    expect(orderFor(block([[set('8')], [set('8')]]), 0)).toEqual([0, 1]);
  });

  it('honours a recorded order for that round', () => {
    const b = block([[set('8')], [set('8')]], { roundOrder: { 0: [1, 0] } });
    expect(orderFor(b, 0)).toEqual([1, 0]);
    expect(orderFor(b, 1)).toEqual([0, 1]);
  });
});

describe('blockQueue', () => {
  it('runs a superset round-major, not exercise-major', () => {
    const q = blockQueue(block([[set('8'), set('8')], [set('8'), set('8')]]));
    expect(q).toEqual([
      { exerciseIndex: 0, setIndex: 0 },
      { exerciseIndex: 1, setIndex: 0 },
      { exerciseIndex: 0, setIndex: 1 },
      { exerciseIndex: 1, setIndex: 1 },
    ]);
  });

  it('drops the exercise that runs out, rather than shifting the rest up', () => {
    const q = blockQueue(block([[set('8'), set('8')], [set('8')]]));
    expect(q).toEqual([
      { exerciseIndex: 0, setIndex: 0 },
      { exerciseIndex: 1, setIndex: 0 },
      { exerciseIndex: 0, setIndex: 1 },
    ]);
  });

  it('follows a rotated round', () => {
    const b = block([[set('8')], [set('8')]], { roundOrder: { 0: [1, 0] } });
    expect(blockQueue(b)).toEqual([
      { exerciseIndex: 1, setIndex: 0 },
      { exerciseIndex: 0, setIndex: 0 },
    ]);
  });

  it('skips warm-up sets — they are performed, but they are not the working queue', () => {
    const q = blockQueue(block([[set('W10'), set('8')]]));
    expect(q).toEqual([{ exerciseIndex: 0, setIndex: 1 }]);
  });
});

describe('nextUp', () => {
  it('is the first set not yet done', () => {
    expect(nextUp(block([[set('8', true), set('8')]]))).toEqual({ exerciseIndex: 0, setIndex: 1 });
  });

  it('is null once the block is finished', () => {
    expect(nextUp(block([[set('8', true)]]))).toBeNull();
  });

  it('returns to a gap left behind, rather than running past it', () => {
    // set 1 skipped, set 2 done: the queue still owes set 1
    expect(nextUp(block([[set('8'), set('8', true)]]))).toEqual({ exerciseIndex: 0, setIndex: 0 });
  });
});
