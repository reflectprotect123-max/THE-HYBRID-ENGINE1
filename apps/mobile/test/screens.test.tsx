/*
 * The screens that went blank.
 *
 * Progress rendered nothing but its title after a single WHOOP sync: the
 * has-anything test counted one recovery reading as content while every chart
 * below refuses to draw from fewer than two points, so the empty state was
 * suppressed and no card qualified. There is no engine bug there at all — the
 * two thresholds simply disagreed — which is exactly why nothing caught it.
 *
 * A screen must always render SOMETHING. That is the rule these assert.
 */
import { Alert, type AlertButton } from 'react-native';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { useNavigation } from '@react-navigation/native';
import { liftSession, liftWorkout, renderScreen, runEffort, seed, volumeSession } from './harness';
import { ProgressScreen } from '../src/screens/Progress';
import { LibraryScreen } from '../src/screens/Library';
import { ExerciseScreen } from '../src/screens/Exercise';
import { DayScreen } from '../src/screens/Day';
import { CalendarScreen } from '../src/screens/Calendar';
import { HomeScreen } from '../src/screens/Home';
import { ymd, LS_KEY, type EngineDB, type Workout } from '@hybrid/engine';
import { storage } from '../src/store/storage';

const persisted = (): EngineDB => JSON.parse(storage.getItem(LS_KEY) || '{}');

/* Real navigation by default — every screen here mounts under `renderScreen`'s
   genuine NavigationContainer, exactly as it does in the app. Only the
   Duplicate test below swaps in a spy, to see where `nav.navigate` was told
   to go without needing a second real screen registered to land on. */
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: jest.fn(),
}));
const realUseNavigation = jest.requireActual('@react-navigation/native').useNavigation;
beforeEach(() => {
  (useNavigation as jest.Mock).mockImplementation(realUseNavigation);
});

/* Relative, never hardcoded: the recovery chart only reads the last 30 days,
   so fixed dates pass until they age out and then fail for a reason that has
   nothing to do with the code under test. */
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return ymd(d);
};

describe('Progress', () => {
  it('shows the empty state with nothing logged', () => {
    seed({});
    renderScreen(<ProgressScreen />);
    expect(screen.getByText('Not enough logged yet')).toBeTruthy();
  });

  it('still shows the empty state after exactly ONE WHOOP reading', () => {
    // The regression, precisely. One sync is enough to make `anything` true
    // while leaving every chart below its two-point minimum — title, then void.
    seed({ settings: { whoopDaily: [{ date: daysAgo(0), recovery: 62, strain: 9.1 }] } });
    renderScreen(<ProgressScreen />);
    expect(screen.getByText('Not enough logged yet')).toBeTruthy();
  });

  it('drops the empty state once a trend can actually be drawn', () => {
    seed({
      settings: {
        whoopDaily: [
          { date: daysAgo(1), recovery: 55, strain: 8 },
          { date: daysAgo(0), recovery: 62, strain: 9.1 },
        ],
      },
    });
    renderScreen(<ProgressScreen />);
    expect(screen.queryByText('Not enough logged yet')).toBeNull();
    expect(screen.getByText('Recovery · 30 days')).toBeTruthy();
  });

  it('does not fall over on a corrupt settings blob', () => {
    // `conditioning` arriving as a non-array is truthy, and spreading it throws
    // — taking the whole screen down rather than degrading to empty.
    seed({ settings: { conditioning: 'nonsense' as never, whoopDaily: 'nonsense' as never } });
    renderScreen(<ProgressScreen />);
    expect(screen.getByText('Not enough logged yet')).toBeTruthy();
  });
});

