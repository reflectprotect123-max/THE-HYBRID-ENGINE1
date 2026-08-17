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

  it('lists the exercises already in the block, lettered', () => {
    renderBlock({
      block: {
        id: 'b1',
        category: 'Strength/Power',
        exercises: [
          { id: 'e1', name: 'Back Squat', columnA: 'reps', columnB: 'weight_kg', rest: 90, sets: [] },
          { id: 'e2', name: 'Row Erg', columnA: 'seconds', columnB: 'meters', rest: 90, sets: [] },
        ],
      },
    });
    /* Scoped to the block's own list. The wizard's own picker offers 'Back
       Squat' too once opened, so an unscoped query cannot tell "the block
       holds it" from "the library offers it". */
    const items = document.querySelector('.cb-block-items') as HTMLElement;
    expect(within(items).getByText('Back Squat')).toBeInTheDocument();
    expect(within(items).getByText('A')).toBeInTheDocument();
    expect(within(items).getByText('B')).toBeInTheDocument();
  });

  it('removes an exercise from the block', () => {
    const props = renderBlock({
      block: {
        id: 'b1',
        category: 'Strength/Power',
        exercises: [{ id: 'e1', name: 'Back Squat', columnA: 'reps', columnB: 'weight_kg', rest: 90, sets: [] }],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /remove Back Squat/i }));
    expect(props.onChange).toHaveBeenCalledWith(expect.objectContaining({ exercises: [] }));
  });
});

/*
 * THE WIZARD REPLACES THE ALWAYS-EXPANDED PICKER + INLINE DETAIL BODY.
 *
 * Adding an exercise, and editing one already in the block, now both go
 * through `ExerciseWizard` — see
 * `docs/superpowers/specs/2026-08-16-exercise-wizard-design.md`. `BlockEditor`
 * itself owns only which exercise (if any) the wizard is open for, and folds
 * the wizard's `WizardResult` into `block.exercises` on save.
 */
