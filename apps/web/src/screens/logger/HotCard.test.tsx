// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Draft, HotSet } from '@hybrid/session-authoring';
import { HotCard } from './HotCard';

const hot = (message: string): HotSet => ({
  exerciseIndex: 0,
  setIndex: 0,
  exerciseName: 'Back Squat',
  message,
  planned: { reps: '8', rpe: '8' },
});

const draft = (patch: Partial<Draft> = {}): Draft => ({ kg: 100, reps: 8, felt: null, ...patch });

describe('HotCard — the coaching message', () => {
  it('renders a short message verbatim', () => {
    render(<HotCard hot={hot('opener — everything works from here')} draft={draft()} dispatch={vi.fn()} label="Set 1" weighted />);
    expect(screen.getByText('opener — everything works from here')).toHaveAttribute('data-parity', 'hot-why');
  });

  it('renders a long message with an em dash verbatim, untruncated and unreworded', () => {
    // Exactly the string `foldExercise` produces for a max set that came in
    // below the earned back-off — the branch the golden fixture pins. Not
    // paraphrased, not sentence-cased.
    const long = 'set 1 minus the back-off — arrive fresh';
    render(<HotCard hot={hot(long)} draft={draft()} dispatch={vi.fn()} label="Set 1" weighted />);
    const el = screen.getByText(long);
    expect(el).toHaveAttribute('data-parity', 'hot-why');
    expect(el.textContent).toBe(long);
  });
});

describe('HotCard — the log gate', () => {
  it('is disabled with reps but no rating', () => {
    render(<HotCard hot={hot('m')} draft={draft({ felt: null })} dispatch={vi.fn()} label="Set 1" weighted />);
    expect(screen.getByRole('button', { name: 'Log set' })).toBeDisabled();
  });

  it('is enabled once a rating is chosen', () => {
    render(<HotCard hot={hot('m')} draft={draft({ felt: 8 })} dispatch={vi.fn()} label="Set 1" weighted />);
    expect(screen.getByRole('button', { name: 'Log set' })).toBeEnabled();
  });

  it('dispatches logSet on tap', () => {
    const dispatch = vi.fn();
    render(<HotCard hot={hot('m')} draft={draft({ felt: 8 })} dispatch={dispatch} label="Set 1" weighted />);
    fireEvent.click(screen.getByRole('button', { name: 'Log set' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'logSet' });
  });
});

describe('HotCard — a bodyweight exercise', () => {
  it('renders no weight control at all', () => {
    render(<HotCard hot={hot('bodyweight')} draft={draft({ kg: 0 })} dispatch={vi.fn()} label="Set 1" weighted={false} />);
    expect(screen.queryByLabelText('Weight, tap to edit')).not.toBeInTheDocument();
    expect(document.querySelector('[data-parity="hot-kg"]')).not.toBeInTheDocument();
  });
});

describe('HotCard — the rep stepper', () => {
  it('floors at zero rather than going negative', () => {
    const dispatch = vi.fn();
    render(<HotCard hot={hot('m')} draft={draft({ reps: 0 })} dispatch={dispatch} label="Set 1" weighted />);
    fireEvent.click(screen.getByRole('button', { name: 'One rep fewer' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'setDraft', patch: { reps: 0 } });
  });

  it('every change goes through setDraft', () => {
    const dispatch = vi.fn();
    render(<HotCard hot={hot('m')} draft={draft({ reps: 5 })} dispatch={dispatch} label="Set 1" weighted />);
    fireEvent.click(screen.getByRole('button', { name: 'One rep more' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'setDraft', patch: { reps: 6 } });
  });
});

describe('HotCard — the rating chips', () => {
  it('7.5 is the chip whose attribute and value differ: rpe-75', () => {
    const dispatch = vi.fn();
    render(<HotCard hot={hot('m')} draft={draft()} dispatch={dispatch} label="Set 1" weighted />);
    const chip = document.querySelector('[data-parity="rpe-75"]');
    expect(chip).not.toBeNull();
    fireEvent.click(chip as Element);
    expect(dispatch).toHaveBeenCalledWith({ type: 'setDraft', patch: { felt: 7.5 } });
  });

  it('renders every chip from the prototype, 7 through 10', () => {
    render(<HotCard hot={hot('m')} draft={draft()} dispatch={vi.fn()} label="Set 1" weighted />);
    for (const key of ['7', '75', '8', '85', '9', '95', '10']) {
      expect(document.querySelector(`[data-parity="rpe-${key}"]`)).not.toBeNull();
    }
  });

  it('10 is the chip where the ×10 rule and the decimal-strip rule diverge: rpe-10', () => {
    const dispatch = vi.fn();
    render(<HotCard hot={hot('m')} draft={draft()} dispatch={dispatch} label="Set 1" weighted />);
    const chip = document.querySelector('[data-parity="rpe-10"]');
    expect(chip).not.toBeNull();
    fireEvent.click(chip as Element);
    expect(dispatch).toHaveBeenCalledWith({ type: 'setDraft', patch: { felt: 10 } });
  });
});
