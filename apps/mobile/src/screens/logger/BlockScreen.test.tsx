import { fireEvent, render, within } from '@testing-library/react-native';
import type { LoggedSet, StrengthBlock } from '@hybrid/engine';
import type { RoundView } from '@hybrid/session-authoring';
import { View } from 'react-native';
import { BlockScreen } from './BlockScreen';

/*
 * The mobile body of the block screen, held to the same contracts the web body
 * was — each of these pins a bug that was found the hard way rather than
 * imagined.
 */

const done = (aVal: string): LoggedSet => ({ t: '8', rpe: '8', aVal, aVal2: '8', felt: '8', done: true });
const target = (): LoggedSet => ({ t: '8', rpe: '8' });

// `RoundSet.planned`/`.logged` mirror what `view.ts` would have parsed from
// `target()`/`done(aVal)` above — kept in lockstep here since this suite builds
// `RoundView` fixtures by hand rather than through `sessionView`.
const planned = { reps: '8', rpe: '8' };
const loggedOf = (aVal: string) => ({ kg: Number(aVal), reps: 8, felt: 8 });

const soloBlock = (id: string, exName: string): StrengthBlock<LoggedSet> => ({
  id,
  exercises: [{ id: 'e0', name: exName, mode: 'reps_kg', sets: [done('100'), done('105')] }],
});

const soloRounds: RoundView[] = [
  { round: 0, sets: [{ exerciseIndex: 0, setIndex: 0, exerciseName: 'x', status: 'done', planned, logged: loggedOf('100') }] },
  { round: 1, sets: [{ exerciseIndex: 0, setIndex: 1, exerciseName: 'x', status: 'done', planned, logged: loggedOf('105') }] },
];

const noop = () => {};

describe('BlockScreen — receipt indices', () => {
  it('number within a block, not across the session', () => {
    const r = render(
      <>
        <View testID="a">
          <BlockScreen blockIndex={0} block={soloBlock('b0', 'Squat')} title="Squat" rounds={soloRounds} onRotate={noop} hot={null} draft={null} dispatch={noop} />
        </View>
        <View testID="b">
          <BlockScreen blockIndex={0} block={soloBlock('b1', 'Bench')} title="Bench" rounds={soloRounds} onRotate={noop} hot={null} draft={null} dispatch={noop} />
        </View>
      </>,
    );

    // Every block starts its own receipts back at 0. The driver reads
    // `receipt-<i>` scoped to the block on screen, so a session-wide counter
    // would make every block after the first disagree with the baseline.
    for (const id of ['a', 'b']) {
      const scope = within(r.getByTestId(id));
      expect(within(scope.getByTestId('receipt-0')).getByText('Set 1')).toBeTruthy();
      expect(within(scope.getByTestId('receipt-1')).getByText('Set 2')).toBeTruthy();
    }
  });
});

function supersetBlock(): StrengthBlock<LoggedSet> {
  return {
    id: 'ss',
    superset: true,
    exercises: [
      { id: 'e0', name: 'Press', mode: 'reps_kg', sets: [target(), done('40')] },
      { id: 'e1', name: 'Raise', mode: 'reps_kg', sets: [target(), target()] },
    ],
  };
}

describe('BlockScreen — a rotated round', () => {
  it('renders in its new order', () => {
    // Raise now leads round 0 — exactly what `rotateBlock` produces for an
    // unstarted round. This component takes that order as given; it never
    // recomputes it.
    const rotated: RoundView[] = [
      {
        round: 0,
        sets: [
          { exerciseIndex: 1, setIndex: 0, exerciseName: 'Raise', status: 'upcoming', planned, logged: null },
          { exerciseIndex: 0, setIndex: 0, exerciseName: 'Press', status: 'upcoming', planned, logged: null },
        ],
      },
    ];
    const r = render(
      <BlockScreen blockIndex={0} block={supersetBlock()} title="Press + Raise" rounds={rotated} onRotate={noop} hot={null} draft={null} dispatch={noop} />,
    );

    const names = r.getAllByText(/^(Press|Raise)$/).map((n) => n.props.children);
    expect(names).toEqual(['Raise', 'Press']);
  });
});

