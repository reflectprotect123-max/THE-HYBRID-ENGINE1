import { describe, it, expect } from 'vitest';
import type { Session, LoggedSet, StrengthBlock } from '@hybrid/engine';
import { initialRun, reduce } from './machine';
import type { RunState } from './machine';
import { orderFor } from './queue';

const s = (done = false): LoggedSet =>
  done ? { t: '8', rpe: '8', aVal: '100', aVal2: '8', felt: '8', done: true } : { t: '8', rpe: '8' };

const session = (blocks: StrengthBlock<LoggedSet>[]): Session => ({
  id: 's1', date: '2026-08-13', status: 'active', blocks,
});

const solo = (sets: LoggedSet[], rest = 120): StrengthBlock<LoggedSet> => ({
  id: 'b1', exercises: [{ id: 'e0', name: 'Squat', mode: 'reps_kg', sets, rest }],
});

const pair = (): StrengthBlock<LoggedSet> => ({
  id: 'b2', superset: true,
  exercises: [
    { id: 'e0', name: 'Press', mode: 'reps_kg', sets: [s(), s()], rest: 60 },
    { id: 'e1', name: 'Raise', mode: 'reps_kg', sets: [s(), s()], rest: 60 },
  ],
});

describe('initialRun', () => {
  it('starts on the first block with a draft open and no rest', () => {
    const run = initialRun(session([solo([s()])]));
    expect(run.blockIndex).toBe(0);
    expect(run.rest).toBeNull();
    expect(run.draft).not.toBeNull();
  });
});

describe('logSet', () => {
  it('writes the set, opens the next draft, and starts the rest', () => {
    const sess = session([solo([s(), s()])]);
    let st = { session: sess, run: initialRun(sess) };
    st = reduce(st.session, { ...st.run, draft: { kg: 100, reps: 8, felt: 8 } }, { type: 'logSet' });
    expect((st.session.blocks[0] as StrengthBlock<LoggedSet>).exercises[0].sets[0].done).toBe(true);
    expect(st.run.rest).toEqual({ left: 120, total: 120, kind: 'set' });
    expect(st.run.draft).not.toBeNull();
  });

  it('refuses an incomplete draft rather than logging a guess', () => {
    const sess = session([solo([s()])]);
    const run = { ...initialRun(sess), draft: { kg: 100, reps: 8, felt: null } };
    const st = reduce(sess, run, { type: 'logSet' });
    expect((st.session.blocks[0] as StrengthBlock<LoggedSet>).exercises[0].sets[0].done).toBeFalsy();
  });

  it('does not mutate the session it was given', () => {
    const sess = session([solo([s()])]);
    const snapshot = JSON.stringify(sess);
    reduce(sess, { ...initialRun(sess), draft: { kg: 100, reps: 8, felt: 8 } }, { type: 'logSet' });
    expect(JSON.stringify(sess)).toBe(snapshot);
  });
});

describe('rotate', () => {
  it('rotates the named block and reopens the draft on the new leader', () => {
    const sess = session([pair()]);
    const st = reduce(sess, initialRun(sess), { type: 'rotate', blockId: 'b2' });
    expect(orderFor(st.session.blocks[0] as StrengthBlock<LoggedSet>, 0)).toEqual([1, 0]);
    expect(st.run.draft).not.toBeNull();
  });

  it('ignores a block id that is not in the session', () => {
    const sess = session([pair()]);
    const st = reduce(sess, initialRun(sess), { type: 'rotate', blockId: 'nope' });
    expect(st.session).toBe(sess);
  });
});

describe('skipSet', () => {
  it('moves past the set without marking it done, so it is still owed', () => {
    const sess = session([solo([s(), s()])]);
    const st = reduce(sess, initialRun(sess), { type: 'skipSet' });
    expect((st.session.blocks[0] as StrengthBlock<LoggedSet>).exercises[0].sets[0].done).toBeFalsy();
    expect(st.run.draft).not.toBeNull();
  });
});

