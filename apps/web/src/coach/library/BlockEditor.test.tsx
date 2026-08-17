// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BlockEditor, BLOCK_CATEGORIES, type BlockValue } from './BlockEditor';

const block: BlockValue = { id: 'b1', category: 'Warm-up' };

function renderBlock(over: Partial<Parameters<typeof BlockEditor>[0]> = {}) {
  const props = {
    block,
    index: 0,
    onChange: vi.fn(),
    onRemove: vi.fn(),
    ...over,
  };
  render(<BlockEditor {...props} />);
  return props;
}

describe('BlockEditor', () => {
  it('numbers the block from its position, zero-padded', () => {
    renderBlock({ index: 2 });
    expect(screen.getByText('BLOCK 03')).toBeInTheDocument();
  });

  it('offers exactly the mockup categories, minus Strength/Power (deleted 17 August 2026)', () => {
    renderBlock();
    BLOCK_CATEGORIES.forEach((c) => {
      expect(screen.getByRole('option', { name: c })).toBeInTheDocument();
    });
    expect(screen.getAllByRole('option')).toHaveLength(BLOCK_CATEGORIES.length);
    expect(screen.queryByRole('option', { name: 'Strength/Power' })).not.toBeInTheDocument();
  });

  it('reports a category change', () => {
    const props = renderBlock();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Mobility' } });
    expect(props.onChange).toHaveBeenCalledWith(expect.objectContaining({ category: 'Mobility' }));
  });

  it('collapses and expands', () => {
    renderBlock();
    const toggle = screen.getByRole('button', { name: /collapse block/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('hides its body when collapsed', () => {
    renderBlock();
    expect(screen.getByPlaceholderText(/5 min bike/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /collapse block/i }));
    expect(screen.queryByPlaceholderText(/5 min bike/i)).not.toBeInTheDocument();
  });

  it('removes itself', () => {
    const props = renderBlock();
    fireEvent.click(screen.getByRole('button', { name: /remove block/i }));
    expect(props.onRemove).toHaveBeenCalled();
  });
});

describe('a Warm-up/Cooldown/Mobility block\'s free-text description', () => {
  it('offers a description box for Warm-up, Cooldown and Mobility, and reports edits to it', () => {
    const props = renderBlock({ block: { ...block, category: 'Warm-up' } });
    const box = screen.getByPlaceholderText(/5 min bike/i);
    fireEvent.change(box, { target: { value: '5 min bike, dynamic stretching' } });
    expect(props.onChange).toHaveBeenCalledWith(expect.objectContaining({ note: '5 min bike, dynamic stretching' }));
  });

  it('offers no description box for Conditioning', () => {
    renderBlock({ block: { ...block, category: 'Conditioning' } });
    expect(screen.queryByPlaceholderText(/5 min bike/i)).not.toBeInTheDocument();
  });
});

describe('reordering a block against its neighbours', () => {
  it('offers no move controls when neither handler is given', () => {
    renderBlock();
    expect(screen.queryByRole('button', { name: /^move block/i })).not.toBeInTheDocument();
  });

  it('calls onMoveUp / onMoveDown when given', () => {
    const onMoveUp = vi.fn();
    const onMoveDown = vi.fn();
    renderBlock({ onMoveUp, onMoveDown });
    fireEvent.click(screen.getByRole('button', { name: /move block up/i }));
    fireEvent.click(screen.getByRole('button', { name: /move block down/i }));
    expect(onMoveUp).toHaveBeenCalled();
    expect(onMoveDown).toHaveBeenCalled();
  });
});
