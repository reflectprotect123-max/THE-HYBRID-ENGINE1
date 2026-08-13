// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { LoggedSet, StrengthBlock } from '@hybrid/engine';
import type { RoundView } from '@hybrid/session-authoring';
import { BlockScreen } from './BlockScreen';

const done = (aVal: string): LoggedSet => ({ t: '8', rpe: '8', aVal, aVal2: '8', felt: '8', done: true });
const target = (): LoggedSet => ({ t: '8', rpe: '8' });

// `RoundSet.planned`/`.logged` mirror what `view.ts` would have parsed from
// `target()`/`done(aVal)` above — kept in lockstep here since this suite
// builds `RoundView` fixtures by hand rather than through `sessionView`.
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

describe('BlockScreen — receipt indices', () => {
  it('number within a block, not across the session', () => {
    render(
      <>
        <div data-testid="a">
          <BlockScreen block={soloBlock('b0', 'Squat')} title="Squat" rounds={soloRounds} onRotate={vi.fn()} hot={null} draft={null} dispatch={vi.fn()} />
        </div>
        <div data-testid="b">
          <BlockScreen block={soloBlock('b1', 'Bench')} title="Bench" rounds={soloRounds} onRotate={vi.fn()} hot={null} draft={null} dispatch={vi.fn()} />
        </div>
      </>,
    );

    const a = within(screen.getByTestId('a'));
    const b = within(screen.getByTestId('b'));

    // Every block starts its own receipts back at 0 — [data-parity="receipt-0"]
    // must not skip ahead in the second block just because the first one
    // already used that index.
    expect(a.getByText('Set 1').closest('[data-parity]')).toHaveAttribute('data-parity', 'receipt-0');
    expect(a.getByText('Set 2').closest('[data-parity]')).toHaveAttribute('data-parity', 'receipt-1');
    expect(b.getByText('Set 1').closest('[data-parity]')).toHaveAttribute('data-parity', 'receipt-0');
    expect(b.getByText('Set 2').closest('[data-parity]')).toHaveAttribute('data-parity', 'receipt-1');
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
    const { container } = render(
      <BlockScreen block={supersetBlock()} title="Press + Raise" rounds={rotated} onRotate={vi.fn()} hot={null} draft={null} dispatch={vi.fn()} />,
    );

    const order = Array.from(container.querySelectorAll('.text-dim.font-\\[600\\]')).map((el) => el.textContent);
    expect(order).toEqual(['Raise', 'Press']);
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
      // Round 1: Press already logged for this round — history, not a
      // choice, so no grip even though Raise is live here too.
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
    const { container } = render(
      <BlockScreen block={supersetBlock()} title="Press + Raise" rounds={roundsWithOneStarted()} onRotate={vi.fn()} hot={null} draft={null} dispatch={vi.fn()} />,
    );

    const grips = container.querySelectorAll('[data-parity="grip"]');
    expect(grips).toHaveLength(1);
  });

  it('is a real button that dispatches rotate on tap', () => {
    const onRotate = vi.fn();
    render(
      <BlockScreen block={supersetBlock()} title="Press + Raise" rounds={roundsWithOneStarted()} onRotate={onRotate} hot={null} draft={null} dispatch={vi.fn()} />,
    );

    const grip = screen.getByRole('button', { name: /do this movement first/i });
    fireEvent.click(grip);

    expect(onRotate).toHaveBeenCalledTimes(1);
    expect(onRotate).toHaveBeenCalledWith('ss');
  });

  it('rotates on keyboard Enter, not only on click', () => {
    const onRotate = vi.fn();
    render(
      <BlockScreen block={supersetBlock()} title="Press + Raise" rounds={roundsWithOneStarted()} onRotate={onRotate} hot={null} draft={null} dispatch={vi.fn()} />,
    );

    const grip = screen.getByRole('button', { name: /do this movement first/i });
    fireEvent.keyDown(grip, { key: 'Enter', code: 'Enter' });

    expect(onRotate).toHaveBeenCalledTimes(1);
    expect(onRotate).toHaveBeenCalledWith('ss');
  });
});

