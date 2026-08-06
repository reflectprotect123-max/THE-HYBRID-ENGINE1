import { fireEvent, screen } from '@testing-library/react-native';
import { newBlock, newEx, uid, type Workout } from '@hybrid/engine';
import { renderScreen, seed } from './harness';
import { PlannerScreen } from '../src/screens/Planner';

function benchWorkout(): Workout {
  const ex = {
    ...newEx(),
    id: uid(),
    name: 'Bench press',
    sets: [
      { t: 'W10', rpe: '' },
      { t: '5', rpe: '8' },
      { t: '5', rpe: '9' },
    ],
  };
  const block = { ...newBlock(), id: uid(), heading: 'Main', exercises: [ex] };
  return { id: uid(), name: 'Push', blocks: [block], updatedAt: Date.now() };
}

describe('Planner — pct1rm mode selector', () => {
  it('writes a % range onto every rated set and shows the ramped badge, then clears on Reps', () => {
    const w = benchWorkout();
    seed({ workouts: [w] });
    renderScreen(<PlannerScreen />, { id: w.id });

    // PlannerScreen's `openEx` defaults to '0-0' — the seeded workout has one
    // block and one exercise, so the card is already open; no click needed
    // (same fix as Task 4's web smoke scenario for the same reason).
    fireEvent.press(screen.getByLabelText('% range + reps'));

    fireEvent.changeText(screen.getByLabelText('percent low'), '60');
    fireEvent.changeText(screen.getByLabelText('percent high'), '65');

    expect(screen.getByLabelText('percent of 1RM for set 2').props.children).toBe('60%');
    expect(screen.getByLabelText('percent of 1RM for set 3').props.children).toBe('65%');

    fireEvent.press(screen.getByLabelText('Reps'));
    expect(screen.queryByLabelText('percent of 1RM for set 2')).toBeNull();
  });
});
