import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import type { CatalogueEntry } from '@hybrid/engine';
import { BlockEditor } from './BlockEditor';
import { newCondValue, newSetRows, type BlockValue } from './types';

const ENTRIES: CatalogueEntry[] = [];

function strengthBlock(): BlockValue {
  return {
    id: 'b1',
    category: 'Strength/Power',
    exercises: [
      { id: 'b1-0-Back squat', name: 'Back squat', columnA: 'reps', columnB: 'weight_kg', sets: newSetRows('b1-0-Back squat') },
    ],
  };
}

function condBlock(category = 'Conditioning'): BlockValue {
  return { id: 'b2', category, exercises: [], conditioning: newCondValue(category) };
}

/**
 * `BlockEditor` is controlled — it owns no block state. Tests that need a
 * change to be REFLECTED (pick an effort, then read the zone back) mount it
 * under this, which is the smallest possible stand-in for the real screen.
 * Tests that only need to assert what left the component use a jest.fn instead.
 */
function Harness({ initial }: { initial: BlockValue }) {
  const [block, setBlock] = useState(initial);
  return <BlockEditor block={block} entries={ENTRIES} index={0} onChange={setBlock} onRemove={() => {}} />;
}

describe('BlockEditor', () => {
  it('shows a conditioning block as a prescription, with no exercise list', () => {
    render(<Harness initial={condBlock()} />);
    expect(screen.getByText('Format')).toBeTruthy();
    expect(screen.getByText('Modality')).toBeTruthy();
    expect(screen.getByText('Effort')).toBeTruthy();
    expect(screen.getByLabelText('Minutes')).toBeTruthy();
    expect(screen.getByLabelText('Target distance in metres')).toBeTruthy();
    // No exercises and no way to add one: a conditioning block authors a
    // CondBlock, not sets.
    expect(screen.queryByTestId('cb-block-exercises')).toBeNull();
    expect(screen.queryByText('+ Add exercise from library')).toBeNull();
  });

  it('shows a strength block as an exercise list, with no prescription', () => {
    render(<Harness initial={strengthBlock()} />);
    expect(screen.getByTestId('cb-block-exercises')).toBeTruthy();
    expect(screen.getByText('Back squat')).toBeTruthy();
    expect(screen.getByText('A')).toBeTruthy();
    // The SetRows grid came with it.
    expect(screen.getByLabelText('Set 1 reps')).toBeTruthy();
    expect(screen.getByText('+ Add exercise from library')).toBeTruthy();
    // Nothing conditioning: no prescription controls, no reported zone.
    expect(screen.queryByTestId('cb-cond-effort')).toBeNull();
    expect(screen.queryByText(/heart-rate zone/)).toBeNull();
  });

  it('reports the heart-rate zone derived from the chosen effort, and offers no zone control', () => {
    render(<Harness initial={condBlock()} />);
    // Default effort for a Conditioning block is easy → zone low.
    expect(screen.getByText(/^Easy · RPE 3–4 · full sentences · heart-rate zone low$/)).toBeTruthy();

    fireEvent.press(within(screen.getByTestId('cb-cond-effort')).getByText('Hard'));
    expect(screen.getByText(/^Hard · RPE 8–9.5 · a few words at a time · heart-rate zone high$/)).toBeTruthy();
    expect(screen.queryByText(/heart-rate zone low/)).toBeNull();

    // The zone is derived, never picked: no control offers one.
    expect(screen.queryByText('Zone')).toBeNull();
    expect(screen.queryByLabelText('Zone')).toBeNull();
  });

  it('hides format and modality on a Mixed modal block rather than disabling them, and says why', () => {
    render(<Harness initial={condBlock('Mixed modal')} />);
    expect(screen.queryByTestId('cb-cond-format')).toBeNull();
    expect(screen.queryByTestId('cb-cond-modality')).toBeNull();
    expect(
      screen.getByText(
        /One continuous effort, heart rate recorded start to finish\. No intervals and no prescribed rest/,
      ),
    ).toBeTruthy();
    // Effort and duration still apply; the duration is a TARGET here.
    expect(screen.getByTestId('cb-cond-effort')).toBeTruthy();
    expect(screen.getByLabelText('Target minutes')).toBeTruthy();
    expect(screen.queryByLabelText('Minutes')).toBeNull();
  });

  it('seeds a conditioning value when switching into a conditioning category', () => {
    const onChange = jest.fn();
    render(
      <BlockEditor block={strengthBlock()} entries={ENTRIES} index={0} onChange={onChange} onRemove={() => {}} />,
    );
    fireEvent.press(within(screen.getByTestId('cb-block-kind')).getByText('Mixed modal'));
    const next: BlockValue = onChange.mock.calls[0][0];
    expect(next.category).toBe('Mixed modal');
    expect(next.conditioning).toEqual(newCondValue('Mixed modal'));
  });

  it('drops the conditioning value entirely when switching out of a conditioning category', () => {
    const onChange = jest.fn();
    render(<BlockEditor block={condBlock()} entries={ENTRIES} index={0} onChange={onChange} onRemove={() => {}} />);
    fireEvent.press(within(screen.getByTestId('cb-block-kind')).getByText('Warm-up'));
    const next: BlockValue = onChange.mock.calls[0][0];
    expect(next.category).toBe('Warm-up');
    // Not merely undefined-valued: the key is gone. A stale conditioning value
    // kept on a strength block round-trips a block the coach can no longer see
    // or edit.
    expect('conditioning' in next).toBe(false);
  });

  it('numbers the block from its position and can be removed', () => {
    const onRemove = jest.fn();
    render(
      <BlockEditor block={strengthBlock()} entries={ENTRIES} index={2} onChange={() => {}} onRemove={onRemove} />,
    );
    expect(screen.getByText('BLOCK 03')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Remove block'));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('collapses and expands the body, leaving the head and kind chooser in place', () => {
    render(<Harness initial={strengthBlock()} />);
    expect(screen.getByTestId('cb-block-exercises')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Collapse block'));
    expect(screen.queryByTestId('cb-block-exercises')).toBeNull();
    expect(screen.getByText('BLOCK 01')).toBeTruthy();
    expect(screen.getByTestId('cb-block-kind')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Collapse block'));
    expect(screen.getByTestId('cb-block-exercises')).toBeTruthy();
  });

  it('reveals the library picker and adds a picked exercise with a valid column pair', () => {
    const picked: CatalogueEntry[] = [{ name: 'Deadlift', tags: [], uses: 3 }];
    const onChange = jest.fn();
    render(
      <BlockEditor
        block={{ id: 'b3', category: 'Strength/Power', exercises: [] }}
        entries={picked}
        index={0}
        onChange={onChange}
        onRemove={() => {}}
      />,
    );
    fireEvent.press(screen.getByText('+ Add exercise from library'));
    fireEvent.press(screen.getByLabelText('Add Deadlift'));
    const next: BlockValue = onChange.mock.calls[0][0];
    expect(next.exercises).toHaveLength(1);
    expect(next.exercises[0]).toMatchObject({ name: 'Deadlift', columnA: 'reps', columnB: 'weight_kg' });
    expect(next.exercises[0].sets).toHaveLength(3);
  });

  it('removes an exercise from the block', () => {
    const onChange = jest.fn();
    render(
      <BlockEditor block={strengthBlock()} entries={ENTRIES} index={0} onChange={onChange} onRemove={() => {}} />,
    );
    fireEvent.press(screen.getByLabelText('Remove Back squat'));
    expect(onChange.mock.calls[0][0].exercises).toEqual([]);
  });

  it('sends a chosen format and modality up as a patched conditioning value', () => {
    const onChange = jest.fn();
    render(<BlockEditor block={condBlock()} entries={ENTRIES} index={0} onChange={onChange} onRemove={() => {}} />);
    fireEvent.press(within(screen.getByTestId('cb-cond-format')).getByText('Intervals'));
    expect(onChange.mock.calls[0][0].conditioning).toMatchObject({ fmt: 'intervals' });

    fireEvent.press(within(screen.getByTestId('cb-cond-modality')).getByText('Air bike'));
    expect(onChange.mock.calls[1][0].conditioning).toMatchObject({ modality: 'air_bike' });
  });
});