describe('BlockScreen — skip / add set', () => {
  const hot = { exerciseIndex: 0, setIndex: 0, exerciseName: 'x', message: 'm', planned };
  const draft = { kg: 100, reps: 8, felt: 8 };

  it('renders neither control when nothing is owed', () => {
    render(<BlockScreen block={soloBlock('b0', 'Squat')} title="Squat" rounds={soloRounds} onRotate={vi.fn()} hot={null} draft={null} dispatch={vi.fn()} />);
    expect(document.querySelector('[data-parity="skip-set"]')).not.toBeInTheDocument();
    expect(document.querySelector('[data-parity="add-set"]')).not.toBeInTheDocument();
  });

  it('dispatches skipSet on tap, while an owed set is on screen', () => {
    const dispatch = vi.fn();
    const liveRounds: RoundView[] = [
      { round: 0, sets: [{ exerciseIndex: 0, setIndex: 0, exerciseName: 'x', status: 'live', planned, logged: null }] },
    ];
    const block: StrengthBlock<LoggedSet> = { id: 'b0', exercises: [{ id: 'e0', name: 'Squat', mode: 'reps_kg', sets: [target()] }] };
    render(<BlockScreen block={block} title="Squat" rounds={liveRounds} onRotate={vi.fn()} hot={hot} draft={draft} dispatch={dispatch} />);

    fireEvent.click(document.querySelector('[data-parity="skip-set"]') as Element);
    expect(dispatch).toHaveBeenCalledWith({ type: 'skipSet' });
  });

  it('dispatches addSet on tap, while an owed set is on screen', () => {
    const dispatch = vi.fn();
    const liveRounds: RoundView[] = [
      { round: 0, sets: [{ exerciseIndex: 0, setIndex: 0, exerciseName: 'x', status: 'live', planned, logged: null }] },
    ];
    const block: StrengthBlock<LoggedSet> = { id: 'b0', exercises: [{ id: 'e0', name: 'Squat', mode: 'reps_kg', sets: [target()] }] };
    render(<BlockScreen block={block} title="Squat" rounds={liveRounds} onRotate={vi.fn()} hot={hot} draft={draft} dispatch={dispatch} />);

    fireEvent.click(document.querySelector('[data-parity="add-set"]') as Element);
    expect(dispatch).toHaveBeenCalledWith({ type: 'addSet' });
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

  it('renders a piece receipt for a done piece, and the live piece as a PieceCard', () => {
    const rounds: RoundView[] = [
      {
        round: 0,
        sets: [
          { exerciseIndex: 0, setIndex: 0, exerciseName: 'Band pull-apart', status: 'done', planned, logged: loggedOf('done') },
          { exerciseIndex: 1, setIndex: 0, exerciseName: 'Arm circles', status: 'live', planned: { reps: '30', rpe: '' }, logged: null },
        ],
      },
    ];
    const hot = { exerciseIndex: 1, setIndex: 0, exerciseName: 'Arm circles', message: 'irrelevant for a piece', planned: { reps: '30', rpe: '' } };
    const draft = { kg: 0, reps: 30, felt: null };
    render(
      <BlockScreen block={warmBlock()} title="Warm-up" rounds={rounds} onRotate={vi.fn()} hot={hot} draft={draft} dispatch={vi.fn()} />,
    );

    expect(screen.getByText('Band pull-apart')).toBeInTheDocument();
    expect(screen.getByText('0:30')).toBeInTheDocument();
    expect(document.querySelector('[data-parity="piece-done"]')).toBeInTheDocument();
  });

  it('never renders hot.message for a piece', () => {
    const rounds: RoundView[] = [
      { round: 0, sets: [{ exerciseIndex: 1, setIndex: 0, exerciseName: 'Arm circles', status: 'live', planned: { reps: '30', rpe: '' }, logged: null }] },
    ];
    const hot = { exerciseIndex: 1, setIndex: 0, exerciseName: 'Arm circles', message: 'a coaching line that must not appear', planned: { reps: '30', rpe: '' } };
    const draft = { kg: 0, reps: 30, felt: null };
    render(
      <BlockScreen block={warmBlock()} title="Warm-up" rounds={rounds} onRotate={vi.fn()} hot={hot} draft={draft} dispatch={vi.fn()} />,
    );
    expect(screen.queryByText('a coaching line that must not appear')).not.toBeInTheDocument();
  });
});

describe('BlockScreen — the live set seam', () => {
  it('ships no placeholder markup for the live set', () => {
    const rounds: RoundView[] = [
      { round: 0, sets: [{ exerciseIndex: 0, setIndex: 0, exerciseName: 'Squat', status: 'live', planned, logged: null }] },
    ];
    const block: StrengthBlock<LoggedSet> = {
      id: 'b0',
      exercises: [{ id: 'e0', name: 'Squat', mode: 'reps_kg', sets: [target()] }],
    };
    const { container } = render(<BlockScreen block={block} title="Squat" rounds={rounds} onRotate={vi.fn()} hot={null} draft={null} dispatch={vi.fn()} />);

    // The title renders; nothing else does for this single live-only round.
    expect(container.textContent?.trim()).toBe('Squat');
  });
});
