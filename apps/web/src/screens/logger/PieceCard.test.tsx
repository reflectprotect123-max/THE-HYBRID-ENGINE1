// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Draft, HotSet } from '@hybrid/session-authoring';
import { PieceCard } from './PieceCard';

const hot = (reps: string): HotSet => ({
  exerciseIndex: 0,
  setIndex: 0,
  exerciseName: 'Band pull-apart',
  message: 'irrelevant — a piece has no coaching line',
  planned: { reps, rpe: '' },
});

const draft = (patch: Partial<Draft> = {}): Draft => ({ kg: 0, reps: 0, felt: null, ...patch });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('PieceCard — a timed piece', () => {
  it('counts down once a second', () => {
    render(<PieceCard hot={hot('3')} mode="seconds" draft={draft()} dispatch={vi.fn()} />);
    expect(screen.getByText('0:03')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText('0:02')).toBeInTheDocument();
  });

  it('can be finished early, before the clock reaches zero', () => {
    const dispatch = vi.fn();
    render(<PieceCard hot={hot('30')} mode="seconds" draft={draft()} dispatch={dispatch} />);
    act(() => vi.advanceTimersByTime(1000));

    fireEvent.click(screen.getByText('Done'));

    expect(dispatch).toHaveBeenCalledWith({ type: 'logSet' });
  });

  it('finishes itself once the clock reaches zero', () => {
    const dispatch = vi.fn();
    render(<PieceCard hot={hot('2')} mode="seconds" draft={draft()} dispatch={dispatch} />);
    act(() => vi.advanceTimersByTime(2000));

    expect(dispatch).toHaveBeenCalledWith({ type: 'logSet' });
  });

  it('carries no rating — Done never asks for one', () => {
    render(<PieceCard hot={hot('30')} mode="seconds" draft={draft()} dispatch={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /^\d/ })).not.toBeInTheDocument();
  });
});

describe('PieceCard — a rep piece', () => {
  it('has no clock', () => {
    render(<PieceCard hot={hot('10')} mode="reps" draft={draft()} dispatch={vi.fn()} />);
    expect(screen.queryByText(/^\d:\d\d$/)).not.toBeInTheDocument();
    expect(screen.getByText('10')).toHaveAttribute('data-parity', 'hot-presc');
  });

  it('Done carries data-parity="piece-done"', () => {
    render(<PieceCard hot={hot('10')} mode="reps" draft={draft()} dispatch={vi.fn()} />);
    expect(screen.getByText('Done')).toHaveAttribute('data-parity', 'piece-done');
  });

  it('dispatches logSet on tap', () => {
    const dispatch = vi.fn();
    render(<PieceCard hot={hot('10')} mode="reps" draft={draft()} dispatch={dispatch} />);
    fireEvent.click(screen.getByText('Done'));
    expect(dispatch).toHaveBeenCalledWith({ type: 'logSet' });
  });
});

describe('PieceCard — off screen', () => {
  it("stops ticking once it leaves the block it lives on", () => {
    const dispatch = vi.fn();
    const { unmount } = render(<PieceCard hot={hot('5')} mode="seconds" draft={draft()} dispatch={dispatch} />);
    act(() => vi.advanceTimersByTime(1000));
    unmount();

    // Enough fake time for the clock to have reached zero and fired, had the
    // interval survived the unmount.
    act(() => vi.advanceTimersByTime(10000));

    expect(dispatch).not.toHaveBeenCalled();
  });
});
