// Jest injects describe/it/expect as globals — see the sibling tests, none
// of which import a runner.
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { CatalogueEntry } from '@hybrid/engine';
import { ExercisePicker } from './ExercisePicker';

const ENTRIES: CatalogueEntry[] = [
  { name: 'Back Squat', tags: ['Barbell'], uses: 4 },
  { name: 'Push-up', tags: ['Bodyweight'], uses: 2 },
  { name: 'Row Erg', tags: ['Conditioning'], uses: 6 },
];

function setup(overrides: Partial<Parameters<typeof ExercisePicker>[0]> = {}) {
  const onPick = jest.fn();
  const onNewExercise = jest.fn();
  const onDone = jest.fn();
  render(
    <ExercisePicker
      entries={ENTRIES}
      onPick={onPick}
      onNewExercise={onNewExercise}
      onDone={onDone}
      {...overrides}
    />,
  );
  return { onPick, onNewExercise, onDone };
}

describe('ExercisePicker', () => {
  it('narrows the list by search', () => {
    setup();
    expect(screen.getByLabelText('Add Back Squat')).toBeTruthy();
    expect(screen.getByLabelText('Add Push-up')).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText('Search the exercise library'), 'squat');

    expect(screen.getByLabelText('Add Back Squat')).toBeTruthy();
    expect(screen.queryByLabelText('Add Push-up')).toBeNull();
    expect(screen.queryByLabelText('Add Row Erg')).toBeNull();
  });

  it('narrows the list by a tag filter, with live counts', () => {
    setup();
    // Counts are over the full catalogue, not the filtered view.
    expect(screen.getByText('Barbell 1')).toBeTruthy();
    expect(screen.getByText('Bodyweight 1')).toBeTruthy();
    expect(screen.getByText('Conditioning 1')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Bodyweight'));

    expect(screen.getByLabelText('Add Push-up')).toBeTruthy();
    expect(screen.queryByLabelText('Add Back Squat')).toBeNull();
    expect(screen.queryByLabelText('Add Row Erg')).toBeNull();

    // The chip counts still read against the full library, untouched by the
    // filter that is currently narrowing the list below them.
    expect(screen.getByText('Barbell 1')).toBeTruthy();
  });

  it('calls onPick with the movement name', () => {
    const { onPick } = setup();
    fireEvent.press(screen.getByLabelText('Add Row Erg'));
    expect(onPick).toHaveBeenCalledWith('Row Erg');
  });

  it('shows an honest empty state when filters exclude everything', () => {
    setup();
    fireEvent.changeText(screen.getByLabelText('Search the exercise library'), 'nonexistent movement');
    expect(screen.getByText('No exercises match those filters.')).toBeTruthy();
  });

  it('shows a different empty state when the library itself is empty', () => {
    setup({ entries: [] });
    expect(
      screen.getByText('No movements in your library yet — they appear here as you author sessions.'),
    ).toBeTruthy();
  });

  it('passes the trimmed search text to onNewExercise', () => {
    const { onNewExercise } = setup();
    fireEvent.changeText(screen.getByLabelText('Search the exercise library'), '  Nordic Curl  ');
    fireEvent.press(screen.getByText('+ New exercise'));
    expect(onNewExercise).toHaveBeenCalledWith('Nordic Curl');
  });

  it('calls onDone', () => {
    const { onDone } = setup();
    fireEvent.press(screen.getByText('Done'));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
