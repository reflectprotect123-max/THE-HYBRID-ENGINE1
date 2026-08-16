import { describe, it, expect } from 'vitest';
import type { Session, LoggedSet, StrengthBlock } from '@hybrid/engine';
import { initialRun, reduce } from './machine';

/*
 * `useSession` itself cannot be rendered here — this package deliberately
 * carries no `react-dom` or `react-native` dependency (see `index.test.ts`),
 * and a hook can only be driven through a renderer. What CAN be tested at
 * this level is the contract `useSession` is built on: its `dispatch` does
 * nothing but call `reduce(state.session, state.run, action)` and store the
 * `session` it returns back into state, and the hook now returns that same
 * `session` verbatim (`{ ...view, session: state.session, dispatch }`). So
 * the property worth proving here is `reduce`'s half of that contract —
 * that dispatching an action changes the returned `session`, not just the
 * derived `run`/view state — since that is exactly what the hook exposes
 * unmodified.
 */

const workingSet = (): LoggedSet => ({ t: '8', rpe: '8' });

const solo = (sets: LoggedSet[], rest = 120): StrengthBlock<LoggedSet> => ({
  id: 'b1',
  exercises: [{ id: 'e0', name: 'Squat', mode: 'reps_kg', sets, rest }],
});

const session = (blocks: StrengthBlock<LoggedSet>[]): Session => ({
  id: 's1',
  date: '2026-08-13',
  status: 'active',
  blocks,
});

describe('the session useSession relies on `reduce` for', () => {
  it('reflects a dispatched action in the returned session, not just the run state', () => {
    const sess = session([solo([workingSet(), workingSet()])]);
    const run = initialRun(sess);

    // Mirrors exactly what `useSession`'s `dispatch` callback does: feed the
    // current `{ session, run }` pair and one action to `reduce`.
    const draftedRun = { ...run, draft: { kg: 100, reps: 8, felt: 8, offered: 100, note: '', pain: false } };
    const next = reduce(sess, draftedRun, { type: 'logSet' });

    // The session the hook would now hold is a NEW object, not the one it
    // started with...
    expect(next.session).not.toBe(sess);
    // ...and it carries the logged set, which is exactly what a screen needs
    // to persist and could not get from the view alone.
    const block = next.session.blocks[0] as StrengthBlock<LoggedSet>;
    expect(block.exercises[0].sets[0].done).toBe(true);
  });
});
