import { describe, it, expect } from 'vitest';
import type { Session, LoggedSet, StrengthBlock } from '@hybrid/engine';
import { sessionView } from './view';
import { initialRun, reduce } from './machine';
import { rotateBlock } from './rotate';
import { orderFor } from './queue';

const session = (blocks: StrengthBlock<LoggedSet>[], status: Session['status'] = 'active'): Session => ({
  id: 's1',
  date: '2026-08-13',
  status,
  blocks,
});

describe('sessionView', () => {
  it('reports the coaching message from the engine, not one of its own', () => {
    // Same fixture as @hybrid/engine's fold.test.ts "reads the opener from set
    // 1's recorded weight once it is done": set 1 was logged at 60kg/10@7,
    // which lands exactly on its 10 @ 7 target, so `walkLogs` holds at 1x and
    // `foldExercise` calls it 'on plan'. Hand-computed there, reused here so
    // this test is asserting the view carries the string, not deriving it.
    const block: StrengthBlock<LoggedSet> = {
      id: 'b1',
      exercises: [
        {
          id: 'e0',
          name: 'Back Squat',
          mode: 'reps_kg',
          sets: [
            { t: '10', rpe: '7', aVal: '60', aVal2: '10', felt: '7', done: true },
            { t: '8', rpe: '8' },
          ],
        },
      ],
    };
    const sess = session([block]);
    const view = sessionView(sess, initialRun(sess));

    expect(view.hot).not.toBeNull();
    expect(view.hot).toEqual({
      exerciseIndex: 0,
      setIndex: 1,
      exerciseName: 'Back Squat',
      message: 'on plan',
      planned: { reps: '8', rpe: '8' },
    });
  });

  it('renders a rotated round in the order it will run', () => {
    const pair: StrengthBlock<LoggedSet> = {
      id: 'b2',
      superset: true,
      exercises: [
        { id: 'e0', name: 'Press', mode: 'reps_kg', sets: [{ t: '8', rpe: '8' }, { t: '8', rpe: '8' }], rest: 60 },
        { id: 'e1', name: 'Raise', mode: 'reps_kg', sets: [{ t: '8', rpe: '8' }, { t: '8', rpe: '8' }], rest: 60 },
      ],
    };
    const rotated = rotateBlock(pair);
    // Sanity check against the same rotation `machine.test.ts` exercises: no
    // round has started, so round 0 now leads with Raise (index 1) then Press
    // (index 0) — the pair cycled rather than staying put.
    expect(orderFor(rotated, 0)).toEqual([1, 0]);

    const sess = session([rotated]);
    const view = sessionView(sess, initialRun(sess));

    expect(view.rounds[0].sets.map((s) => s.exerciseIndex)).toEqual([1, 0]);
    expect(view.rounds[0].sets.map((s) => s.exerciseName)).toEqual(['Raise', 'Press']);
  });

  it('has no live set once every block is done', () => {
    const block: StrengthBlock<LoggedSet> = {
      id: 'b1',
      exercises: [
        {
          id: 'e0',
          name: 'Back Squat',
          mode: 'reps_kg',
          sets: [{ t: '8', rpe: '8', aVal: '100', aVal2: '8', felt: '8', done: true }],
        },
      ],
    };
    const sess = session([block], 'completed');
    const view = sessionView(sess, initialRun(sess));

    expect(view.finished).toBe(true);
    expect(view.hot).toBeNull();
    expect(view.rest).toBeNull();
    expect(view.draft).toBeNull();
  });

  it('counts progress in working sets, so a warm-up cannot inflate it', () => {
    const block: StrengthBlock<LoggedSet> = {
      id: 'b1',
      exercises: [
        {
          id: 'e0',
          name: 'Back Squat',
          mode: 'reps_kg',
          sets: [
            { t: 'W10', rpe: '5', aVal: '20', aVal2: '10', felt: '3', done: true },
            { t: '8', rpe: '8', aVal: '100', aVal2: '8', felt: '8', done: true },
            { t: '8', rpe: '8' },
          ],
        },
      ],
    };
    const sess = session([block]);
    const view = sessionView(sess, initialRun(sess));

    // Three sets on the exercise, one of them a warm-up: progress must read
    // 1 of 2, not 2 of 3.
    expect(view.blocks[0].progress).toEqual({ done: 1, total: 2 });
  });

  it('reports blockIndex, and it follows goToBlock', () => {
    const block = (id: string): StrengthBlock<LoggedSet> => ({
      id,
      exercises: [{ id: `${id}-e0`, name: 'Bench', mode: 'reps_kg', sets: [{ t: '8', rpe: '8' }] }],
    });
    const sess = session([block('b1'), block('b2')]);
    const run0 = initialRun(sess);
    expect(sessionView(sess, run0).blockIndex).toBe(0);

    const { run: run1 } = reduce(sess, run0, { type: 'goToBlock', index: 1 });
    expect(sessionView(sess, run1).blockIndex).toBe(1);
  });

  it('carries the recorded values on a done set, and null on one not yet logged', () => {
    const block: StrengthBlock<LoggedSet> = {
      id: 'b1',
      exercises: [
        {
          id: 'e0',
          name: 'Back Squat',
          mode: 'reps_kg',
          sets: [
            { t: '8-10', rpe: '7-9', aVal: '100', aVal2: '8', felt: '7.5', done: true },
            { t: '5', rpe: '8' },
          ],
        },
      ],
    };
    const sess = session([block]);
    const view = sessionView(sess, initialRun(sess));
    const allSets = view.rounds.flatMap((r) => r.sets);

    const done = allSets.find((s) => s.setIndex === 0)!;
    expect(done.status).toBe('done');
    expect(done.logged).toEqual({ kg: 100, reps: 8, felt: 7.5 });
    expect(done.planned).toEqual({ reps: '8-10', rpe: '7-9' });

    const upcoming = allSets.find((s) => s.setIndex === 1)!;
    expect(upcoming.status).not.toBe('done');
    expect(upcoming.logged).toBeNull();
    expect(upcoming.planned).toEqual({ reps: '5', rpe: '8' });
  });
});
