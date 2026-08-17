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
import { ymd, type Session } from '@hybrid/engine';
import { setDiscipline } from '../discipline';
import { textWorkout, renderScreen, seed } from '../../test/harness';
import { TrainingScreen } from './Training';

describe('Training', () => {
  it('offers a workout from the library when nothing is live', () => {
    seed({ workouts: [textWorkout()] });
    renderScreen(<TrainingScreen />);
    expect(screen.getByText('Start a session')).toBeTruthy();
    expect(screen.getByText('Lower')).toBeTruthy();
  });

  it('starting a session does not change the hook count', () => {
    // The assertion is really "this did not throw". React's invalid-hook-order
    // error is raised during the re-render that Start triggers, so reaching the
    // in-progress screen at all IS the pass.
    seed({ workouts: [textWorkout()] });
    renderScreen(<TrainingScreen />);

    fireEvent.press(screen.getByText('Start'));

    expect(screen.getByText('In progress')).toBeTruthy();
    expect(screen.getByText('Metcon')).toBeTruthy();
  });

  it('shows the session it resumes rather than the start list', () => {
    // A live session must survive a remount — the athlete backgrounds the app
    // between sets constantly, and coming back to "Start a session" would read
    // as the session having been lost.
    seed({ workouts: [textWorkout()] });
    const first = renderScreen(<TrainingScreen />);
    fireEvent.press(screen.getByText('Start'));
    first.unmount();

    renderScreen(<TrainingScreen />);
    expect(screen.getByText('In progress')).toBeTruthy();
    expect(screen.queryByText('Start a session')).toBeNull();
  });

  it('does not put the brass on Finish while there is work left', () => {
    // At 0 of 1 the loudest control on the screen used to be the one action you
    // should not take yet. The label is the observable half of that: the button
    // stays available and says what finishing now would mean.
    seed({ workouts: [textWorkout()] });
    renderScreen(<TrainingScreen />);
    fireEvent.press(screen.getByText('Start'));

    expect(screen.getByText('Finish session early')).toBeTruthy();
    expect(screen.queryByText('Finish session')).toBeNull();
  });

  it('renders an empty library without crashing', () => {
    seed({ workouts: [] });
    renderScreen(<TrainingScreen />);
    expect(screen.getByText('Start a session')).toBeTruthy();
  });

  it('shows an honest empty state when nothing is scheduled today, with the rest of the library still reachable', () => {
    // Nobody today, but the library is not empty — a silent list of everything
    // used to read as "these are all scheduled for today", which they are not.
    seed({ workouts: [textWorkout()] });
    renderScreen(<TrainingScreen />);
    expect(screen.getByText('Nothing scheduled for today')).toBeTruthy();
    expect(screen.getByText('Everything else')).toBeTruthy();
    expect(screen.getByText('Lower')).toBeTruthy();
  });
});

describe('Training — a session live in the OTHER world', () => {
  /*
   * The dead end this covers, reported from a real phone on 14 August 2026.
   *
   * `start()` refuses when ANY session is active, but this screen only lists
   * the current world's. So a conditioning session left running made every
   * Start button on the strength Training screen do nothing whatsoever — no
   * session, no message, no visible change. The athlete's next move is the
   * logger, which says "No live session. Start one from Training", sending
   * them back to the button that had just silently refused them. A loop with
   * no exit and no explanation anywhere in it.
   */
  const liveConditioning = (): Session => ({
    id: 'cond-live',
    kind: 'conditioning',
    date: ymd(new Date()),
    name: 'Intervals',
    status: 'active',
    blocks: [],
    startedAt: Date.now(),
    updatedAt: Date.now(),
  });

  it('says so, rather than leaving Start silently inert', () => {
    setDiscipline('strength');
    seed({ workouts: [textWorkout()], sessions: [liveConditioning()] });
    renderScreen(<TrainingScreen />);

    /* The screen is still the start list — the conditioning session is not in
       this world and must not be rendered as if it were. */
    expect(screen.getByText('Start a session')).toBeTruthy();
    /* …but the refusal about to happen is now VISIBLE, with a way to it. */
    expect(screen.getByText('Session in progress in Conditioning')).toBeTruthy();
  });

  it('the notice is absent when nothing is live elsewhere', () => {
    /* Otherwise the test above would pass on a component that always renders
       the banner, which would be its own lie. */
    setDiscipline('strength');
    seed({ workouts: [textWorkout()] });
    renderScreen(<TrainingScreen />);

    expect(screen.queryByText(/Session in progress in/)).toBeNull();
  });
});
