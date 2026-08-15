import { describe, it, expect } from 'vitest';
import { repsToFailure, e1rmOf, kFor, clampPct } from './fold';

describe('repsToFailure', () => {
  it('is reps plus the RPE shortfall', () => {
    expect(repsToFailure(8, 8)).toBe(10);
    expect(repsToFailure(5, 10)).toBe(5);
  });

  it('caps at 12, so a very easy high-rep set cannot claim an absurd e1RM', () => {
    expect(repsToFailure(20, 6)).toBe(12);
    expect(repsToFailure(12, 10)).toBe(12);
  });
});

describe('e1rmOf', () => {
  it('is Epley over reps-to-failure', () => {
    expect(e1rmOf(100, 10, 10)).toBeCloseTo(133.333, 3);
    expect(e1rmOf(100, 1, 10)).toBeCloseTo(103.333, 3);
  });

  it('returns 0 for a bodyweight set', () => {
    expect(e1rmOf(0, 10, 8)).toBe(0);
  });
});

describe('kFor', () => {
  it('moves low-rep work further per RPE point than high-rep work', () => {
    expect(kFor(1)).toBe(3);
    expect(kFor(3)).toBe(3);
    expect(kFor(4)).toBe(2.5);
    expect(kFor(7)).toBe(2.5);
    expect(kFor(8)).toBe(2);
    expect(kFor(20)).toBe(2);
  });
});

describe('clampPct', () => {
  it('holds a single adjustment inside 7.5% either way', () => {
    expect(clampPct(3)).toBe(3);
    expect(clampPct(20)).toBe(7.5);
    expect(clampPct(-20)).toBe(-7.5);
  });
});

import { anchorFor, plannedKg, type PlanTarget } from './fold';

describe('anchorFor', () => {
  it('is the e1RM implied by set 1 at the opener', () => {
    const first: PlanTarget = { reps: 10, rpe: 7 };
    // rtf = 10 + 3 = 13, capped to 12 → 60 * (1 + 12/30) = 84
    expect(anchorFor(60, first)).toBeCloseTo(84, 6);
  });

  it('is 0 for a bodyweight exercise, so nothing downstream invents a load', () => {
    expect(anchorFor(0, { reps: 10, rpe: 8 })).toBe(0);
  });
});

describe('plannedKg', () => {
  it('prices a later set off the anchor, not off the last set', () => {
    const anchor = anchorFor(60, { reps: 10, rpe: 7 });
    // set 2 asks 8 @ 8 → rtf 10 → 84 / (1 + 10/30) = 63
    expect(plannedKg(anchor, { reps: 8, rpe: 8 })).toBeCloseTo(63, 6);
  });

  it('treats a max set as the anchor set would be, since it has no rep target', () => {
    const anchor = anchorFor(60, { reps: 10, rpe: 7 });
    expect(plannedKg(anchor, { reps: 'max', rpe: 10 })).toBeCloseTo(84, 6);
  });
});

import { walkLogs, type FoldLog } from './fold';

const log = (reps: number, felt: number, target: PlanTarget, kg = 60): FoldLog =>
  ({ reps, kg, felt, target });

describe('walkLogs', () => {
  it('holds at 1 when every set landed on target', () => {
    const s = walkLogs([log(8, 8, { reps: 8, rpe: 8 })]);
    expect(s.adj).toBe(1);
    expect(s.locked).toBe(false);
    expect(s.easyRun).toBe(0);
  });

  it('locks and drops on a set harder than asked', () => {
    const s = walkLogs([log(8, 9, { reps: 8, rpe: 8 })]);
    // dev = 8 - 9 = -1, k = 2 → -2%
    expect(s.adj).toBeCloseTo(0.98, 6);
    expect(s.locked).toBe(true);
  });

  it('treats a missed rep floor as harder than a 10, however it was rated', () => {
    const s = walkLogs([log(5, 7, { reps: 8, rpe: 8 })]);
    // missed → eff 10.5, dev = 8 - 10.5 = -2.5, k = 2 → -5%
    expect(s.adj).toBeCloseTo(0.95, 6);
    expect(s.locked).toBe(true);
  });

  it('gives one easy set only half its correction', () => {
    const s = walkLogs([log(8, 7, { reps: 8, rpe: 8 })]);
    // dev = +1, k = 2 → (2 * 1) / 2 = +1%
    expect(s.adj).toBeCloseTo(1.01, 6);
    expect(s.easyRun).toBe(1);
  });

  it('gives a second consecutive easy set the rest of it', () => {
    const s = walkLogs([
      log(8, 7, { reps: 8, rpe: 8 }),
      log(8, 7, { reps: 8, rpe: 8 }),
    ]);
    expect(s.adj).toBeCloseTo(1.0201, 6);
    expect(s.easyRun).toBe(2);
  });

  it('refuses to climb again once locked', () => {
    const s = walkLogs([
      log(8, 9, { reps: 8, rpe: 8 }),   // hard: locks at 0.98
      log(8, 7, { reps: 8, rpe: 8 }),   // easy: ignored
    ]);
    expect(s.adj).toBeCloseTo(0.98, 6);
    expect(s.locked).toBe(true);
  });

  it('resets the easy run when a set lands on target', () => {
    const s = walkLogs([
      log(8, 7, { reps: 8, rpe: 8 }),
      log(8, 8, { reps: 8, rpe: 8 }),
    ]);
    expect(s.easyRun).toBe(0);
  });

  it('skips a max set entirely — no floor to miss, no target to deviate from', () => {
    const s = walkLogs([log(3, 10, { reps: 'max', rpe: 10 })]);
    expect(s.adj).toBe(1);
    expect(s.locked).toBe(false);
    expect(s.last?.target.reps).toBe('max');
  });

  it('clamps a wild rating to the step ceiling', () => {
    const s = walkLogs([log(3, 1, { reps: 3, rpe: 9 })]);
    // dev = +8, k = 3 → (3 * 8) / 2 = 12% → clamped to 7.5%
    expect(s.adj).toBeCloseTo(1.075, 6);
  });
});

