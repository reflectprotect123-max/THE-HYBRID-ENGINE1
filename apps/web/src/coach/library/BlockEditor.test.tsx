// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { CatalogueEntry } from '@hybrid/engine';
import { BlockEditor, BLOCK_CATEGORIES, type BlockValue } from './BlockEditor';

const entries: CatalogueEntry[] = [
  { name: 'Back Squat', tags: ['Barbell'], uses: 2 },
  { name: 'Row Erg', tags: ['Conditioning'], uses: 1 },
];

const block: BlockValue = { id: 'b1', category: 'Strength/Power', exercises: [] };

function renderBlock(over: Partial<Parameters<typeof BlockEditor>[0]> = {}) {
  const props = {
    block,
    entries,
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

  it('offers exactly the mockup categories', () => {
    renderBlock();
    BLOCK_CATEGORIES.forEach((c) => {
      expect(screen.getByRole('option', { name: c })).toBeInTheDocument();
    });
    expect(screen.getAllByRole('option')).toHaveLength(BLOCK_CATEGORIES.length);
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
    expect(screen.getByRole('button', { name: /add exercise from library/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /collapse block/i }));
    expect(screen.queryByRole('button', { name: /add exercise from library/i })).not.toBeInTheDocument();
  });

  it('removes itself', () => {
    const props = renderBlock();
    fireEvent.click(screen.getByRole('button', { name: /remove block/i }));
    expect(props.onRemove).toHaveBeenCalled();
  });

  it('keeps the picker closed until asked', () => {
    renderBlock();
    expect(screen.queryByPlaceholderText('Search the exercise library')).not.toBeInTheDocument();
  });

  it('adds an exercise chosen from the picker', () => {
    const props = renderBlock();
    fireEvent.click(screen.getByRole('button', { name: /add exercise from library/i }));
    fireEvent.click(screen.getByRole('button', { name: /Back Squat/i }));
    expect(props.onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        exercises: [expect.objectContaining({ name: 'Back Squat' })],
      }),
    );
  });

  it('lists the exercises already in the block, lettered', () => {
    renderBlock({
      block: {
        id: 'b1',
        category: 'Strength/Power',
        exercises: [
          { id: 'e1', name: 'Back Squat', columnA: 'reps', columnB: 'weight_kg', sets: [] },
          { id: 'e2', name: 'Row Erg', columnA: 'seconds', columnB: 'meters', sets: [] },
        ],
      },
    });
    expect(screen.getByText('Back Squat')).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  /*
   * The integration Task 7 adds: an exercise arrives with its three default
   * sets and a valid column pair, so it never opens already locked.
   */
  it('gives a newly added exercise three sets and a usable column pair', () => {
    const props = renderBlock();
    fireEvent.click(screen.getByRole('button', { name: /add exercise from library/i }));
    fireEvent.click(screen.getByRole('button', { name: /Back Squat/i }));
    const next = vi.mocked(props.onChange).mock.calls[0][0];
    expect(next.exercises[0].sets).toHaveLength(3);
    expect(next.exercises[0].columnA).not.toBe(next.exercises[0].columnB);
  });

  it('renders the set rows for an exercise already in the block', () => {
    renderBlock({
      block: {
        id: 'b1',
        category: 'Strength/Power',
        exercises: [
          {
            id: 'e1',
            name: 'Back Squat',
            columnA: 'reps',
            columnB: 'weight_kg',
            sets: [{ id: 's1', a: '', b: '' }],
          },
        ],
      },
    });
    expect(screen.getByLabelText(/first column measures/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('reps')).toBeInTheDocument();
  });

  it('removes an exercise from the block', () => {
    const props = renderBlock({
      block: {
        id: 'b1',
        category: 'Strength/Power',
        exercises: [{ id: 'e1', name: 'Back Squat', columnA: 'reps', columnB: 'weight_kg', sets: [] }],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /remove Back Squat/i }));
    expect(props.onChange).toHaveBeenCalledWith(expect.objectContaining({ exercises: [] }));
  });
});