describe('BlockEditor — the exercise wizard', () => {
  const wizardBlock = { id: 'b1', category: 'Strength/Power', exercises: [] };

  it('opens the wizard on "+ Add exercise from library"', () => {
    const onChange = vi.fn();
    render(<BlockEditor block={wizardBlock} entries={[]} index={0} onChange={onChange} onRemove={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /add exercise from library/i }));
    expect(screen.getByText('What are they doing?')).toBeInTheDocument();
  });

  it('folds a new exercise from the wizard into block.exercises', () => {
    const onChange = vi.fn();
    render(
      <BlockEditor
        block={wizardBlock}
        entries={[{ name: 'Back Squat', tags: [], uses: 0 }]}
        index={0}
        onChange={onChange}
        onRemove={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /add exercise from library/i }));
    fireEvent.click(screen.getByText('Back Squat'));
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    fireEvent.click(screen.getByRole('button', { name: /skip to review/i }));
    fireEvent.click(screen.getByRole('button', { name: /^add exercise$/i }));
    const next = onChange.mock.calls[0][0];
    expect(next.exercises).toHaveLength(1);
    expect(next.exercises[0].name).toBe('Back Squat');
    expect(screen.queryByText('What are they doing?')).not.toBeInTheDocument();
  });

  it('clicking an existing exercise row opens the wizard pre-filled, not an inline expansion', () => {
    const withExercise = {
      ...wizardBlock,
      exercises: [
        {
          id: 'e1',
          name: 'Front Squat',
          columnA: 'reps',
          columnB: 'weight_kg',
          rest: 90,
          sets: [{ id: 'e1-s0', a: '5', b: '80' }],
        },
      ],
    };
    render(<BlockEditor block={withExercise} entries={[]} index={0} onChange={vi.fn()} onRemove={vi.fn()} />);
    fireEvent.click(screen.getByText('Front Squat'));
    expect(screen.getByDisplayValue('Front Squat')).toBeInTheDocument();
    expect(screen.queryByText(/pacing/i)).not.toBeInTheDocument();
  });

  it('edits an existing exercise in place, keeping its id and position', () => {
    const onChange = vi.fn();
    const withExercise = {
      ...wizardBlock,
      exercises: [
        { id: 'e1', name: 'Front Squat', columnA: 'reps', columnB: 'weight_kg', rest: 90, sets: [{ id: 'e1-s0', a: '5', b: '80' }] },
      ],
    };
    render(<BlockEditor block={withExercise} entries={[]} index={0} onChange={onChange} onRemove={vi.fn()} />);
    fireEvent.click(screen.getByText('Front Squat'));
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    fireEvent.click(screen.getByRole('button', { name: /skip to review/i }));
    fireEvent.change(screen.getByLabelText(/^rest/i), { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: /^add exercise$/i }));
    const next = onChange.mock.calls[0][0];
    expect(next.exercises).toHaveLength(1);
    expect(next.exercises[0].id).toBe('e1');
    expect(next.exercises[0].rest).toBe(120);
  });

  it('removes an exercise without opening the wizard', () => {
    const onChange = vi.fn();
    const withExercise = {
      ...wizardBlock,
      exercises: [{ id: 'e1', name: 'Front Squat', columnA: 'reps', columnB: 'weight_kg', rest: 90, sets: [] }],
    };
    render(<BlockEditor block={withExercise} entries={[]} index={0} onChange={onChange} onRemove={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /remove front squat/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ exercises: [] }));
    expect(screen.queryByText('What are they doing?')).not.toBeInTheDocument();
  });

  it('cancelling the wizard adds nothing and closes it', () => {
    const onChange = vi.fn();
    render(
      <BlockEditor
        block={wizardBlock}
        entries={[{ name: 'Back Squat', tags: [], uses: 0 }]}
        index={0}
        onChange={onChange}
        onRemove={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /add exercise from library/i }));
    fireEvent.click(screen.getByRole('button', { name: /back to block/i }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByText('What are they doing?')).not.toBeInTheDocument();
  });

  it("remembers the shape of the last added exercise as the next one's defaults", () => {
    const onChange = vi.fn();
    const twoEntries = [
      { name: 'Back Squat', tags: [], uses: 0 },
      { name: 'Front Squat', tags: [], uses: 0 },
    ];
    const { rerender } = render(
      <BlockEditor block={wizardBlock} entries={twoEntries} index={0} onChange={onChange} onRemove={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /add exercise from library/i }));
    fireEvent.click(screen.getByText('Back Squat'));
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    fireEvent.click(screen.getByRole('button', { name: /seconds/i }));
    fireEvent.click(screen.getByRole('button', { name: /skip to review/i }));
    fireEvent.click(screen.getByRole('button', { name: /add exercise/i }));
    const afterFirst = onChange.mock.calls[0][0];
    rerender(<BlockEditor block={afterFirst} entries={twoEntries} index={0} onChange={onChange} onRemove={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /add exercise from library/i }));
    fireEvent.click(screen.getByText('Front Squat'));
    fireEvent.click(screen.getByRole('button', { name: /^next$/i })); // -> measure, defaulted from lastShape
    expect(screen.getByRole('button', { name: /^seconds$/i })).toHaveClass('on');
  });
});

describe('a new movement joins the library', () => {
  it('reports the name so the coach keeps it, not just this block', () => {
    /* "+ New exercise" put the name in the block and nowhere else until
       16 August 2026. With the derived library emptied at the owner's request,
       that would have left a library that could never refill. */
    const onCreateMovement = vi.fn();
    const onChange = vi.fn();
    render(
      <BlockEditor
        block={{ id: 'b', category: 'Strength/Power', exercises: [] }}
        entries={[]}
        index={0}
        onCreateMovement={onCreateMovement}
        onChange={onChange}
        onRemove={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /add exercise from library/i }));
    fireEvent.change(screen.getByPlaceholderText(/search the exercise library/i), {
      target: { value: 'Zercher Squat' },
    });
    fireEvent.click(screen.getByRole('button', { name: /new exercise/i }));
    expect(onCreateMovement).toHaveBeenCalledWith('Zercher Squat');
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    fireEvent.click(screen.getByRole('button', { name: /skip to review/i }));
    fireEvent.click(screen.getByRole('button', { name: /add exercise/i }));
    expect(onChange).toHaveBeenCalled();
  });

  it('does neither for an empty name', () => {
    const onCreateMovement = vi.fn();
    const onChange = vi.fn();
    render(
      <BlockEditor
        block={{ id: 'b', category: 'Strength/Power', exercises: [] }}
        entries={[]}
        index={0}
        onCreateMovement={onCreateMovement}
        onChange={onChange}
        onRemove={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /add exercise from library/i }));
    fireEvent.click(screen.getByRole('button', { name: /new exercise/i }));
    expect(onCreateMovement).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});
