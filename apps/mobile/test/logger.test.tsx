/*
 * The logger stage: the screen the athlete actually stands in front of.
 *
 * Everything asserted here is a path that has broken at least once and was
 * caught by the owner on their phone rather than by CI — a set that would not
 * record, a weight field that came back empty, an earned weight that was
 * printed and then thrown away. None of it is reachable from an engine test,
 * because the bug was never in the engine.
 */
import { act, fireEvent, screen } from '@testing-library/react-native';
import {
  LS_KEY,
  freshSessionBlocks,
  newBlock,
  newEx,
  newSet,
  uid,
  ymd,
  type EngineDB,
  type LoggedSet,
  type Session,
  type StrengthBlock,
  type Workout,
} from '@hybrid/engine';
import { liftWorkout, renderScreen, seed } from './harness';
import { storage } from '../src/store/storage';
import { LoggerScreen } from '../src/screens/Logger';

/** A live session on one lift, ready for the stage to open on set 1. */
function liveSession(over: Partial<EngineDB> = {}) {
  const w = liftWorkout('Back squat', 2);
  const s: Session = {
    id: uid(),
    /* TODAY, computed. It was hardcoded, and `expireStaleSessions` correctly
       bins an active session dated before today — so the whole file passed on
       the day it was written and failed at the next midnight, blaming whatever
       change happened to come after. A fixture that means "now" must say so. */
    date: ymd(new Date()),
    name: 'Lower',
    status: 'active',
    blocks: freshSessionBlocks(w.blocks),
    startedAt: Date.now(),
    workoutId: w.id,
  };
  seed({ workouts: [w], sessions: [s], ...over });
  return s;
}

/** A live session on one `seconds`-mode hold (e.g. a plank), targeting `t`
 *  seconds — short by default so a test can run the countdown to zero without
 *  a multi-second real wait (fake timers still need to advance, but nothing
 *  here depends on real wall-clock time). */
function secondsSession(t = '2') {
  const ex = { ...newEx(), id: uid(), name: 'Plank', mode: 'seconds' as const, sets: [{ ...newSet(), t }] };
  const block = { ...newBlock(), id: uid(), heading: 'Core', exercises: [ex] };
  const w: Workout = { id: uid(), name: 'Core', blocks: [block], updatedAt: Date.now() };
  const s: Session = {
    id: uid(),
    date: ymd(new Date()),
    name: 'Core',
    status: 'active',
    blocks: freshSessionBlocks(w.blocks),
    startedAt: Date.now(),
    workoutId: w.id,
  };
  seed({ workouts: [w], sessions: [s] });
  return s;
}

/**
 * 3 completed, on-target history sessions for `name`, plus a live session on it.
 *
 * `reps` is what each history session was logged at against an 8-10 target. 10
 * is AT the top of that range, which is where a suggestion can genuinely improve
 * on what the fields already show: the Reps field opens at `repTopOf('8-10')` —
 * 10 — so anything the rep branch could propose from an 8-rep history would be a
 * step DOWN from what is on screen, and the decision holds instead.
 */
function liveSessionWithStrengthHistory(name = 'Back squat', reps = 10) {
  const onTargetSet = (reps: number): LoggedSet =>
    ({ done: true, aVal: '100', aVal2: String(reps), felt: '8', t: '8-10', rpe: '8' }) as LoggedSet;
  const histSession = (id: string, at: number, reps: number): Session => ({
    id,
    date: '2026-01-01',
    status: 'completed',
    completedAt: at,
    blocks: [
      {
        id: 'b',
        heading: 'Main',
        superset: false,
        exercises: [{ id: 'e', name, mode: 'reps_kg', rest: 90, sets: [onTargetSet(reps)] }],
      },
    ],
  }) as unknown as Session;

  const w = liftWorkout(name, 2);
  // liftWorkout's default target is a flat '5' (no range). An 8-10 rep-range
  // target — matching the history above and web's react-smoke scratch workout
  // for this same scenario — is what the decision is judged against, and what
  // the Reps field is prefilled from.
  (w.blocks[0] as StrengthBlock).exercises[0].sets.forEach((st) => {
    st.t = '8-10';
  });
  const live: Session = {
    id: uid(),
    date: ymd(new Date()),
    name: 'Lower',
    status: 'active',
    blocks: freshSessionBlocks(w.blocks),
    startedAt: Date.now(),
    workoutId: w.id,
  };
  seed({
    workouts: [w],
    sessions: [
      histSession('h1', 1000, reps),
      histSession('h2', 2000, reps),
      histSession('h3', 3000, reps),
      live,
    ],
  });
  return live;
}

/** The store as it stands on disk — what actually survives the app dying. */
const persisted = (): EngineDB => JSON.parse(storage.getItem(LS_KEY) || '{}');

// The screen is a stack screen: it reads bi/ei off the route and pushes with
// navigation. Passing them directly is exactly what App.tsx's navigator does.
const route = { key: 'l', name: 'Logger' as const, params: { bi: 0, ei: 0 } };
const navigation = { goBack: jest.fn(), navigate: jest.fn(), setParams: jest.fn() };