describe('Strength vs conditioning', () => {
  it('says nothing at all until both sides have something to compare', () => {
    // The card must be absent, not present-and-hedging. A readout that always
    // has an opinion is one you stop reading.
    seed({ sessions: [volumeSession(10, 4000)] });
    renderScreen(<ProgressScreen />);
    expect(screen.queryByText('Strength vs conditioning')).toBeNull();
  });

  it('surfaces the trade when conditioning climbs and the lifts do not', () => {
    // The whole point of the feature: 60 min/week became 150, squat and bench
    // have not moved, and no other screen in the app would have told you.
    seed({
      sessions: [
        liftSession(40, 'Back squat', 100),
        liftSession(40, 'Bench press', 80),
        liftSession(10, 'Back squat', 100),
        liftSession(10, 'Bench press', 80),
      ],
      settings: { conditioning: [runEffort(40, 30), runEffort(35, 30), runEffort(12, 75), runEffort(8, 75)] as never },
    });
    renderScreen(<ProgressScreen />);
    expect(screen.getByText('Conditioning up, lifts flat')).toBeTruthy();
    // And it must not overclaim: the caveat ships with the finding.
    expect(screen.getByText(/not one causing the other/)).toBeTruthy();
  });
});

describe('Weekly volume chart', () => {
  /*
   * The chart renders EIGHT buckets and the last one ends today, so it always
   * holds a part-finished week. Scaling from all eight let that stub set the
   * spread — 98% of the peak — which correctly told `barScale` there was
   * nothing to zoom into, and the chart stayed the flat wall it had always
   * been. The unit test for `barScale` passed the whole time because it used
   * seven complete weeks: the shape the app never actually renders.
   */
  /* Bucket i spans days [i*7+6 … i*7] back from today, so bucket 0 is days 0–6
     — the week in progress — and the mid-bucket days below put exactly one
     session in each of the eight. Miss that and a bucket silently reads 0,
     which changes the answer for an unrelated reason. */
  const EIGHT_WEEKS = [
    volumeSession(52, 6100),
    volumeSession(45, 6200),
    volumeSession(38, 6050),
    volumeSession(31, 6300),
    volumeSession(24, 6180),
    volumeSession(17, 6400),
    volumeSession(10, 6548),
    // this week, two days in
    volumeSession(1, 120),
  ];

  it('scales from the complete weeks, not the one still being trained', () => {
    seed({ sessions: EIGHT_WEEKS });
    renderScreen(<ProgressScreen />);
    // Floating: the footer names the floor. Were the 120kg stub still setting
    // the scale this would read "peak 6,548kg" and every bar would be full.
    expect(screen.getByText(/axis starts at/)).toBeTruthy();
  });

  it('says which bar is the unfinished week, since a truncated axis exaggerates', () => {
    seed({ sessions: EIGHT_WEEKS });
    renderScreen(<ProgressScreen />);
    expect(screen.getByText(/outlined bar is this week so far/)).toBeTruthy();
  });

  it('keeps the zero baseline when the complete weeks really do vary', () => {
    seed({
      sessions: [
        volumeSession(52, 1000),
        volumeSession(45, 3000),
        volumeSession(38, 5000),
        volumeSession(31, 7000),
        volumeSession(24, 9000),
        volumeSession(17, 6000),
        volumeSession(10, 8000),
        volumeSession(1, 120),
      ],
    });
    renderScreen(<ProgressScreen />);
    expect(screen.queryByText(/axis starts at/)).toBeNull();
    expect(screen.getByText(/peak 9,000kg/)).toBeTruthy();
  });
});

describe('Library', () => {
  it('names the button that exists in its empty state', () => {
    // It used to say "or import one you already have written down" — pointing
    // at a feature that had been removed.
    seed({ workouts: [] });
    renderScreen(<LibraryScreen />);
    expect(screen.getByText('Nothing here yet')).toBeTruthy();
    expect(screen.queryByText(/import/i)).toBeNull();
  });

  it('lists a session with a delete control on the row itself', () => {
    // Delete used to appear only once the card had been expanded, which is not
    // anywhere anyone looks for it.
    seed({ workouts: [liftWorkout()] });
    renderScreen(<LibraryScreen />);
    expect(screen.getByText('Lower')).toBeTruthy();
    expect(screen.getByLabelText('delete Lower')).toBeTruthy();
  });

  it('says nothing about history or opening weight for an untrained session', () => {
    // Suppressed rather than rendered blank: "last trained never · opens at"
    // reads as a bug.
    seed({ workouts: [liftWorkout()] });
    renderScreen(<LibraryScreen />);
    expect(screen.queryByText(/opens at/)).toBeNull();
    expect(screen.queryByText(/times/)).toBeNull();
  });

  it('duplicates a session onto Planner with a fresh id, not the original', () => {
    // Planner, never GuidedBuilder — GuidedBuilder is append-only and cannot
    // open pre-populated with the original's content.
    const w = liftWorkout('Lower');
    seed({ workouts: [w] });
    const navigate = jest.fn();
    (useNavigation as jest.Mock).mockReturnValue({ navigate });

    renderScreen(<LibraryScreen />);
    fireEvent.press(screen.getByLabelText('expand Lower'));
    fireEvent.press(screen.getByLabelText('duplicate Lower'));

    expect(navigate).toHaveBeenCalledTimes(1);
    const [screenName, params] = navigate.mock.calls[0];
    expect(screenName).toBe('Planner');
    expect(params.id).toEqual(expect.any(String));
    expect(params.id).not.toBe(w.id);
  });
});