describe('completePiece', () => {
  const warm = (mode: 'seconds' | 'reps', t: string): StrengthBlock<LoggedSet> => ({
    id: 'w1',
    warmup: true,
    exercises: [{ id: 'e0', name: 'Arm circles', mode, sets: [{ t, rpe: '' }] }],
  });

  it('marks a timed piece done, records its seconds, and writes no felt', () => {
    const sess = session([warm('seconds', '30')]);
    const st = reduce(sess, initialRun(sess), { type: 'completePiece' });
    const piece = (st.session.blocks[0] as StrengthBlock<LoggedSet>).exercises[0].sets[0];
    expect(piece.done).toBe(true);
    expect(piece.aVal).toBe('30');
    expect(piece.felt).toBeUndefined();
  });

  it('marks a rep piece done, records its rep target, and writes no felt', () => {
    const sess = session([warm('reps', '12')]);
    const st = reduce(sess, initialRun(sess), { type: 'completePiece' });
    const piece = (st.session.blocks[0] as StrengthBlock<LoggedSet>).exercises[0].sets[0];
    expect(piece.done).toBe(true);
    expect(piece.aVal).toBe('12');
    expect(piece.felt).toBeUndefined();
  });

  it('does nothing to an ordinary working block', () => {
    const sess = session([solo([s()])]);
    const st = reduce(sess, initialRun(sess), { type: 'completePiece' });
    expect(st.session).toBe(sess);
  });

  it('does not mutate the session it was given', () => {
    const sess = session([warm('seconds', '30')]);
    const snapshot = JSON.stringify(sess);
    reduce(sess, initialRun(sess), { type: 'completePiece' });
    expect(JSON.stringify(sess)).toBe(snapshot);
  });

  /*
   * A prep block ends with a page turn, and a piece never opens a timed rest.
   * Missing, the athlete finished a warm-up and was left on a block with
   * nothing owed, nothing on screen saying it had ended, and no way forward —
   * found by driving the real screens through the parity harness.
   */
  const twoPieces = (): StrengthBlock<LoggedSet> => ({
    id: 'w2',
    warmup: true,
    exercises: [
      { id: 'e0', name: 'Row', mode: 'seconds', sets: [{ t: '60', rpe: '' }] },
      { id: 'e1', name: 'Air Squats', mode: 'reps', sets: [{ t: '12', rpe: '' }] },
    ],
  });

  it('opens no rest while a piece is still owed', () => {
    const sess = session([twoPieces()]);
    const st = reduce(sess, initialRun(sess), { type: 'completePiece' });
    expect(st.run.rest).toBeNull();
  });

  it('turns the page once the last piece is done', () => {
    const sess = session([twoPieces()]);
    const first = reduce(sess, initialRun(sess), { type: 'completePiece' });
    const second = reduce(first.session, first.run, { type: 'completePiece' });
    expect(second.run.rest).toEqual({ left: 0, total: 0, kind: 'block' });
  });

  it('never opens a timed rest for a piece, whatever the block carries', () => {
    const withRest = twoPieces();
    withRest.exercises[0].rest = 90;
    const sess = session([withRest]);
    const first = reduce(sess, initialRun(sess), { type: 'completePiece' });
    expect(first.run.rest).toBeNull();
  });
});

describe('addSet', () => {
  it('appends a set shaped like the last one', () => {
    const sess = session([solo([s()])]);
    const st = reduce(sess, initialRun(sess), { type: 'addSet' });
    const ex = (st.session.blocks[0] as StrengthBlock<LoggedSet>).exercises[0];
    expect(ex.sets).toHaveLength(2);
    expect(ex.sets[1]).toEqual({ t: '8', rpe: '8' });
  });
});

describe('rest', () => {
  it('ticks down and clears itself when spent', () => {
    const sess = session([solo([s(), s()])]);
    let run: RunState = { ...initialRun(sess), rest: { left: 1, total: 120, kind: 'set' as const } };
    run = reduce(sess, run, { type: 'tick' }).run;
    expect(run.rest).toEqual({ left: 0, total: 120, kind: 'set' });
  });

  it('can be extended and dismissed', () => {
    const sess = session([solo([s(), s()])]);
    const rest = { left: 30, total: 120, kind: 'set' as const };
    expect(reduce(sess, { ...initialRun(sess), rest }, { type: 'extendRest', seconds: 15 }).run.rest)
      .toEqual({ left: 45, total: 135, kind: 'set' });
    expect(reduce(sess, { ...initialRun(sess), rest }, { type: 'dismissRest' }).run.rest).toBeNull();
  });
});

describe('goToBlock', () => {
  it('moves and reopens the draft there', () => {
    const sess = session([solo([s()]), pair()]);
    const st = reduce(sess, initialRun(sess), { type: 'goToBlock', index: 1 });
    expect(st.run.blockIndex).toBe(1);
  });

  it('refuses an index outside the session', () => {
    const sess = session([solo([s()])]);
    expect(reduce(sess, initialRun(sess), { type: 'goToBlock', index: 9 }).run.blockIndex).toBe(0);
  });
});

describe('finish', () => {
  it('marks the session completed and stamps when', () => {
    const sess = session([solo([s(true)])]);
    const st = reduce(sess, initialRun(sess), { type: 'finish' });
    expect(st.session.status).toBe('completed');
    expect(typeof st.session.completedAt).toBe('number');
  });
});