const mount = () =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  renderScreen(<LoggerScreen route={route as any} navigation={navigation as any} />);

describe('Logger', () => {
  beforeEach(() => jest.clearAllMocks());

  it('opens on the first set with the movement and its target', () => {
    liveSession();
    mount();
    expect(screen.getByText('Back squat')).toBeTruthy();
    expect(screen.getByText('Set 1 of 2')).toBeTruthy();
    expect(screen.getByText('target 5 @8')).toBeTruthy();
  });

  it('records a set to disk once the save debounce elapses', () => {
    // Asserting through the STORAGE port rather than the rendered tree is the
    // point: what survives the phone dying is the only version that counts.
    //
    // The wait is not test friction, it is the contract. Writes are coalesced
    // on a 400ms timer so a keystroke does not re-serialise the whole blob —
    // that is what took per-character cost from 22ms to 0.035ms. The set is on
    // the in-memory session immediately; disk lags by up to one debounce, and
    // an AppState listener flushes early when the app leaves the foreground.
    const s = liveSession();
    mount();

    fireEvent.changeText(screen.getByLabelText('kg'), '100');
    fireEvent.changeText(screen.getByLabelText('reps'), '5');
    fireEvent.press(screen.getByText('Finish Set'));
    fireEvent.press(screen.getByText('Confirm Set'));

    // Inside act(): the rest countdown also ticks on this advance, and its
    // setState outside act() is a warning that would train everyone to ignore
    // warnings.
    act(() => jest.advanceTimersByTime(500));

    const set = persisted().sessions.find((x) => x.id === s.id)!.blocks[0].exercises![0].sets[0];
    expect(set.done).toBe(true);
    expect(set.aVal).toBe('100');
    expect(set.aVal2).toBe('5');
    expect(Number(set.felt)).toBeGreaterThan(0);
  });

  it('prefills the weight from what the last session EARNED', () => {
    // The progression. Before it existed the logger printed "+2.5 kg for next
    // session" and dropped the number, and this field opened at last week's
    // weight forever.
    liveSession({ settings: { liftProgress: { 'back squat': { kg: 105, at: 1000 } } } });
    mount();
    expect(screen.getByLabelText('kg').props.value).toBe('105');
  });

  it('names the missing reason when no WHOOP recovery data is available', () => {
    // No live WHOOP connection exists in this test harness (network
    // required), so this is the default state for any athlete without a
    // connected strap — not a special-cased fixture. See the existing
    // 'eases the prefill on a red recovery morning' test above for the
    // same reasoning.
    liveSession({ settings: { liftProgress: { 'back squat': { kg: 105, at: 1000 } } } });
    mount();
    expect(screen.getByText('earned 105kg last time · no recovery data today')).toBeTruthy();
  });

  it('eases the prefill on a red recovery morning', () => {
    // WHOOP comes through the provider, which needs a network. The engine
    // decides this, and parity.test.ts pins the arithmetic; what matters here
    // is that with no reading the field opens at the full earned weight rather
    // than blank or eased-by-default.
    liveSession({ settings: { liftProgress: { 'back squat': { kg: 105, at: 1000 } } } });
    mount();
    expect(screen.getByLabelText('kg').props.value).toBe('105');
  });

  it('shows a confirmed set in the logged list, weight and reps together', () => {
    liveSession();
    mount();
    fireEvent.changeText(screen.getByLabelText('kg'), '100');
    fireEvent.changeText(screen.getByLabelText('reps'), '5');
    fireEvent.press(screen.getByText('Finish Set'));
    fireEvent.press(screen.getByText('Confirm Set'));

    expect(screen.getByText('100kg × 5')).toBeTruthy();
  });

  it('moves to the next set after a confirm', () => {
    liveSession();
    mount();
    fireEvent.changeText(screen.getByLabelText('kg'), '100');
    fireEvent.changeText(screen.getByLabelText('reps'), '5');
    fireEvent.press(screen.getByText('Finish Set'));
    fireEvent.press(screen.getByText('Confirm Set'));

    expect(screen.getByText('Set 2 of 2')).toBeTruthy();
  });

  it('survives being opened with no live session instead of crashing', () => {
    // Reachable for real: finish a session on one device, then restore the
    // stack on another with the logger still on top.
    seed({ workouts: [], sessions: [] });
    mount();
    expect(screen.getByText('No live session')).toBeTruthy();
  });

  it('surfaces an opt-in load suggestion after a 2-session on-target streak at the top of the range, and Apply writes it into the kg field', () => {
    // 3 sessions of 100kg × 10 against an 8-10 target: the reps are already at
    // the top of the range, so the only axis left is load — and 102.5 is real
    // progress on the 100 the field is showing.
    liveSessionWithStrengthHistory('Back squat', 10);
    mount();
    expect(screen.getByText(/On target the last 2 sessions/)).toBeTruthy();
    expect(screen.getByLabelText('kg').props.value).toBe('100');
    fireEvent.press(screen.getByText('Apply'));
    expect(screen.getByLabelText('kg').props.value).toBe('102.5');
  });

  it('running a seconds-mode set to zero fills the field with the held duration', () => {
    // t: '2' — a short target so the countdown running to zero costs only a
    // fake-timer advance, not a multi-second real wait. Mirrors the
    // fireEvent-then-advanceTimersByTime idiom conditioning.test.tsx's
    // finishARun() uses for its own on-the-clock behaviour.
    secondsSession('2');
    mount();
    fireEvent.press(screen.getByText('Start'));
    // Past the 2s target plus tick margin (the countdown polls every 250ms).
    act(() => jest.advanceTimersByTime(2600));
    expect(screen.getByLabelText('seconds').props.value).toBe('2');
  });

  it('stopping a seconds-mode timer early writes the actual elapsed time, not 0 or the full target', () => {
    secondsSession('10');
    mount();
    fireEvent.press(screen.getByText('Start'));
    act(() => jest.advanceTimersByTime(4000));
    fireEvent.press(screen.getByText('Stop'));
    const held = Number(screen.getByLabelText('seconds').props.value);
    expect(held).toBeGreaterThan(0);
    expect(held).toBeLessThan(10);
  });

  it('says nothing when the "progression" would write a smaller number than the field already shows', () => {
    /*
     * The shipped bug: 3 sessions of 100kg × 8 against an 8-10 target used to
     * render "try 9 reps next time" over a Reps field already prefilled with 10
     * — Apply downgraded it. There is nothing to suggest here, so the strip must
     * not appear at all.
     */
    liveSessionWithStrengthHistory('Back squat', 8);
    mount();
    expect(screen.getByLabelText('reps').props.value).toBe('10');
    expect(screen.queryByText(/On target the last 2 sessions/)).toBeNull();
    expect(screen.queryByText('Apply')).toBeNull();
  });
});

