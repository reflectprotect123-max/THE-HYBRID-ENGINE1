import { describe, it, expect } from 'vitest';
import type { StrengthBlock, LoggedSet } from '@hybrid/engine';
import { restAfter, tickRest, extendRest } from './rest';

const s = (done = false): LoggedSet =>
  done ? { t: '8', rpe: '8', aVal: '60', aVal2: '8', felt: '8', done: true } : { t: '8', rpe: '8' };

const solo = (sets: LoggedSet[], rest?: number): StrengthBlock<LoggedSet> => ({
  id: 'b1',
  exercises: [{ id: 'e0', name: 'Squat', mode: 'reps_kg', sets, rest }],
});

describe('restAfter', () => {
  it('rests for the exercise’s own rest, between sets', () => {
    const b = solo([s(true), s()], 120);
    expect(restAfter(b, { exerciseIndex: 0, setIndex: 0 })).toEqual({ left: 120, total: 120, kind: 'set' });
  });

  it('turns the page when the block is finished, with no clock to wait out', () => {
    const b = solo([s(true)], 120);
    expect(restAfter(b, { exerciseIndex: 0, setIndex: 0 })).toEqual({ left: 0, total: 0, kind: 'block' });
  });

  it('does not rest when the exercise asks for none', () => {
    const b = solo([s(true), s()], 0);
    expect(restAfter(b, { exerciseIndex: 0, setIndex: 0 })).toBeNull();
  });
});

describe('tickRest', () => {
  it('counts down', () => {
    expect(tickRest({ left: 2, total: 120, kind: 'set' })).toEqual({ left: 1, total: 120, kind: 'set' });
  });

  it('stops at zero rather than going negative', () => {
    expect(tickRest({ left: 0, total: 120, kind: 'set' })).toEqual({ left: 0, total: 120, kind: 'set' });
  });

  it('leaves a page-turn alone — it is not a clock', () => {
    expect(tickRest({ left: 0, total: 0, kind: 'block' })).toEqual({ left: 0, total: 0, kind: 'block' });
  });
});

describe('extendRest', () => {
  it('adds to both what is left and the whole, so the dial stays honest', () => {
    expect(extendRest({ left: 30, total: 120, kind: 'set' }, 15)).toEqual({ left: 45, total: 135, kind: 'set' });
  });
});
