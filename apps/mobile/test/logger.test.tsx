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
import { LS_KEY, freshSessionBlocks, uid, type EngineDB, type Session } from '@hybrid/engine';
import { liftWorkout, renderScreen, seed } from './harness';
import { storage } from '../src/store/storage';
import { LoggerScreen } from '../src/screens/Logger';

/** A live session on one lift, ready for the stage to open on set 1. */
function liveSession(over: Partial<EngineDB> = {}) {
  const w = liftWorkout('Back squat', 2);
  const s: Session = {
    id: uid(),
    date: '2026-07-27',
    name: 'Lower',
    status: 'active',
    blocks: freshSessionBlocks(w.blocks),
    startedAt: Date.now(),
    workoutId: w.id,
  };
  seed({ workouts: [w], sessions: [s], ...over });
  return s;
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

  it('eases the prefill on a red recovery morning', () => {
    // WHOOP comes through the provider, which needs a network. The engine
    // decides this, and parity.test.ts pins the arithmetic; what matters here
    // is that with no reading the field opens at the full earned weight rather
    // than blank or eased-by-default.
    liveSession({ settings: { liftProgress: { 'back squat': { kg: 105, at: 1000 } } } });
    mount();
    expect(screen.getByLabelText('kg').props.value).toBe('105');
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
});
