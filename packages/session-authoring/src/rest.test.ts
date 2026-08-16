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

describe('EMOM pacing — restAfter with `every`', () => {
  /*
   * Added 16 August 2026 at the owner's request: "the format needs to sit in
   * the rest screen with a single or an emom style with a timer, which is then
   * X the amount of sets."
   */
  const paced = (sets: LoggedSet[], every: number, rest?: number): StrengthBlock<LoggedSet> => ({
    id: 'b1',
    exercises: [{ id: 'e0', name: 'Squat', mode: 'reps_kg', sets, rest, every }],
  });

  it('gives back the window MINUS the time the set took', () => {
    /* The whole difference from `rest`, which starts when the set ends. A
       150s window and a 40s set leaves 110; the total stays the window, so the
       dial still draws the fraction of the interval that is left. */
    const b = paced([s(true), s()], 150);
    expect(restAfter(b, { exerciseIndex: 0, setIndex: 0 }, 40)).toEqual({
      left: 110,
      total: 150,
      kind: 'set',
      paced: true,
    });
  });

  it('gives NO rest when the set overran its window', () => {
    /* A 0:00 dial would read as a rest that ran out. The athlete is late and
       the next set is owed now, so there is nothing to wait through. */
    const b = paced([s(true), s()], 150);
    expect(restAfter(b, { exerciseIndex: 0, setIndex: 0 }, 150)).toBeNull();
    expect(restAfter(b, { exerciseIndex: 0, setIndex: 0 }, 400)).toBeNull();
  });

  it('beats `rest` when the exercise carries both', () => {
    /* `every` is the more specific instruction; `rest` survives so switching
       the mode back on the bench does not lose the coach's number. */
    const b = paced([s(true), s()], 150, 90);
    expect(restAfter(b, { exerciseIndex: 0, setIndex: 0 }, 0)?.total).toBe(150);
  });

  it('still turns the page after the LAST set rather than pacing into nothing', () => {
    const b = paced([s(true)], 150);
    expect(restAfter(b, { exerciseIndex: 0, setIndex: 0 }, 10)).toEqual({ left: 0, total: 0, kind: 'block' });
  });

  it('marks itself paced, so the athlete is told a deadline and not a rest', () => {
    const plain = restAfter(solo([s(true), s()], 120), { exerciseIndex: 0, setIndex: 0 });
    expect(plain?.paced).toBeUndefined();
    expect(restAfter(paced([s(true), s()], 150), { exerciseIndex: 0, setIndex: 0 }, 0)?.paced).toBe(true);
  });
});