describe('Exercise history', () => {
  /*
   * The screen `exLogFor` was written for. It had no caller anywhere for
   * months, so nothing would have noticed if the engine's shape drifted from
   * what a screen needs — these are the first assertions that the two agree.
   */
  const SQUATS = [
    liftSession(60, 'Back squat', 100),
    liftSession(40, 'Back squat', 105),
    liftSession(20, 'Back squat', 110),
  ];

  it('charts a movement across its sessions', () => {
    seed({ sessions: SQUATS });
    renderScreen(<ExerciseScreen />, { name: 'Back squat' });
    expect(screen.getByText('Estimated 1RM · 3 sessions')).toBeTruthy();
    // 110kg × 5 by Epley is 128kg, and it must be the best of the three. It
    // appears in the bests card, the trend footer and the session row, so the
    // assertion is on the labelled pair rather than the bare number.
    expect(screen.getByText('Best estimated 1RM')).toBeTruthy();
    expect(screen.getAllByText('128kg').length).toBeGreaterThan(0);
    expect(screen.getByText('Heaviest set')).toBeTruthy();
    expect(screen.getByText('for 5 reps')).toBeTruthy();
  });

  it('refuses to draw a trend from one session', () => {
    // A line through a single point implies a direction it cannot know.
    seed({ sessions: [liftSession(10, 'Back squat', 100)] });
    renderScreen(<ExerciseScreen />, { name: 'Back squat' });
    expect(screen.getByText(/One session is a point, not a trend/)).toBeTruthy();
  });

  it('says so for a movement with nothing logged', () => {
    seed({ sessions: SQUATS });
    renderScreen(<ExerciseScreen />, { name: 'Zercher squat' });
    expect(screen.getByText('Nothing logged for this one yet')).toBeTruthy();
  });

  it('renders the picker with no movement chosen', () => {
    seed({ sessions: SQUATS });
    renderScreen(<ExerciseScreen />, {});
    expect(screen.getByText('Pick a movement')).toBeTruthy();
  });
});

describe('Day preview', () => {
  /*
   * Mirrors web's react-smoke scenarios for `apps/web/src/screens/Day.tsx`
   * (`checks/react-smoke.mjs`, "Day preview shows..."): an empty day and a
   * scheduled one, read-only. Reached directly by `date` — Task 5 wires the
   * actual Calendar/Home tap-through, this pins the screen's own two states
   * in isolation, same split web's smoke suite uses.
   *
   * Only `date` is passed as a route param here, never `workoutId` — see
   * Day.tsx's own doc comment for why this screen re-derives the matched
   * workout from `db.workouts` instead of trusting an id through navigation.
   */
  it('shows "Nothing scheduled" for a day with nothing planned', () => {
    seed({ workouts: [] });
    renderScreen(<DayScreen />, { date: '2030-06-15' });
    expect(screen.getByText('Nothing scheduled')).toBeTruthy();
    expect(screen.getByText('Nothing scheduled for this day.')).toBeTruthy();
    expect(screen.queryByText('Back squat')).toBeNull();
    // The date heading must format, not fall through to the raw route param.
    expect(screen.queryByText('2030-06-15')).toBeNull();
  });

  it('shows the matched workout for a scheduled day, read-only', () => {
    // liftWorkout()'s workout name is always 'Lower'; its first arg names the
    // EXERCISE ('Back squat' by default) — see harness.tsx.
    const w = { ...liftWorkout(), dates: ['2030-06-15'] };
    seed({ workouts: [w] });
    renderScreen(<DayScreen />, { date: '2030-06-15' });
    expect(screen.getByText('Lower')).toBeTruthy();
    expect(screen.getByText('Back squat')).toBeTruthy();
    expect(screen.queryByText('Nothing scheduled')).toBeNull();
    // Read-only: no Start/Edit/Delete/Duplicate control — those are
    // Library/Training's job, not this preview's.
    expect(screen.queryByText('Start')).toBeNull();
    expect(screen.queryByText('Edit')).toBeNull();
    expect(screen.queryByText('Duplicate')).toBeNull();
    expect(screen.queryByLabelText(/^delete /)).toBeNull();
  });
});

