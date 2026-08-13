import { describe, it, expect } from 'vitest';
import type { StrengthBlock, LoggedSet } from '@hybrid/engine';
import { openDraft, applyDraft, draftReady } from './draft';

const done = (kg: string, reps: string, felt: string): LoggedSet =>
  ({ t: reps, rpe: '8', aVal: kg, aVal2: reps, felt, done: true });

const one = (sets: LoggedSet[]): StrengthBlock<LoggedSet> => ({
  id: 'b1',
  exercises: [{ id: 'e0', name: 'Squat', mode: 'reps_kg', sets }],
});

describe('openDraft', () => {
  it('opens at the weight the coaching rule asks for', () => {
    const b = one([done('100', '8', '8'), { t: '8', rpe: '8' }]);
    expect(openDraft(b, { exerciseIndex: 0, setIndex: 1 }).kg).toBe(100);
  });

  it('opens at the planned reps, so the common case is one tap', () => {
    const b = one([{ t: '8', rpe: '8' }]);
    expect(openDraft(b, { exerciseIndex: 0, setIndex: 0 }).reps).toBe(8);
  });

  it('opens a max set at zero reps — the count is the whole point of it', () => {
    const b = one([{ t: 'max', rpe: '10' }]);
    expect(openDraft(b, { exerciseIndex: 0, setIndex: 0 }).reps).toBe(0);
  });

  it('never guesses how hard it was', () => {
    const b = one([{ t: '8', rpe: '8' }]);
    expect(openDraft(b, { exerciseIndex: 0, setIndex: 0 }).felt).toBeNull();
  });
});

describe('draftReady', () => {
  it('needs reps and a rating before it can be logged', () => {
    expect(draftReady({ kg: 100, reps: 8, felt: null })).toBe(false);
    expect(draftReady({ kg: 100, reps: 0, felt: 8 })).toBe(false);
    expect(draftReady({ kg: 100, reps: 8, felt: 8 })).toBe(true);
  });

  it('allows a bodyweight set, which has no weight to enter', () => {
    expect(draftReady({ kg: 0, reps: 8, felt: 8 })).toBe(true);
  });
});

describe('applyDraft', () => {
  it('writes the draft onto the set and marks it done', () => {
    const b = applyDraft(one([{ t: '8', rpe: '8' }]), { exerciseIndex: 0, setIndex: 0 }, { kg: 102.5, reps: 7, felt: 9 });
    expect(b.exercises[0].sets[0]).toMatchObject({ aVal: '102.5', aVal2: '7', felt: '9', done: true });
  });

  it('leaves the planned target alone — the plan is not rewritten by doing it', () => {
    const b = applyDraft(one([{ t: '8', rpe: '8' }]), { exerciseIndex: 0, setIndex: 0 }, { kg: 100, reps: 7, felt: 9 });
    expect(b.exercises[0].sets[0].t).toBe('8');
    expect(b.exercises[0].sets[0].rpe).toBe('8');
  });

  it('does not mutate the block it was given', () => {
    const before = one([{ t: '8', rpe: '8' }]);
    const snapshot = JSON.stringify(before);
    applyDraft(before, { exerciseIndex: 0, setIndex: 0 }, { kg: 100, reps: 8, felt: 8 });
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
