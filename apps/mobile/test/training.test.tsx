/*
 * Training: starting a session.
 *
 * This file exists because of one specific near-miss. Memoising Training's
 * derivations put four `useMemo` calls BELOW the no-active-session early
 * return, so the hook count changed the instant a session started and React
 * would have thrown "rendered more hooks than during the previous render" —
 * mid-workout, on a screen the athlete had already committed to. `tsc` passed.
 * The engine tests passed. The bundle built. Only mounting the screen and
 * pressing Start finds it, so that is what this does.
 */
import { fireEvent, screen } from '@testing-library/react-native';
import { liftWorkout, renderScreen, seed } from './harness';
import { TrainingScreen } from '../src/screens/Training';

describe('Training', () => {
  it('offers a workout from the library when nothing is live', () => {
    seed({ workouts: [liftWorkout()] });
    renderScreen(<TrainingScreen />);
    expect(screen.getByText('Start a session')).toBeTruthy();
    expect(screen.getByText('Lower')).toBeTruthy();
  });

  it('starting a session does not change the hook count', () => {
    // The assertion is really "this did not throw". React's invalid-hook-order
    // error is raised during the re-render that Start triggers, so reaching the
    // in-progress screen at all IS the pass.
    seed({ workouts: [liftWorkout()] });
    renderScreen(<TrainingScreen />);

    fireEvent.press(screen.getByText('Start'));

    expect(screen.getByText('In progress')).toBeTruthy();
    expect(screen.getByText('Back squat')).toBeTruthy();
  });

  it('shows the session it resumes rather than the start list', () => {
    // A live session must survive a remount — the athlete backgrounds the app
    // between sets constantly, and coming back to "Start a session" would read
    // as the session having been lost.
    seed({ workouts: [liftWorkout()] });
    const first = renderScreen(<TrainingScreen />);
    fireEvent.press(screen.getByText('Start'));
    first.unmount();

    renderScreen(<TrainingScreen />);
    expect(screen.getByText('In progress')).toBeTruthy();
    expect(screen.queryByText('Start a session')).toBeNull();
  });

  it('renders an empty library without crashing', () => {
    seed({ workouts: [] });
    renderScreen(<TrainingScreen />);
    expect(screen.getByText('Start a session')).toBeTruthy();
  });
});
