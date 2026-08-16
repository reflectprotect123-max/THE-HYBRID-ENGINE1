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

  /*
   * A dumbbell rack moves in 2kg, not in the barbell's 2.5. Before
   * `Exercise.inc` existed, every movement rounded to the one global
   * increment and a 12kg dumbbell's next step was priced at 12.5 — a weight
   * that is not on the rack. Caught by the parity harness, which drove the
   * prototype's own per-exercise increments through the real screens.
   */
  it("rounds to the exercise's own increment when it has one", () => {
    const b = one([done('12', '10', '7'), { t: '10', rpe: '8' }]);
    b.exercises[0].inc = 2;
    // One easy set earns 1%: 12 × 1.01 = 12.12, which rounds to the nearest
    // 2kg the rack actually has — 12, i.e. the same dumbbell again.
    expect(openDraft(b, { exerciseIndex: 0, setIndex: 1 }).kg).toBe(12);
  });

  it('falls back to the global increment when the exercise carries none', () => {
    const b = one([done('12', '10', '7'), { t: '10', rpe: '8' }]);
    // The same 12.12, rounded to the barbell's 2.5 instead — 12.5, a dumbbell
    // that does not exist. That divergence is the whole reason `inc` does.
    expect(openDraft(b, { exerciseIndex: 0, setIndex: 1 }).kg).toBe(12.5);
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

/** A draft that matches its own offer — the ordinary, non-override case. */
const asOffered = (kg: number, reps: number, felt: number | null) => ({
  kg,
  reps,
  felt,
  offered: kg,
  note: '',
  pain: false,
});

describe('draftReady', () => {
  it('needs reps and a rating before it can be logged', () => {
    expect(draftReady(asOffered(100, 8, null))).toBe(false);
    expect(draftReady(asOffered(100, 0, 8))).toBe(false);
    expect(draftReady(asOffered(100, 8, 8))).toBe(true);
  });

  it('allows a bodyweight set, which has no weight to enter', () => {
    expect(draftReady(asOffered(0, 8, 8))).toBe(true);
  });
});

describe('applyDraft', () => {
  it('writes the draft onto the set and marks it done', () => {
    const b = applyDraft(one([{ t: '8', rpe: '8' }]), { exerciseIndex: 0, setIndex: 0 }, asOffered(102.5, 7, 9));
    expect(b.exercises[0].sets[0]).toMatchObject({ aVal: '102.5', aVal2: '7', felt: '9', done: true });
  });

  it('leaves the planned target alone — the plan is not rewritten by doing it', () => {
    const b = applyDraft(one([{ t: '8', rpe: '8' }]), { exerciseIndex: 0, setIndex: 0 }, asOffered(100, 7, 9));
    expect(b.exercises[0].sets[0].t).toBe('8');
    expect(b.exercises[0].sets[0].rpe).toBe('8');
  });

  it('does not mutate the block it was given', () => {
    const before = one([{ t: '8', rpe: '8' }]);
    const snapshot = JSON.stringify(before);
    applyDraft(before, { exerciseIndex: 0, setIndex: 0 }, asOffered(100, 8, 8));
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  describe('Stage 6 — the override note', () => {
    it('records nothing extra when the athlete takes the number exactly as offered', () => {
      const b = applyDraft(one([{ t: '8', rpe: '8' }]), { exerciseIndex: 0, setIndex: 0 }, asOffered(100, 8, 8));
      expect(b.exercises[0].sets[0]).not.toHaveProperty('offeredKg');
      expect(b.exercises[0].sets[0]).not.toHaveProperty('overrideNote');
    });

    it('records what was offered when the athlete changes the number, with no note required', () => {
      const draft = { kg: 95, reps: 8, felt: 8, offered: 102.5, note: '', pain: false };
      const b = applyDraft(one([{ t: '8', rpe: '8' }]), { exerciseIndex: 0, setIndex: 0 }, draft);
      expect(b.exercises[0].sets[0]).toMatchObject({ aVal: '95', offeredKg: 102.5 });
      expect(b.exercises[0].sets[0]).not.toHaveProperty('overrideNote');
    });

    it('carries the note alongside the override, trimmed', () => {
      const draft = { kg: 95, reps: 8, felt: 8, offered: 102.5, note: '  shoulder felt off  ', pain: false };
      const b = applyDraft(one([{ t: '8', rpe: '8' }]), { exerciseIndex: 0, setIndex: 0 }, draft);
      expect(b.exercises[0].sets[0]).toMatchObject({ offeredKg: 102.5, overrideNote: 'shoulder felt off' });
    });

    it('never stores a note left over from a set that was NOT overridden', () => {
      // If the app ever fails to clear `note` between sets, a stray line must
      // not attach itself to an unrelated, un-overridden set.
      const draft = { kg: 100, reps: 8, felt: 8, offered: 100, note: 'felt great', pain: false };
      const b = applyDraft(one([{ t: '8', rpe: '8' }]), { exerciseIndex: 0, setIndex: 0 }, draft);
      expect(b.exercises[0].sets[0]).not.toHaveProperty('overrideNote');
      expect(b.exercises[0].sets[0]).not.toHaveProperty('offeredKg');
    });

    it('drops a note that is empty after trimming — whitespace is not a reason', () => {
      const draft = { kg: 95, reps: 8, felt: 8, offered: 102.5, note: '   ', pain: false };
      const b = applyDraft(one([{ t: '8', rpe: '8' }]), { exerciseIndex: 0, setIndex: 0 }, draft);
      expect(b.exercises[0].sets[0]).toMatchObject({ offeredKg: 102.5 });
      expect(b.exercises[0].sets[0]).not.toHaveProperty('overrideNote');
    });
  });
});

describe('openDraft — Stage 6, the offer is captured at the moment the field opens', () => {
  it('opens with offered equal to kg — the ordinary, un-overridden shape', () => {
    const b = one([{ t: '8', rpe: '8' }]);
    const d = openDraft(b, { exerciseIndex: 0, setIndex: 0 });
    expect(d.offered).toBe(d.kg);
    expect(d.note).toBe('');
  });
});