describe('Calendar day-cell tap', () => {
  /*
   * Task 5: each day cell now resolves through `resolveDayTarget` instead of
   * sitting there as a bare box — a completed day lands on its Recap, today
   * lands on Training, and anything else lands on the read-only Day preview.
   */

  /** A date `n` days from today that stays inside the CURRENT calendar month
   *  — CalendarScreen opens on the current month and none of these tests page
   *  it, so the tapped cell has to actually be on screen. Every month has at
   *  least 28 days, so any offset up to ~13 always lands on a real day of it. */
  function sameMonthOffset(n: number): Date {
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const day = now.getDate();
    const candidate = day + n <= lastDay ? day + n : day - n;
    return new Date(now.getFullYear(), now.getMonth(), candidate);
  }

  /* Matches the accessibilityLabel CalendarScreen puts on each cell exactly,
     so the tap lands on the specific day under test rather than any day
     sharing its number.

     The label carries the day's STATE as well as its date, because an
     accessibility label replaces everything inside the Tap — the trained and
     planned dots are invisible to VoiceOver unless the distinction is spoken
     as part of the name. Callers that seed nothing pass no state and get the
     bare date, which is what those cells are actually named. */
  const cellLabel = (d: Date, state: '' | ', trained' | ', planned' = '') =>
    d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) + state;

  it("tapping a trained day lands on that day's Recap, not a generic Calendar view", () => {
    const trained = liftSession(0, 'Back squat', 100);
    const date = sameMonthOffset(6);
    trained.date = ymd(date); // liftSession dates itself off "today" — retarget it
    seed({ sessions: [trained] });
    const navigate = jest.fn();
    (useNavigation as jest.Mock).mockReturnValue({ navigate });

    renderScreen(<CalendarScreen />);
    fireEvent.press(screen.getByLabelText(cellLabel(date, ', trained')));

    expect(navigate).toHaveBeenCalledWith('Recap', { id: trained.id });
  });

  it('names a planned day as planned, so the dot is not the only way to know', () => {
    // The dots are a visual difference only; the label is the whole of what a
    // screen reader gets. A day with a workout scheduled on it must say so.
    const date = sameMonthOffset(9);
    seed({ workouts: [{ ...liftWorkout(), dates: [ymd(date)] }], sessions: [] });
    (useNavigation as jest.Mock).mockReturnValue({ navigate: jest.fn() });

    renderScreen(<CalendarScreen />);
    expect(screen.getByLabelText(cellLabel(date, ', planned'))).toBeTruthy();
    // ...and a day with nothing on it stays a plain date, not "planned".
    expect(screen.getByLabelText(cellLabel(sameMonthOffset(10)))).toBeTruthy();
  });

  it('tapping today lands on Training, when nothing is logged yet', () => {
    seed({ workouts: [], sessions: [] });
    const navigate = jest.fn();
    (useNavigation as jest.Mock).mockReturnValue({ navigate });

    renderScreen(<CalendarScreen />);
    fireEvent.press(screen.getByLabelText(cellLabel(new Date())));

    // A tab switch, not a stack push — mirrors Home's own toTraining, the
    // only other place the app sends someone to "go train right now".
    expect(navigate).toHaveBeenCalledWith('Tabs', { screen: 'Train' });
  });

  it('tapping an empty, untrained day lands on the Day preview for that date', () => {
    seed({ workouts: [], sessions: [] });
    const navigate = jest.fn();
    (useNavigation as jest.Mock).mockReturnValue({ navigate });
    const date = sameMonthOffset(13);

    renderScreen(<CalendarScreen />);
    fireEvent.press(screen.getByLabelText(cellLabel(date)));

    // No workoutId in the params — Task 4's Day screen re-derives the match
    // from db.workouts itself rather than trusting an id through navigation.
    expect(navigate).toHaveBeenCalledWith('Day', { date: ymd(date) });
  });
});

