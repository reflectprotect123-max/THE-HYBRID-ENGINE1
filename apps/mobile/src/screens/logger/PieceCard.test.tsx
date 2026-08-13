import { act, fireEvent, render } from '@testing-library/react-native';
import type { HotSet } from '@hybrid/session-authoring';
import { PieceCard } from './PieceCard';

const piece = (reps: string, name = 'Row'): HotSet => ({
  exerciseIndex: 0,
  setIndex: 0,
  exerciseName: name,
  message: 'a coaching line a piece must never show',
  planned: { reps, rpe: '' },
});

const noop = () => {};

describe('PieceCard — a timed piece', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('shows the clock instead of repeating the target', () => {
    const r = render(<PieceCard hot={piece('60')} mode="seconds" dispatch={noop} />);
    expect(r.getByTestId('warm-clock').props.children).toBe('1:00');
    expect(r.queryByTestId('hot-presc')).toBeNull();
  });

  it('counts down once a second while running', () => {
    const r = render(<PieceCard hot={piece('60')} mode="seconds" dispatch={noop} />);
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(r.getByTestId('warm-clock').props.children).toBe('0:57');
  });

  it('pauses and resumes', () => {
    const r = render(<PieceCard hot={piece('60')} mode="seconds" dispatch={noop} />);
    fireEvent.press(r.getByLabelText('Pause'));
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(r.getByTestId('warm-clock').props.children).toBe('1:00');
    fireEvent.press(r.getByLabelText('Start'));
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(r.getByTestId('warm-clock').props.children).toBe('0:58');
  });

  it('completes itself on reaching zero', () => {
    const dispatch = jest.fn();
    render(<PieceCard hot={piece('2')} mode="seconds" dispatch={dispatch} />);
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(dispatch).toHaveBeenCalledWith({ type: 'completePiece' });
  });

  it('stops counting once unmounted', () => {
    // A block switch unmounts this card. Nothing may keep ticking for a piece
    // that is no longer on screen.
    const dispatch = jest.fn();
    const r = render(<PieceCard hot={piece('2')} mode="seconds" dispatch={dispatch} />);
    r.unmount();
    act(() => {
      jest.advanceTimersByTime(10_000);
    });
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('PieceCard — an untimed piece', () => {
  it('shows its authored target and no clock', () => {
    const r = render(<PieceCard hot={piece('12 reps', 'Air Squats')} mode="reps" dispatch={noop} />);
    expect(r.getByTestId('hot-presc').props.children).toBe('12 reps');
    expect(r.queryByTestId('warm-clock')).toBeNull();
  });
});

describe('PieceCard — the completion action', () => {
  it('completes with completePiece, never logSet with a fabricated rating', () => {
    // `logSet` is gated on a felt rating a piece never gives, and its own
    // `openDraft` calls the coaching fold. Satisfying that gate with a felt of
    // 0 nobody was asked for is exactly what `completePiece` exists to stop.
    const dispatch = jest.fn();
    const r = render(<PieceCard hot={piece('12 reps')} mode="reps" dispatch={dispatch} />);
    fireEvent.press(r.getByTestId('piece-done'));
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: 'completePiece' });
  });
});

describe('PieceCard — the coaching rule', () => {
  it('never renders hot.message', () => {
    const r = render(<PieceCard hot={piece('12 reps')} mode="reps" dispatch={noop} />);
    expect(r.queryByText('a coaching line a piece must never show')).toBeNull();
  });
});