describe('the set’s own clock, for EMOM pacing', () => {
  /*
   * `setOpenedAt` is how the reducer knows how much of an `every` window the
   * set itself used. It is a STAMP and not a counter, and it was a counter for
   * about an hour on 16 August 2026 — counting needs an interval running, and
   * a JS interval is throttled or stopped while an Android app is
   * backgrounded, so an athlete who took a call mid-set came back to a rest
   * that was too long. Same argument as `Session.blockLog`, one layer down.
   */
  const pacedSession = (): Session =>
    ({
      id: 's',
      status: 'active',
      blocks: [
        {
          id: 'b',
          exercises: [
            {
              id: 'e0',
              name: 'Squat',
              mode: 'reps_kg',
              every: 150,
              sets: [{ t: '5', rpe: '8' }, { t: '5', rpe: '8' }],
            },
          ],
        },
      ],
    }) as unknown as Session;

  it('spends the time the set actually ran on the window, however that time passed', () => {
    /* Forty seconds of wall clock, whether the app was in the foreground for
       all of it or none of it. A counter could only have seen the foreground
       part. */
    const sess = pacedSession();
    const run = { ...initialRun(sess), setOpenedAt: Date.now() - 40_000 };
    const st = reduce(sess, { ...run, draft: { kg: 100, reps: 5, felt: 8 } }, { type: 'logSet' });
    expect(st.run.rest).toMatchObject({ total: 150, paced: true });
    expect(st.run.rest?.left).toBeGreaterThanOrEqual(109);
    expect(st.run.rest?.left).toBeLessThanOrEqual(111);
  });

  it('gives no rest at all when the set outlasted its window', () => {
    const sess = pacedSession();
    const run = { ...initialRun(sess), setOpenedAt: Date.now() - 300_000 };
    const st = reduce(sess, { ...run, draft: { kg: 100, reps: 5, felt: 8 } }, { type: 'logSet' });
    expect(st.run.rest).toBeNull();
  });

  it('restarts the window for the set that follows', () => {
    const sess = pacedSession();
    const run = { ...initialRun(sess), setOpenedAt: Date.now() - 40_000 };
    const st = reduce(sess, { ...run, draft: { kg: 100, reps: 5, felt: 8 } }, { type: 'logSet' });
    expect(Date.now() - st.run.setOpenedAt).toBeLessThan(1000);
  });

  it('does not advance anything on a tick with no rest running', () => {
    /* There is nothing left to count. The set's elapsed time is read off the
       stamp when it is needed, so a tick outside a rest is a no-op — and the
       app arms no interval for it at all. */
    const sess = pacedSession();
    const run = initialRun(sess);
    const st = reduce(sess, run, { type: 'tick' });
    expect(st.run).toBe(run);
  });
});

describe('stamping which block the athlete is in', () => {
  /*
   * `Session.blockLog` — wall-clock stamps rather than a stopwatch, so nothing
   * has to survive the phone locking or Android reclaiming the app. The recap
   * turns them into "how long each part took" via `blockDurations`.
   */
  const twoBlocks = (): Session =>
    ({
      id: 's',
      status: 'active',
      blockLog: [{ id: 'b0', at: 1000 }],
      blocks: [
        { id: 'b0', exercises: [{ id: 'e0', name: 'Squat', mode: 'reps_kg', sets: [{ t: '5', rpe: '8' }] }] },
        { id: 'b1', exercises: [{ id: 'e1', name: 'Row', mode: 'reps_kg', sets: [{ t: '5', rpe: '8' }] }] },
      ],
    }) as unknown as Session;

  it('appends an entry when the athlete moves to another block', () => {
    const sess = twoBlocks();
    const st = reduce(sess, initialRun(sess), { type: 'goToBlock', index: 1 });
    expect(st.session.blockLog).toHaveLength(2);
    expect(st.session.blockLog?.[1].id).toBe('b1');
    expect(st.session.blockLog?.[1].at).toBeGreaterThan(0);
  });

  it('stamps NOTHING for re-selecting the block already open', () => {
    /* The athlete has not gone anywhere. A stamp would close one segment and
       open an identical one — harmless arithmetic, but a log full of moves
       nobody made. */
    const sess = twoBlocks();
    const st = reduce(sess, initialRun(sess), { type: 'goToBlock', index: 0 });
    expect(st.session.blockLog).toHaveLength(1);
  });

  it('records a RETURN as its own entry rather than overwriting the first', () => {
    const sess = twoBlocks();
    let st = reduce(sess, initialRun(sess), { type: 'goToBlock', index: 1 });
    st = reduce(st.session, st.run, { type: 'goToBlock', index: 0 });
    expect(st.session.blockLog?.map((e) => e.id)).toEqual(['b0', 'b1', 'b0']);
  });

  it('leaves the log alone for an index that is not a block', () => {
    const sess = twoBlocks();
    const st = reduce(sess, initialRun(sess), { type: 'goToBlock', index: 9 });
    expect(st.session.blockLog).toHaveLength(1);
  });
});