describe("Home's week strip tap", () => {
  /*
   * Task 6: WeekStrip gives each day of the CURRENT week its own resolved
   * target too, wired through the same `resolveDayTarget` Calendar's day
   * cells use (Task 5). This is the crux of the ORIGINAL bug report: tapping
   * a trained day here used to always open the generic Calendar month view
   * instead of landing on that day directly.
   */

  /** A date at one end of the current Sun–Sat week that is never today — the
   *  Saturday if today isn't Saturday, otherwise the Sunday. WeekStrip only
   *  renders the current week, so (unlike Calendar's `sameMonthOffset`) an
   *  arbitrary fixed offset near either edge would fall outside it. */
  function weekEndDate(): Date {
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - start.getDay());
    const targetDow = now.getDay() === 6 ? 0 : 6;
    const d = new Date(start);
    d.setDate(start.getDate() + targetDow);
    return d;
  }

  /* Matches the accessibilityLabel WeekStrip puts on each day exactly, same
     shape as Calendar's cellLabel above — the trained/planned state has to be
     spoken as part of the name since it replaces the dot for VoiceOver. */
  const cellLabel = (d: Date, state: '' | ', trained' | ', planned' = '') =>
    d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) + state;

  it("tapping a trained day lands on that day's Recap, not a generic Calendar view", () => {
    const date = weekEndDate();
    const trained = liftSession(0, 'Back squat', 100);
    trained.date = ymd(date); // liftSession dates itself off "today" — retarget it
    seed({ sessions: [trained] });
    const navigate = jest.fn();
    (useNavigation as jest.Mock).mockReturnValue({ navigate });

    renderScreen(<HomeScreen />);
    fireEvent.press(screen.getByLabelText(cellLabel(date, ', trained')));

    expect(navigate).toHaveBeenCalledWith('Recap', { id: trained.id });
  });

  it('tapping today lands on the Train tab, when nothing is logged yet', () => {
    seed({ workouts: [], sessions: [] });
    const navigate = jest.fn();
    (useNavigation as jest.Mock).mockReturnValue({ navigate });

    renderScreen(<HomeScreen />);
    fireEvent.press(screen.getByLabelText(cellLabel(new Date())));

    // A tab switch, not a stack push — the exact `toTraining` HomeScreen's
    // own CTAs already use, not a re-derived path of its own.
    expect(navigate).toHaveBeenCalledWith('Tabs', { screen: 'Train' });
  });

  it('tapping an untrained day in the week lands on the Day preview for that date', () => {
    seed({ workouts: [], sessions: [] });
    const navigate = jest.fn();
    (useNavigation as jest.Mock).mockReturnValue({ navigate });
    const date = weekEndDate();

    renderScreen(<HomeScreen />);
    fireEvent.press(screen.getByLabelText(cellLabel(date)));

    // No workoutId in the params — same as Calendar, Day re-derives the
    // match from db.workouts itself rather than trusting an id through nav.
    expect(navigate).toHaveBeenCalledWith('Day', { date: ymd(date) });
  });
});

describe("Home's Today's plan delete", () => {
  it('tombstones the workout and drops its card, same contract as Library delete', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const w: Workout = { id: 'home-del-1', name: 'Home Delete Target', updatedAt: 1, blocks: [], dates: [ymd(new Date())] };
    seed({ workouts: [w] });

    renderScreen(<HomeScreen />);
    fireEvent.press(screen.getByLabelText('delete Home Delete Target'));

    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [title, , buttons] = alertSpy.mock.calls[0] as [string, string, AlertButton[]];
    expect(title).toBe('Delete "Home Delete Target"?');
    const del = buttons.find((b) => b.text === 'Delete');
    act(() => del!.onPress!());

    expect(screen.queryByText('Home Delete Target')).toBeNull();
    // The store debounces its write — same 500ms flush every other test here
    // that reads persisted() back uses (see conditioning.test.tsx/logger.test.tsx).
    act(() => jest.advanceTimersByTime(500));
    const db = persisted();
    expect(db.workouts.some((x) => x.id === 'home-del-1')).toBe(false);
    expect(db.settings.deletedIds?.['home-del-1']).toBeTruthy();
  });
});

