// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
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

  it('keeps the picker closed until asked — as a CLASS, not by unmounting it', () => {
    /*
     * This asserted `not.toBeInTheDocument()` until 16 August 2026, and that
     * assertion was the bug written down as a requirement. "Closed" is a phone
     * concept: `.cb-picker` is only hidden inside the phone media query, and
     * unmounting the element took it away from DESKTOP too, where the reveal
     * button that brings it back is `display: none`.
     *
     * Closed now means the class is absent, which is exactly what the
     * stylesheet keys on and is true at every width.
     */
    renderBlock();
    expect(document.querySelector('.cb-picker')?.className).toBe('cb-picker');
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
    /* Scoped to the block's own list. The picker is mounted at every width
       now and offers 'Back Squat' too, so an unscoped query matches both and
       cannot tell "the block holds it" from "the library offers it". */
    const items = document.querySelector('.cb-block-items') as HTMLElement;
    expect(within(items).getByText('Back Squat')).toBeInTheDocument();
    expect(within(items).getByText('A')).toBeInTheDocument();
    expect(within(items).getByText('B')).toBeInTheDocument();
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

/*
 * A COACH AT DESKTOP WIDTH CAN PUT AN EXERCISE IN A BLOCK.
 *
 * Reported from a 1440px screen on 16 August 2026: a new day, one
 * Strength/Power block, and no way to add anything to it. The block rendered
 * its heading and its kind and stopped.
 *
 * The cause was a React condition standing in for a CSS one. `ExercisePicker`
 * was mounted behind `pickerOpen &&`, and the only control that sets
 * `pickerOpen` is `.cb-picker-reveal` — which the stylesheet turns on inside
 * the phone media query and nowhere else. Every automated check passed: jsdom
 * applies no stylesheet, so the reveal button was clickable in a test, and
 * `checks/screens.mjs` shoots for horizontal overflow rather than for whether
 * a control is reachable.
 *
 * The lesson worth keeping is narrower than "test the CSS". It is that when a
 * stylesheet already decides whether something is visible, React must not ALSO
 * decide whether it exists — two owners of one boolean, and they drifted apart
 * within two days of each other in opposite directions.
 */
describe('BlockEditor — reaching the exercise picker', () => {
  it('mounts the picker without anything being clicked first', () => {
    renderBlock();
    expect(document.querySelector('.cb-picker')).not.toBeNull();
    expect(screen.getByPlaceholderText('Search the exercise library')).toBeInTheDocument();
  });

  it('adds the picked exercise to the block, with a usable default set', () => {
    /* The path a coach actually takes, end to end: the picker is there, a
       movement is picked, and the block comes back holding it. */
    const props = renderBlock();
    fireEvent.click(screen.getByText('Back Squat'));

    const next = vi.mocked(props.onChange).mock.calls.at(-1)?.[0] as BlockValue;
    expect(next.exercises).toHaveLength(1);
    expect(next.exercises[0].name).toBe('Back Squat');
    // Reps and kilos — a valid pair, so nothing opens already locked.
    expect(next.exercises[0].columnA).toBe('reps');
    expect(next.exercises[0].columnB).toBe('weight_kg');
    expect(next.exercises[0].sets.length).toBeGreaterThan(0);
  });

  it('opens CLOSED on a phone — the reveal button is still the phone door', () => {
    /* The other half of the same contract. `picker-open` is absent until the
       reveal button is pressed, which is what the phone stylesheet keys on;
       desktop ignores the class because nothing hides the picker there. */
    renderBlock();
    expect(document.querySelector('.cb-picker')?.className).toBe('cb-picker');
    fireEvent.click(screen.getByText('+ Add exercise from library'));
    expect(document.querySelector('.cb-picker')?.className).toBe('cb-picker picker-open');
  });
});
