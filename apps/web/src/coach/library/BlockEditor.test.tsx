// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { CatalogueEntry } from '@hybrid/engine';
import { BlockEditor, BLOCK_CATEGORIES, type BlockValue } from './BlockEditor';
import { newSetRows } from './SetRows';

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
          { id: 'e1', name: 'Back Squat', columnA: 'reps', columnB: 'weight_kg', rest: 90, sets: [] },
          { id: 'e2', name: 'Row Erg', columnA: 'seconds', columnB: 'meters', rest: 90, sets: [] },
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
            columnB: 'weight_kg', rest: 90,
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
        exercises: [{ id: 'e1', name: 'Back Squat', columnA: 'reps', columnB: 'weight_kg', rest: 90, sets: [] }],
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

/*
 * THE EXERCISE ROW COLLAPSES, which is what the stylesheet has described since
 * stage 1 and what the markup did not do until 16 August 2026.
 *
 * `.cb-exp { display: none }` / `.cb-item.expanded .cb-exp { display: block }`
 * is the whole mechanism, so — exactly as with the picker — React must not also
 * decide whether the editor exists. These assert the class, because the class
 * is the contract; jsdom applies no stylesheet and cannot see the result.
 */
describe('BlockEditor — the exercise row', () => {
  const withSquat = {
    block: {
      id: 'b1',
      category: 'Strength/Power',
      exercises: [{ id: 'e1', name: 'Back Squat', columnA: 'reps', columnB: 'weight_kg', rest: 90, sets: newSetRows('e1') }],
    } as BlockValue,
  };

  it('opens collapsed, showing the letter, the name and a set count', () => {
    renderBlock(withSquat);
    const item = document.querySelector('.cb-item') as HTMLElement;
    expect(item.className).toBe('cb-item');
    expect(within(item).getByText('A')).toBeInTheDocument();
    expect(within(item).getByText('Back Squat')).toBeInTheDocument();
    expect(within(item).getByText('3 Sets')).toBeInTheDocument();
  });

  it('expands and collapses on the row, and keeps the editor mounted either way', () => {
    /* Mounted either way is the point. The sets table has to be in the DOM for
       `.cb-exp` to hide it, and hiding it is the stylesheet's job. */
    renderBlock(withSquat);
    expect(document.querySelector('.cb-exp')).not.toBeNull();

    /* Scoped to the item: the BLOCK's own collapse chevron carries
       aria-expanded too, and an unscoped query cannot tell them apart. */
    const item = () => document.querySelector('.cb-item') as HTMLElement;
    fireEvent.click(item().querySelector('.cb-item-head') as HTMLElement);
    expect(item().className).toBe('cb-item expanded');
    expect(document.querySelector('.cb-exp')).not.toBeNull();

    fireEvent.click(item().querySelector('.cb-item-head') as HTMLElement);
    expect(item().className).toBe('cb-item');
  });

  it('keeps Remove OUT of the head button, so opening a row cannot delete it', () => {
    /* `.cb-item-head` is a button and `.cb-item-remove` is its sibling in
       `.cb-item-head-row` — nesting the second inside the first would be
       invalid HTML and would fire both handlers on one click. */
    const props = renderBlock(withSquat);
    const remove = screen.getByRole('button', { name: /remove back squat/i });
    expect(remove.closest('.cb-item-head')).toBeNull();
    expect(remove.closest('.cb-item-head-row')).not.toBeNull();

    fireEvent.click(remove);
    expect(vi.mocked(props.onChange).mock.calls.at(-1)?.[0].exercises).toHaveLength(0);
  });

  it('tracks the set count in the pill as sets are added', () => {
    const props = renderBlock(withSquat);
    fireEvent.click(screen.getByRole('button', { name: /add a set/i }));
    const next = vi.mocked(props.onChange).mock.calls.at(-1)?.[0] as BlockValue;
    expect(next.exercises[0].sets).toHaveLength(4);
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
    fireEvent.change(screen.getByPlaceholderText(/search the exercise library/i), {
      target: { value: 'Zercher Squat' },
    });
    fireEvent.click(screen.getByRole('button', { name: /new exercise/i }));
    expect(onCreateMovement).toHaveBeenCalledWith('Zercher Squat');
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
    fireEvent.click(screen.getByRole('button', { name: /new exercise/i }));
    expect(onCreateMovement).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('how an exercise is paced', () => {
  const withExercise = (over: Record<string, unknown> = {}) => {
    const onChange = vi.fn();
    render(
      <BlockEditor
        block={{
          id: 'b',
          category: 'Strength/Power',
          exercises: [
            {
              id: 'e0',
              name: 'Back Squat',
              columnA: 'reps',
              columnB: 'weight_kg',
              rest: 90,
              sets: [
                { id: 's0', a: '5', b: '100' },
                { id: 's1', a: '5', b: '100' },
                { id: 's2', a: '5', b: '100' },
                { id: 's3', a: '5', b: '100' },
              ],
              ...over,
            },
          ],
        }}
        entries={[]}
        index={0}
        onChange={onChange}
        onRemove={vi.fn()}
      />,
    );
    /* The collapsed row's own head, not the picker entry with the same name. */
    fireEvent.click(document.querySelector('.cb-item-head') as HTMLElement);
    return onChange;
  };

  it('opens on plain rest, with the label that says when the clock starts', () => {
    withExercise();
    expect((screen.getByLabelText('Pacing') as HTMLSelectElement).value).toBe('rest');
    expect(screen.getByText(/countdown starts when the set ends/i)).toBeInTheDocument();
  });

  it('switching to Every seeds an interval rather than leaving it at zero', () => {
    /* A zero `every` is the same as no `every` to `restAfter`, so a mode the
       coach chose that stored 0 would silently be plain rest. */
    const onChange = withExercise();
    fireEvent.change(screen.getByLabelText('Pacing'), { target: { value: 'every' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        exercises: [expect.objectContaining({ every: 150 })],
      }),
    );
  });

  it('says the interval times the set count, which is the X the owner asked for', () => {
    withExercise({ every: 150 });
    expect(screen.getByText(/2:30 × 4 sets/i)).toBeInTheDocument();
  });

  it('switching back to Rest keeps the rest number the coach typed', () => {
    const onChange = withExercise({ every: 150 });
    fireEvent.change(screen.getByLabelText('Pacing'), { target: { value: 'rest' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        exercises: [expect.objectContaining({ every: 0, rest: 90 })],
      }),
    );
  });
});

describe('authoring the target RPE', () => {
  const openRow = (sets: { id: string; a: string; b: string; rpe?: string }[]) => {
    const onChange = vi.fn();
    render(
      <BlockEditor
        block={{
          id: 'b',
          category: 'Strength/Power',
          exercises: [
            { id: 'e0', name: 'Back Squat', columnA: 'reps', columnB: 'weight_kg', rest: 90, sets },
          ],
        }}
        entries={[]}
        index={0}
        onChange={onChange}
        onRemove={vi.fn()}
      />,
    );
    fireEvent.click(document.querySelector('.cb-item-head') as HTMLElement);
    return onChange;
  };

  it('writes what the coach types onto EVERY set', () => {
    /* `PlannedSet.rpe` is where the engine reads it, and the owner's own
       sessions write one band for the movement. */
    const onChange = openRow([
      { id: 's0', a: '5', b: '100' },
      { id: 's1', a: '5', b: '100' },
    ]);
    fireEvent.change(screen.getByLabelText(/target rpe/i), { target: { value: '7-10' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        exercises: [
          expect.objectContaining({
            sets: [expect.objectContaining({ rpe: '7-10' }), expect.objectContaining({ rpe: '7-10' })],
          }),
        ],
      }),
    );
  });

  it('shows the shared value when the sets agree', () => {
    openRow([
      { id: 's0', a: '5', b: '100', rpe: '8' },
      { id: 's1', a: '5', b: '100', rpe: '8' },
    ]);
    expect((screen.getByLabelText(/target rpe/i) as HTMLInputElement).value).toBe('8');
  });

  it('goes BLANK and says so when they disagree, rather than picking one', () => {
    /* Picking one and rendering it would make it true of all of them on the
       next keystroke. A top set at 9 with backoffs at 7 is real programming. */
    openRow([
      { id: 's0', a: '5', b: '100', rpe: '9' },
      { id: 's1', a: '5', b: '100', rpe: '7' },
    ]);
    expect((screen.getByLabelText(/target rpe/i) as HTMLInputElement).value).toBe('');
    expect(screen.getByText(/different RPE targets/i)).toBeInTheDocument();
  });
});