describe('BlockScreen — the rotate grip', () => {
  function roundsWithOneStarted(): RoundView[] {
    return [
      // Round 0: nothing logged yet — Press is live, Raise is the untouched
      // partner. Not started, so the partner gets the grip.
      {
        round: 0,
        sets: [
          { exerciseIndex: 0, setIndex: 0, exerciseName: 'Press', status: 'live', planned, logged: null },
          { exerciseIndex: 1, setIndex: 0, exerciseName: 'Raise', status: 'upcoming', planned, logged: null },
        ],
      },
      // Round 1: Press already logged for this round — history, not a choice,
      // so no grip even though Raise is live here too.
      {
        round: 1,
        sets: [
          { exerciseIndex: 0, setIndex: 1, exerciseName: 'Press', status: 'done', planned, logged: loggedOf('40') },
          { exerciseIndex: 1, setIndex: 1, exerciseName: 'Raise', status: 'live', planned, logged: null },
        ],
      },
    ];
  }

  it('appears only on a round that has not started', () => {
    const r = render(
      <BlockScreen blockIndex={0} block={supersetBlock()} title="Press + Raise" rounds={roundsWithOneStarted()} onRotate={noop} hot={null} draft={null} dispatch={noop} />,
    );
    expect(r.queryAllByTestId('grip')).toHaveLength(1);
  });

  it('is reachable without a pointer: a real button with a label, not a drag handle', () => {
    // The prototype's grip is drag-only. A phone has no hover and a drag is
    // not discoverable, so this has to be a tap target that a screen reader
    // can also name — the same reason the web body made it a <button>.
    const r = render(
      <BlockScreen blockIndex={0} block={supersetBlock()} title="Press + Raise" rounds={roundsWithOneStarted()} onRotate={noop} hot={null} draft={null} dispatch={noop} />,
    );
    const grip = r.getByLabelText('Do this movement first');
    expect(grip.props.accessibilityRole).toBe('button');
  });

  it('dispatches rotate for its own block on press', () => {
    const onRotate = jest.fn();
    const r = render(
      <BlockScreen blockIndex={0} block={supersetBlock()} title="Press + Raise" rounds={roundsWithOneStarted()} onRotate={onRotate} hot={null} draft={null} dispatch={noop} />,
    );
    fireEvent.press(r.getByTestId('grip'));
    expect(onRotate).toHaveBeenCalledTimes(1);
    expect(onRotate).toHaveBeenCalledWith('ss');
  });
});

describe('BlockScreen — skip / add set', () => {
  const hot = { exerciseIndex: 0, setIndex: 0, exerciseName: 'x', message: 'm', planned };
  const draft = { kg: 100, reps: 8, felt: 8, offered: 100, note: '' };
  const liveRounds: RoundView[] = [
    { round: 0, sets: [{ exerciseIndex: 0, setIndex: 0, exerciseName: 'x', status: 'live', planned, logged: null }] },
  ];
  const liveBlock: StrengthBlock<LoggedSet> = { id: 'b0', exercises: [{ id: 'e0', name: 'Squat', mode: 'reps_kg', sets: [target()] }] };

  it('renders neither control when nothing is owed', () => {
    const r = render(<BlockScreen blockIndex={0} block={soloBlock('b0', 'Squat')} title="Squat" rounds={soloRounds} onRotate={noop} hot={null} draft={null} dispatch={noop} />);
    expect(r.queryByTestId('skip-set')).toBeNull();
    expect(r.queryByTestId('add-set')).toBeNull();
  });

  it.each([
    ['skip-set', { type: 'skipSet' }],
    ['add-set', { type: 'addSet' }],
  ])('dispatches from %s while an owed set is on screen', (hook, action) => {
    const dispatch = jest.fn();
    const r = render(<BlockScreen blockIndex={0} block={liveBlock} title="Squat" rounds={liveRounds} onRotate={noop} hot={hot} draft={draft} dispatch={dispatch} />);
    fireEvent.press(r.getByTestId(hook));
    expect(dispatch).toHaveBeenCalledWith(action);
  });
});