import { foldExercise } from './fold';

const LADDER: PlanTarget[] = [
  { reps: 10, rpe: 7 },
  { reps: 8, rpe: 8 },
  { reps: 6, rpe: 9 },
  { reps: 'max', rpe: 10 },
];

const input = (logs: FoldLog[]) => ({ targets: LADDER, logs, opener: 60, increment: 2.5 });

describe('foldExercise', () => {
  it('opens at the weight the athlete chose, and says so', () => {
    const r = foldExercise(input([]))!;
    expect(r.setIndex).toBe(0);
    expect(r.kg).toBe(60);
    expect(r.message).toBe('opener — everything works from here');
  });

  it('returns null once every planned set is logged', () => {
    const logs = LADDER.map((t) => log(8, 8, t));
    expect(foldExercise(input(logs))).toBeNull();
  });

  it('is on plan when the opener landed on target', () => {
    const r = foldExercise(input([log(10, 7, LADDER[0])]))!;
    expect(r.setIndex).toBe(1);
    expect(r.kg).toBe(62.5);
    expect(r.message).toBe('on plan');
  });

  it('holds after one easy set rather than jumping on thin evidence', () => {
    const r = foldExercise(input([log(10, 6, LADDER[0])]))!;
    // planned 63 → want 63.63 → rounds back to 62.5, which IS the plan. The
    // wanted rise is smaller than one plate, so the message names the plate.
    expect(r.kg).toBe(62.5);
    expect(r.message).toBe('holding — the next jump is 2.5 kg, chase clean reps instead');
  });

  it('says plainly that one easy set is not evidence when the step is small', () => {
    // The "next jump is N kg" wording is reserved for inc >= 2, where naming
    // the plate is useful. Below that it just says why it held.
    // planned 63, want 63.63, both round to 63 on a 1.5 kg step.
    const r = foldExercise({ ...input([log(10, 6, LADDER[0])]), increment: 1.5 })!;
    expect(r.kg).toBe(63);
    expect(r.message).toBe('holding — one easy set is not evidence yet');
  });

  it('backs off after a set harder than asked, and names the set', () => {
    const r = foldExercise(input([log(10, 9, LADDER[0])]))!;
    expect(r.kg).toBeLessThan(62.5);
    expect(r.message).toBe('backed off — your 10 @ 9 was harder than asked');
  });

  it('gives a bodyweight exercise no load and no advice about load', () => {
    const r = foldExercise({ targets: LADDER, logs: [], opener: 0, increment: 2.5 })!;
    expect(r.kg).toBe(0);
    expect(r.message).toBe('bodyweight');
  });

  it('sends a max set back to set 1 weight when the run has gone well', () => {
    const logs = [log(10, 7, LADDER[0]), log(8, 8, LADDER[1]), log(6, 9, LADDER[2])];
    const r = foldExercise(input(logs))!;
    expect(r.setIndex).toBe(3);
    expect(r.kg).toBe(60);
    expect(r.message).toBe('back to set 1’s weight — count the reps');
  });

  it('backs a max set off when the set before it was a grind', () => {
    const logs = [log(10, 7, LADDER[0]), log(8, 8, LADDER[1]), log(6, 10, LADDER[2])];
    const r = foldExercise(input(logs))!;
    expect(r.kg).toBeLessThan(60);
    expect(r.message).toBe('set 1 minus the back-off — arrive fresh');
  });

  it('rounds to the exercise’s own increment', () => {
    const r = foldExercise({ ...input([log(10, 6, LADDER[0])]), increment: 5 })!;
    expect(r.kg % 5).toBe(0);
  });
});

import { foldFromExercise } from './fold';
import type { Exercise, LoggedSet } from './types';

const ex = (sets: LoggedSet[]): Exercise<LoggedSet> => ({
  id: 'e1', name: 'Back Squat', mode: 'reps_kg', sets,
});