describe('Library tabs', () => {
  const DB = {
    workouts: [liftWorkout()],
    sessions: [liftSession(10, 'Back squat', 100)],
    settings: { mobility: ['World’s Greatest Stretch', 'Parasympathetic Breathing'] as never },
  };

  it('opens on Sessions, not on a list of 448 movements', () => {
    seed(DB);
    renderScreen(<LibraryScreen />);
    expect(screen.getByText('Lower')).toBeTruthy();
    expect(screen.queryByText('Parasympathetic Breathing')).toBeNull();
  });

  it('switches to mobility and lists it', () => {
    seed(DB);
    renderScreen(<LibraryScreen />);
    fireEvent.press(screen.getByLabelText('Mobility, 2'));
    expect(screen.getByText('Parasympathetic Breathing')).toBeTruthy();
    // And the sessions are gone — it is a slice, not an append.
    expect(screen.queryByText('Lower')).toBeNull();
  });

  it('counts each tab so an empty one is visible before it is opened', () => {
    seed({ workouts: [], sessions: [], settings: {} });
    renderScreen(<LibraryScreen />);
    expect(screen.getByLabelText('Mobility, 0')).toBeTruthy();
  });
});

describe('Library folders', () => {
  it('groups a workout under its folder, collapsed by default, and lists an ungrouped one flat', () => {
    seed({
      settings: { folders: [{ id: 'folder-1', name: 'Week 1' }] },
      workouts: [
        { id: 'grouped-1', name: 'Grouped Session', updatedAt: 1, blocks: [], folderIds: ['folder-1'] },
        { id: 'loose-1', name: 'Loose Session', updatedAt: 1, blocks: [] },
      ],
    });
    renderScreen(<LibraryScreen />);

    expect(screen.getByText('Loose Session')).toBeTruthy();
    expect(screen.queryByText('Grouped Session')).toBeNull();
    expect(screen.getByText('Week 1')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('expand Week 1 folder'));
    expect(screen.getByText('Grouped Session')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('collapse Week 1 folder'));
    expect(screen.queryByText('Grouped Session')).toBeNull();
  });

  it('creates, renames, and deletes a folder — the workout survives, ungrouped', () => {
    seed({ workouts: [{ id: 'cru-1', name: 'Folder CRUD Target', updatedAt: 1, blocks: [], folderIds: [] }] });
    renderScreen(<LibraryScreen />);

    fireEvent.press(screen.getByText('+ New folder'));
    fireEvent.changeText(screen.getByLabelText('New folder name'), 'Test Folder');
    fireEvent.press(screen.getByText('Add'));
    expect(screen.getByText('Test Folder')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('rename Test Folder'));
    fireEvent.changeText(screen.getByLabelText('New folder name'), 'Renamed Folder');
    fireEvent.press(screen.getByText('Add'));
    expect(screen.getByText('Renamed Folder')).toBeTruthy();

    // `jest.spyOn` on an already-mocked method (Alert.alert was spied by an
    // earlier test in this file and never restored) returns that SAME mock
    // rather than a fresh one, so its call history carries over — clear it
    // here so `mock.calls[0]` below is this press, not a leftover one.
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    alertSpy.mockClear();
    fireEvent.press(screen.getByLabelText('delete folder Renamed Folder'));
    const [, , buttons] = alertSpy.mock.calls[0] as [string, string, AlertButton[]];
    act(() => buttons.find((b) => b.text === 'Delete')!.onPress!());

    expect(screen.queryByText('Renamed Folder')).toBeNull();
    expect(screen.getByText('Folder CRUD Target')).toBeTruthy();
  });
});
