import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { SetRows } from './SetRows';
import { newSetRows, type SetRow } from './types';

describe('SetRows', () => {
  it('renders both column choices as chip rows, from COLUMN_TYPES', () => {
    render(
      <SetRows sets={newSetRows('ex1')} columnA="reps" columnB="weight_kg" onColumnChange={() => {}} onSetsChange={() => {}} />,
    );
    // Both rows are scoped by testID so a label that appears in both (the
    // common case — the second row is the first minus columnA) is still
    // unambiguous to query.
    const colA = within(screen.getByTestId('cb-set-column-a'));
    expect(colA.getByText('Reps')).toBeTruthy();
    expect(colA.getByText('Weight (kg)')).toBeTruthy();
    expect(colA.getByText('Seconds')).toBeTruthy();
  });

  it('removes the chosen first column from the second column options', () => {
    render(
      <SetRows sets={newSetRows('ex1')} columnA="reps" columnB="weight_kg" onColumnChange={() => {}} onSetsChange={() => {}} />,
    );
    // "Reps" appears once only (first-column row) — the second-column row has
    // filtered it out via availableSecondColumns.
    expect(within(screen.getByTestId('cb-set-column-b')).queryByText('Reps')).toBeNull();
    expect(screen.getAllByText('Reps')).toHaveLength(1);
  });

  it('sends a typed value up through onSetsChange, keyed to the right row and column', () => {
    const sets = newSetRows('ex1');
    const onSetsChange = jest.fn();
    render(
      <SetRows sets={sets} columnA="reps" columnB="weight_kg" onColumnChange={() => {}} onSetsChange={onSetsChange} />,
    );
    const firstInput = screen.getByLabelText(`Set 1 reps`);
    fireEvent.changeText(firstInput, '8');
    expect(onSetsChange).toHaveBeenCalledTimes(1);
    const next: SetRow[] = onSetsChange.mock.calls[0][0];
    expect(next[0]).toMatchObject({ id: sets[0].id, a: '8', b: '' });
    expect(next[1]).toEqual(sets[1]);
    expect(next[2]).toEqual(sets[2]);
  });

  it('placeholders follow the chosen column type', () => {
    render(
      <SetRows sets={newSetRows('ex1')} columnA="seconds" columnB="meters" onColumnChange={() => {}} onSetsChange={() => {}} />,
    );
    expect(screen.getByLabelText('Set 1 sec')).toBeTruthy();
    expect(screen.getByLabelText('Set 1 m')).toBeTruthy();
  });

  it('locks the second column when the pair is invalid, ignoring taps on it', () => {
    // isColumnPairValid('reps','reps') is false; availableSecondColumns('reps')
    // has already excluded 'reps' itself, so tap a still-available chip and
    // confirm nothing reaches onColumnChange while locked.
    const onColumnChange = jest.fn();
    render(
      <SetRows sets={newSetRows('ex1')} columnA="reps" columnB="reps" onColumnChange={onColumnChange} onSetsChange={() => {}} />,
    );
    expect(screen.getByText('Two columns cannot measure the same thing — pick another for the second.')).toBeTruthy();
    // Press a still-available chip in the locked (second-column) row and
    // confirm the tap is swallowed rather than reaching onColumnChange.
    fireEvent.press(within(screen.getByTestId('cb-set-column-b')).getByText('Weight (kg)'));
    expect(onColumnChange).not.toHaveBeenCalled();
  });

  it('adds a set via the Add set control and removes one via its remove control', () => {
    const sets = newSetRows('ex1');
    const onSetsChange = jest.fn();
    render(
      <SetRows sets={sets} columnA="reps" columnB="weight_kg" onColumnChange={() => {}} onSetsChange={onSetsChange} />,
    );
    fireEvent.press(screen.getByLabelText('Add set'));
    expect(onSetsChange.mock.calls[0][0]).toHaveLength(4);

    fireEvent.press(screen.getByLabelText('Remove set 1'));
    expect(onSetsChange.mock.calls[1][0]).toHaveLength(2);
    expect(onSetsChange.mock.calls[1][0].map((s: SetRow) => s.id)).toEqual([sets[1].id, sets[2].id]);
  });
});
