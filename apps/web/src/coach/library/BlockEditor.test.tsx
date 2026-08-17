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

  /*
   * `.cb-picker-reveal` was `display: none` at top level in
   * `coach-redesign.css` and only `display: block` inside the
   * `(max-width: 760px)` media query — a phone-only reveal for a picker that
   * used to be always-mounted on desktop. The wizard made this button the
   * ONLY way to add an exercise at any width, so that phone-only visibility
   * meant a coach at 1440px — the width this workspace is composed at —
   * could not add an exercise to a block at all. jsdom applies no
   * stylesheet, so `fireEvent.click` on a `display: none` element succeeds
   * regardless of layout; the assertion that would have caught this is on
   * the CLASS, matching how `ExercisePicker.test.tsx` tests the
   * `picker-open`/phone visibility contract elsewhere in this codebase.
   */
  it('the add-exercise trigger does not carry the phone-only reveal class', () => {
    render(<BlockEditor block={wizardBlock} entries={[]} index={0} onChange={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByRole('button', { name: /add exercise from library/i })).not.toHaveClass('cb-picker-reveal');
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

/*
 * CRITICAL FINDING 2b — the wizard's Values step writes one shared value
 * across every set and can never author a genuine wave, a per-set `warm`
 * flag, or a `NONE_COLUMN`/arbitrary column pair. This is the direct escape
 * hatch back to `SetRows`, reached WITHOUT opening the wizard.
 */
describe('BlockEditor — the set-table escape hatch', () => {
  const exerciseWithTwoSets = {
    id: 'e1', name: 'Front Squat', columnA: 'reps', columnB: 'weight_kg', rest: 90,
    sets: [
      { id: 'e1-s0', a: '10', b: '40', warm: true },
      { id: 'e1-s1', a: '5', b: '90' },
    ],
  };

  it('opens the set table directly, without opening the wizard', () => {
    render(
      <BlockEditor
        block={{ id: 'b1', category: 'Strength/Power', exercises: [exerciseWithTwoSets] }}
        entries={[]}
        index={0}
        onChange={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /edit front squat's sets directly/i }));
    expect(screen.queryByText('What are they doing?')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/set 1 reps/i)).toBeInTheDocument();
  });

  it('edits a single set value directly, leaving the other set untouched', () => {
    const onChange = vi.fn();
    render(
      <BlockEditor
        block={{ id: 'b1', category: 'Strength/Power', exercises: [exerciseWithTwoSets] }}
        entries={[]}
        index={0}
        onChange={onChange}
        onRemove={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /edit front squat's sets directly/i }));
    fireEvent.change(screen.getByLabelText(/set 1 reps/i), { target: { value: '3' } });
    const next = onChange.mock.calls[0][0];
    expect(next.exercises[0].sets[0]).toMatchObject({ a: '3', warm: true });
    expect(next.exercises[0].sets[1]).toMatchObject({ a: '5', b: '90' });
  });

  it('toggling a warm-up flag directly is not reachable through the wizard', () => {
    const onChange = vi.fn();
    render(
      <BlockEditor
        block={{ id: 'b1', category: 'Strength/Power', exercises: [exerciseWithTwoSets] }}
        entries={[]}
        index={0}
        onChange={onChange}
        onRemove={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /edit front squat's sets directly/i }));
    fireEvent.click(screen.getByRole('button', { name: /set 2: a working set/i }));
    const next = onChange.mock.calls[0][0];
    expect(next.exercises[0].sets[1].warm).toBe(true);
  });
});

/*
 * IMPORTANT FINDING 3, end to end — `BlockEditor.handleWizardSave` merges
 * with `{ ...e, ...result }`; this proves that merge actually clears a
 * blanked Tempo rather than keeping the exercise's stale value.
 */
describe('BlockEditor — clearing tempo through the wizard', () => {
  it('blanking Tempo on an edit and saving removes it from the stored exercise', () => {
    const onChange = vi.fn();
    const withTempo = {
      id: 'b1', category: 'Strength/Power',
      exercises: [
        { id: 'e1', name: 'Front Squat', columnA: 'reps', columnB: 'weight_kg', rest: 90, tempo: '3-1-1-0', sets: [{ id: 'e1-s0', a: '5', b: '80' }] },
      ],
    };
    render(<BlockEditor block={withTempo} entries={[]} index={0} onChange={onChange} onRemove={vi.fn()} />);
    fireEvent.click(screen.getByText('Front Squat'));
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    fireEvent.click(screen.getByRole('button', { name: /skip to review/i }));
    fireEvent.change(screen.getByLabelText(/^tempo/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /^add exercise$/i }));
    const next = onChange.mock.calls[0][0];
    expect(next.exercises[0].tempo).toBeUndefined();
  });
});

/*
 * IMPORTANT FINDING 6, end to end — two new exercises added to the same
 * block must not collide on set ids.
 */
describe('BlockEditor — new exercises get non-colliding set ids', () => {
  it('gives two new exercises in the same block distinct set-id prefixes', () => {
    const onChange = vi.fn();
    const twoEntries = [
      { name: 'Back Squat', tags: [], uses: 0 },
      { name: 'Front Squat', tags: [], uses: 0 },
    ];
    const emptyBlock = { id: 'b1', category: 'Strength/Power', exercises: [] };
    const { rerender } = render(
      <BlockEditor block={emptyBlock} entries={twoEntries} index={0} onChange={onChange} onRemove={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /add exercise from library/i }));
    fireEvent.click(screen.getByText('Back Squat'));
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    fireEvent.click(screen.getByRole('button', { name: /skip to review/i }));
    fireEvent.click(screen.getByRole('button', { name: /^add exercise$/i }));
    const afterFirst = onChange.mock.calls[0][0];

    rerender(<BlockEditor block={afterFirst} entries={twoEntries} index={0} onChange={onChange} onRemove={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /add exercise from library/i }));
    fireEvent.click(screen.getByText('Front Squat'));
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    fireEvent.click(screen.getByRole('button', { name: /skip to review/i }));
    fireEvent.click(screen.getByRole('button', { name: /^add exercise$/i }));
    const afterSecond = onChange.mock.calls[1][0];

    const firstIds: string[] = afterSecond.exercises[0].sets.map((s: { id: string }) => s.id);
    const secondIds: string[] = afterSecond.exercises[1].sets.map((s: { id: string }) => s.id);
    expect(firstIds.some((id) => secondIds.includes(id))).toBe(false);
  });
});
