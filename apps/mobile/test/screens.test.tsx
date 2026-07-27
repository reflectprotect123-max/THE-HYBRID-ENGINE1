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
import { screen } from '@testing-library/react-native';
import { liftWorkout, renderScreen, seed, volumeSession } from './harness';
import { ProgressScreen } from '../src/screens/Progress';
import { LibraryScreen } from '../src/screens/Library';

describe('Progress', () => {
  it('shows the empty state with nothing logged', () => {
    seed({});
    renderScreen(<ProgressScreen />);
    expect(screen.getByText('Not enough logged yet')).toBeTruthy();
  });

  it('still shows the empty state after exactly ONE WHOOP reading', () => {
    // The regression, precisely. One sync is enough to make `anything` true
    // while leaving every chart below its two-point minimum — title, then void.
    seed({ settings: { whoopDaily: [{ date: '2026-07-27', recovery: 62, strain: 9.1 }] } });
    renderScreen(<ProgressScreen />);
    expect(screen.getByText('Not enough logged yet')).toBeTruthy();
  });

  it('drops the empty state once a trend can actually be drawn', () => {
    seed({
      settings: {
        whoopDaily: [
          { date: '2026-07-26', recovery: 55, strain: 8 },
          { date: '2026-07-27', recovery: 62, strain: 9.1 },
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
});
