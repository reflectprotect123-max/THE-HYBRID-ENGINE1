// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { SetRows, newSetRows } from './SetRows';

function renderSets(over: Partial<Parameters<typeof SetRows>[0]> = {}) {
  const props = {
    sets: [
      { id: 's1', a: '', b: '' },
      { id: 's2', a: '', b: '' },
      { id: 's3', a: '', b: '' },
    ],
    columnA: 'reps',
    columnB: 'weight_kg',
    onColumnChange: vi.fn(),
    onSetsChange: vi.fn(),
    ...over,
  };
  render(<SetRows {...props} />);
  return props;
}

describe('newSetRows', () => {
  /*
   * Three, matching the mockup's note and the app's own default — GuidedBuilder
   * seeds `sets: 3`. A different default here would mean the same coach gets a
   * different session depending on which screen they opened.
   */
  it('starts a new exercise with three empty sets', () => {
    const rows = newSetRows('e1');
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.a === '' && r.b === '')).toBe(true);
    expect(new Set(rows.map((r) => r.id)).size).toBe(3);
  });
});

describe('SetRows', () => {
  it('renders a row per set, two inputs each', () => {
    renderSets();
    expect(screen.getAllByRole('textbox')).toHaveLength(6);
  });

  it("uses each column type's placeholder", () => {
    renderSets();
    expect(screen.getAllByPlaceholderText('reps')).toHaveLength(3);
    expect(screen.getAllByPlaceholderText('kg')).toHaveLength(3);
  });

  it('records what you type into a set', () => {
    const props = renderSets();
    fireEvent.change(screen.getAllByPlaceholderText('reps')[0], { target: { value: '8' } });
    expect(props.onSetsChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 's1', a: '8' }),
      expect.objectContaining({ id: 's2', a: '' }),
      expect.objectContaining({ id: 's3', a: '' }),
    ]);
  });

  /*
   * The rule the mockup states in its own comment: "picking the same thing for
   * both would be a real logging mistake, so the second column greys out and
   * locks until the two differ again." A set claiming "8 reps and 8 reps" is
   * bad data, not a layout bug.
   */
  it('does not offer the first column measure to the second', () => {
    renderSets();
    const second = screen.getByLabelText(/second column measures/i);
    expect(within(second).queryByRole('option', { name: 'Reps' })).not.toBeInTheDocument();
    expect(within(second).getByRole('option', { name: 'Weight (kg)' })).toBeInTheDocument();
  });

  it('locks the second column and says why when the pair would duplicate', () => {
    renderSets({ columnA: 'reps', columnB: 'reps' });
    expect(screen.getByLabelText(/second column measures/i)).toBeDisabled();
    expect(screen.getByText(/cannot measure the same thing/i)).toBeInTheDocument();
  });

  it('leaves the second column usable when the pair is fine', () => {
    renderSets();
    expect(screen.getByLabelText(/second column measures/i)).not.toBeDisabled();
    expect(screen.queryByText(/cannot measure the same thing/i)).not.toBeInTheDocument();
  });

  it('reports a column change', () => {
    const props = renderSets();
    fireEvent.change(screen.getByLabelText(/first column measures/i), { target: { value: 'seconds' } });
    expect(props.onColumnChange).toHaveBeenCalledWith('a', 'seconds');
  });

  it('adds a set', () => {
    const props = renderSets();
    fireEvent.click(screen.getByRole('button', { name: /add set/i }));
    expect(vi.mocked(props.onSetsChange).mock.calls[0][0]).toHaveLength(4);
  });

  it('removes a set', () => {
    const props = renderSets();
    fireEvent.click(screen.getAllByRole('button', { name: /remove set/i })[0]);
    expect(vi.mocked(props.onSetsChange).mock.calls[0][0]).toHaveLength(2);
  });
});
