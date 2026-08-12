/* No test-runner import: this app runs JEST, where describe/it/expect are
   globals. */
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { Workout } from '@hybrid/engine';
import { SessionPicker } from './SessionPicker';

function workout(over: Partial<Workout> = {}): Workout {
  return {
    id: 'w1',
    name: 'Heavy Squat A',
    kind: 'strength',
    blocks: [{ id: 'b0', heading: 'Strength/Power', exercises: [] }],
    ...over,
  } as Workout;
}

describe('SessionPicker', () => {
  it('lists the coach’s authored sessions with their summary line', () => {
    render(
      <SessionPicker
        workouts={[workout({ id: 'a', name: 'Heavy Squat A' })]}
        onPick={() => {}}
        onCreateInstead={() => {}}
      />,
    );
    expect(screen.getByText('Heavy Squat A')).toBeTruthy();
    expect(screen.getByText('1 block · strength')).toBeTruthy();
  });

  it('picking a session calls onPick with its id', () => {
    const onPick = jest.fn();
    render(
      <SessionPicker
        workouts={[workout({ id: 'a', name: 'Heavy Squat A' })]}
        onPick={onPick}
        onCreateInstead={() => {}}
      />,
    );
    fireEvent.press(screen.getByText('Heavy Squat A'));
    expect(onPick).toHaveBeenCalledWith('a');
  });

  it('shows an honest empty state when the coach has written nothing yet, with a way forward', () => {
    const onCreateInstead = jest.fn();
    render(<SessionPicker workouts={[]} onPick={() => {}} onCreateInstead={onCreateInstead} />);
    expect(screen.getByText('You have not written any sessions yet')).toBeTruthy();
    fireEvent.press(screen.getByText('Build this day from scratch'));
    expect(onCreateInstead).toHaveBeenCalledTimes(1);
  });

  it('shows a distinct "nothing matches" state, not the same as having no sessions', () => {
    render(
      <SessionPicker
        workouts={[workout({ id: 'a', name: 'Heavy Squat A' })]}
        onPick={() => {}}
        onCreateInstead={() => {}}
      />,
    );
    // The no-sessions empty state must not appear once there IS a session.
    expect(screen.queryByText('You have not written any sessions yet')).toBeNull();

    fireEvent.changeText(screen.getByLabelText('Search sessions'), 'deadlift');
    expect(screen.getByText('No session matches "deadlift".')).toBeTruthy();
    expect(screen.queryByText('Heavy Squat A')).toBeNull();
  });

  it('offers "build this day from scratch instead" beside a non-empty list too', () => {
    const onCreateInstead = jest.fn();
    render(
      <SessionPicker
        workouts={[workout({ id: 'a', name: 'Heavy Squat A' })]}
        onPick={() => {}}
        onCreateInstead={onCreateInstead}
      />,
    );
    fireEvent.press(screen.getByText('Build this day from scratch instead'));
    expect(onCreateInstead).toHaveBeenCalledTimes(1);
  });
});
