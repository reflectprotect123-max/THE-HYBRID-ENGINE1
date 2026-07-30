/*
 * The guided builder: mounting it against a seeded store and driving the
 * whole flow for real, the same way training.test.tsx mounts Training.
 */
import { fireEvent, screen } from '@testing-library/react-native';
import { renderScreen, seed } from './harness';
import { GuidedBuilderScreen } from '../src/screens/guided/GuidedBuilder';

describe('GuidedBuilderScreen', () => {
  it('builds a lift block end to end and lands on "add another?"', () => {
    const w = { id: 'w1', name: 'New session', blocks: [], updatedAt: Date.now() };
    seed({ workouts: [w] });
    renderScreen(<GuidedBuilderScreen />, { id: 'w1' });

    fireEvent.press(screen.getByText('🏋 Lift'));
    expect(screen.getByText('Which movement?')).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText('movement name'), 'Back Squat');
    fireEvent.press(screen.getByText('Next'));
    expect(screen.getByText('How many sets?')).toBeTruthy();

    fireEvent.press(screen.getByText('Next'));
    expect(screen.getByText('How many reps?')).toBeTruthy();

    fireEvent.press(screen.getByText('8'));
    fireEvent.press(screen.getByText('Next'));
    expect(screen.getByText('How hard should it feel?')).toBeTruthy();

    fireEvent.press(screen.getByText('RPE 8'));
    fireEvent.press(screen.getByText('Next'));

    expect(screen.getByText('Yes, add another')).toBeTruthy();
    expect(screen.getByText('Back Squat added')).toBeTruthy();
  });
});