describe('foldFromExercise', () => {
  it('reads the opener from set 1’s recorded weight once it is done', () => {
    const r = foldFromExercise(ex([
      { t: '10', rpe: '7', aVal: '60', aVal2: '10', felt: '7', done: true },
      { t: '8', rpe: '8' },
    ]), 2.5)!;
    expect(r.setIndex).toBe(1);
    expect(r.kg).toBe(62.5);
  });

  it('ignores warm-up sets, so an empty bar never teaches the working weight', () => {
    const r = foldFromExercise(ex([
      { t: 'W10', rpe: '5', aVal: '20', aVal2: '10', felt: '3', done: true },
      { t: '10', rpe: '7', aVal: '60', aVal2: '10', felt: '7', done: true },
      { t: '8', rpe: '8' },
    ]), 2.5)!;
    expect(r.kg).toBe(62.5);
  });

  it('stops at the first unfinished set', () => {
    const r = foldFromExercise(ex([
      { t: '10', rpe: '7', aVal: '60', aVal2: '10', felt: '7', done: true },
      { t: '8', rpe: '8' },
      { t: '6', rpe: '9' },
    ]), 2.5)!;
    expect(r.setIndex).toBe(1);
  });

  it('reads a max target out of the set text', () => {
    const r = foldFromExercise(ex([
      { t: '10', rpe: '7', aVal: '60', aVal2: '10', felt: '7', done: true },
      { t: 'max', rpe: '10' },
    ]), 2.5)!;
    expect(r.target.reps).toBe('max');
  });

  it('returns null for an exercise with no working sets at all', () => {
    expect(foldFromExercise(ex([{ t: 'W10', rpe: '5' }]), 2.5)).toBeNull();
  });

  it('prices an UNRATED deviation off the plan, not off the last bar weight', () => {
    /*
     * Moved here from `logger.test.ts` when `prefillPrimary` was deleted with
     * the web logger (15 August 2026). It was always a claim about the fold
     * rather than about the prefill, and it is the one place the fold
     * deliberately DIVERGES from what the old screen used to do.
     *
     * Set 1: 100 kg for 5 @8, rated 8 — exactly on plan. Set 2: the athlete
     * jumped to 110 kg and never rated it. Pricing set 3:
     *
     * THE OLD RULE was "repeat the nearest earlier weight" — `felt` is
     * unparseable, so no adjustment ran and set 2's own 110 came straight
     * back.
     *
     * THE FOLD stops at the unrated set, because an unrated set carries no
     * evidence. Logs hold only set 1: dev = 8 − 8 = 0, so adj is 1, and the
     * plan's price at the anchor the athlete chose and confirmed is 100.
     *
     * 110 was a weight nobody vouched for. The divergence is chosen.
     */
    const r = foldFromExercise(ex([
      { t: '5', rpe: '8', aVal: '100', aVal2: '5', felt: '8', done: true },
      { t: '5', rpe: '8', aVal: '110', aVal2: '5', done: true },
      { t: '5', rpe: '8' },
    ]), 2.5)!;
    expect(r.kg).toBe(100);
  });
});

import { foldNextOpener } from './fold';

const doneSet = (felt: number, over: Partial<LoggedSet> = {}): LoggedSet =>
  ({ t: '8', rpe: '8', aVal: '100', aVal2: '8', felt: String(felt), done: true, ...over });

describe('foldNextOpener', () => {
  it('gives two easy sets the full correction', () => {
    // adj = 1.01 * 1.01 = 1.0201 → want 102.01 → rounds to 102.5
    const r = foldNextOpener(ex([doneSet(7), doneSet(7)]), 2.5)!;
    expect(r.kg).toBe(102.5);
    expect(r.message).toBe('two easy sets — full correction');
  });

  it('stays down after a hard set, whatever came later', () => {
    // set 1 locks at 0.98; set 2 easy but ignored → want 98 → rounds to 97.5
    const r = foldNextOpener(ex([doneSet(9), doneSet(7)]), 2.5)!;
    expect(r.kg).toBe(97.5);
    expect(r.message).toBe('backed off — harder than asked');
  });

  it('caps one easy set below a full plate, which rounds to a hold', () => {
    // adj 1.01 → want 101, capped at min(101, 102.5) = 101 → rounds to 100
    const r = foldNextOpener(ex([doneSet(7)]), 2.5)!;
    expect(r.kg).toBe(100);
    expect(r.message).toBe('hold — open here again');
  });

  it('holds an on-target session exactly', () => {
    const r = foldNextOpener(ex([doneSet(8)]), 2.5)!;
    expect(r.kg).toBe(100);
    expect(r.message).toBe('hold — open here again');
  });

  it('treats a missed floor as harder than a 10', () => {
    // reps 5 < 8 → effective 10.5, dev -2.5, k=2 → adj 0.95 → 95
    const r = foldNextOpener(ex([doneSet(7, { aVal2: '5' })]), 2.5)!;
    expect(r.kg).toBe(95);
    expect(r.message).toBe('backed off — harder than asked');
  });

  it('returns null for bodyweight — there is no load to bank', () => {
    expect(foldNextOpener(ex([doneSet(8, { aVal: '' })]), 2.5)).toBeNull();
  });

  it('returns null when nothing was logged', () => {
    expect(foldNextOpener(ex([{ t: '8', rpe: '8' }]), 2.5)).toBeNull();
  });
});