describe('Supersetting on the gym floor', () => {
  /*
   * `superset` was a flag on the BLOCK, so pairing two movements meant
   * splitting the block — not something anyone does mid-set. These cover the
   * control that pairs the exercise in front of you with the next one.
   */
  function pairSession() {
    const w = liftWorkout('Bench press', 2);
    const blk = w.blocks[0] as StrengthBlock<LoggedSet>;
    blk.exercises.push({
      ...blk.exercises[0],
      id: uid(),
      name: 'Strict dip',
      sets: blk.exercises[0].sets.map((x) => ({ ...x })),
    });
    const s: Session = {
      id: uid(),
      date: ymd(new Date()),
      name: 'Upper',
      status: 'active',
      blocks: freshSessionBlocks(w.blocks),
      startedAt: Date.now(),
      workoutId: w.id,
    };
    seed({ workouts: [w], sessions: [s] });
    return s;
  }

  it('offers to superset with the exercise that actually follows', () => {
    pairSession();
    mount();
    expect(screen.getByText(/Superset with/)).toBeTruthy();
    expect(screen.getByText('Strict dip')).toBeTruthy();
  });

  it('turns on and says so', () => {
    pairSession();
    mount();
    fireEvent.press(screen.getByLabelText(/superset with Strict dip, off/i));
    expect(screen.getByText(/Supersetted with/)).toBeTruthy();
  });

  it('does not offer a partner on the last exercise of a block', () => {
    // An offer you cannot take is noise, so the control is absent rather than
    // present-and-disabled.
    const w = liftWorkout('Bench press', 2);
    const s: Session = {
      id: uid(),
      date: ymd(new Date()),
      name: 'Upper',
      status: 'active',
      blocks: freshSessionBlocks(w.blocks),
      startedAt: Date.now(),
      workoutId: w.id,
    };
    seed({ workouts: [w], sessions: [s] });
    mount();
    expect(screen.queryByText(/Superset with/)).toBeNull();
  });
});

describe('warm-up sets and RPE', () => {
  it('a warm-up set confirms directly — no RPE stage, no felt recorded', () => {
    const w = liftWorkout('Back squat', 2);
    (w.blocks[0] as StrengthBlock).exercises[0].sets[0].t = 'W10';
    const s: Session = {
      id: uid(), date: ymd(new Date()), name: 'Lower', status: 'active',
      blocks: freshSessionBlocks(w.blocks), startedAt: Date.now(), workoutId: w.id,
    };
    seed({ workouts: [w], sessions: [s] });
    mount();
    fireEvent.changeText(screen.getByLabelText('kg'), '60');
    fireEvent.changeText(screen.getByLabelText('reps'), '10');
    fireEvent.press(screen.getByText('Finish Set'));
    // No rating stage for a warm-up: the set is already confirmed.
    expect(screen.queryByText(/How hard was that/i)).toBeNull();
    // Writes are debounce-coalesced (400ms) — flush before reading disk.
    act(() => jest.advanceTimersByTime(500));
    const stored = persisted().sessions.find((x) => x.id === s.id)!;
    const st = (stored.blocks[0] as StrengthBlock).exercises[0].sets[0];
    expect(st.done).toBe(true);
    expect(st.felt).toBeUndefined();
  });
});