describe('BlockScreen — a warm-up block', () => {
  function warmBlock(): StrengthBlock<LoggedSet> {
    return {
      id: 'w0',
      warmup: true,
      exercises: [
        { id: 'e0', name: 'Band pull-apart', mode: 'reps', sets: [done('done')] },
        { id: 'e1', name: 'Arm circles', mode: 'seconds', sets: [target()] },
      ],
    };
  }

  const piecePlanned = { reps: '30', rpe: '' };
  const pieceDraft = { kg: 0, reps: 30, felt: null, offered: 0, note: '' };

  it('renders a piece receipt for a done piece, and the live piece as a PieceCard', () => {
    const rounds: RoundView[] = [
      {
        round: 0,
        sets: [
          { exerciseIndex: 0, setIndex: 0, exerciseName: 'Band pull-apart', status: 'done', planned, logged: loggedOf('done') },
          { exerciseIndex: 1, setIndex: 0, exerciseName: 'Arm circles', status: 'live', planned: piecePlanned, logged: null },
        ],
      },
    ];
    const hot = { exerciseIndex: 1, setIndex: 0, exerciseName: 'Arm circles', message: 'irrelevant for a piece', planned: piecePlanned };
    const r = render(
      <BlockScreen blockIndex={0} block={warmBlock()} title="Warm-up" rounds={rounds} onRotate={noop} hot={hot} draft={pieceDraft} dispatch={noop} />,
    );

    expect(r.getByText('Band pull-apart')).toBeTruthy();
    expect(r.getByText('0:30')).toBeTruthy();
    expect(r.getByTestId('piece-done')).toBeTruthy();
  });

  it('never renders hot.message for a piece', () => {
    // A prep block has nothing for the coaching fold to judge. This is the
    // rule CLAUDE.md cares most about, and the package enforcing it is not a
    // reason to leave the screen unguarded — a screen that reintroduced the
    // message locally would pass every package test.
    const rounds: RoundView[] = [
      { round: 0, sets: [{ exerciseIndex: 1, setIndex: 0, exerciseName: 'Arm circles', status: 'live', planned: piecePlanned, logged: null }] },
    ];
    const hot = { exerciseIndex: 1, setIndex: 0, exerciseName: 'Arm circles', message: 'a coaching line that must not appear', planned: piecePlanned };
    const r = render(
      <BlockScreen blockIndex={0} block={warmBlock()} title="Warm-up" rounds={rounds} onRotate={noop} hot={hot} draft={pieceDraft} dispatch={noop} />,
    );
    expect(r.queryByText('a coaching line that must not appear')).toBeNull();
  });
});

describe('BlockScreen — the live set seam', () => {
  it('ships no placeholder markup for the live set', () => {
    // `nextUp` is the only thing that marks a set live, and it is the same
    // call that produces `hot` — so a live row with a null `hot` means the
    // hook contradicted itself. Rendering nothing is a safe no-op; rendering
    // a stub would be a guess.
    const rounds: RoundView[] = [
      { round: 0, sets: [{ exerciseIndex: 0, setIndex: 0, exerciseName: 'Squat', status: 'live', planned, logged: null }] },
    ];
    const block: StrengthBlock<LoggedSet> = {
      id: 'b0',
      exercises: [{ id: 'e0', name: 'Squat', mode: 'reps_kg', sets: [target()] }],
    };
    const r = render(<BlockScreen blockIndex={0} block={block} title="Squat" rounds={rounds} onRotate={noop} hot={null} draft={null} dispatch={noop} />);

    // The title and its subtitle render; nothing else does for this single
    // live-only round. (`1 sets` is the prototype's own wording, ungrammatical
    // and copied deliberately — the specification is the specification.)
    expect(r.getAllByText(/\S/).map((n) => n.props.children)).toEqual(['Squat', '1 sets']);
  });
});
