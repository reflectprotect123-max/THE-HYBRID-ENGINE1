// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { BlockView } from '@hybrid/session-authoring';
import { BlockStrip } from './BlockStrip';

function block(id: string, title: string, done: number, total: number): BlockView {
  return { id, title, progress: { done, total } };
}

describe('BlockStrip', () => {
  it('gives each segment its GLOBAL index, in session order', () => {
    const blocks = [block('b0', 'Warm-up', 0, 2), block('b1', 'Squat', 0, 4), block('b2', 'Row', 0, 3)];
    render(<BlockStrip blocks={blocks} currentIndex={0} onSelect={vi.fn()} />);

    expect(screen.getByText('Warm-up').closest('[data-parity]')).toHaveAttribute('data-parity', 'seg-0');
    expect(screen.getByText('Squat').closest('[data-parity]')).toHaveAttribute('data-parity', 'seg-1');
    expect(screen.getByText('Row').closest('[data-parity]')).toHaveAttribute('data-parity', 'seg-2');
  });

  it('tapping a segment dispatches goToBlock with its index', () => {
    const blocks = [block('b0', 'Warm-up', 0, 2), block('b1', 'Squat', 1, 4)];
    const onSelect = vi.fn();
    render(<BlockStrip blocks={blocks} currentIndex={0} onSelect={onSelect} />);

    fireEvent.click(screen.getByText('Squat'));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it('marks the current block and no other', () => {
    const blocks = [block('b0', 'Warm-up', 0, 2), block('b1', 'Squat', 0, 4)];
    render(<BlockStrip blocks={blocks} currentIndex={1} onSelect={vi.fn()} />);

    expect(screen.getByText('Warm-up').closest('button')).not.toHaveAttribute('aria-current');
    expect(screen.getByText('Squat').closest('button')).toHaveAttribute('aria-current', 'step');
  });
});
