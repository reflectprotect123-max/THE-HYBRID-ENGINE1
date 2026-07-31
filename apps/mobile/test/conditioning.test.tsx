/*
 * Conditioning: the two-question ask (felt RPE, then mechanical completion)
 * between finishing a run and seeing it banked.
 *
 * Two things have to be true and neither is visible from `tsc` or the engine
 * suite. First, the chips an athlete presses must actually reach the
 * persisted record — "Banked" on screen is component state, not evidence of a
 * write, so these read the blob back off the same key the app persists to
 * (guidedBuilder.test.tsx's persisted()/flushSave() pattern), and nothing may
 * bank until the LAST question is answered. Second, the beforeRemove exit
 * guard must cover the whole rating stretch: finish() flips `live` off on its
 * first line, so a guard keyed on `live` alone lets a back gesture pop the
 * screen while chips are up and silently drop a finished, already-bankable
 * run. With two sequential questions there are now two interception points —
 * before the RPE answer, and between RPE and mechanical completion — and a
 * confirmed exit at either must bank whatever was actually answered. Those
 * are the invariants the second half of this file pins.
 */
import { act, fireEvent, screen } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';
import { LS_KEY, type EngineDB } from '@hybrid/engine';
import { renderScreen, renderStack, seed } from './harness';
import { storage } from '../src/store/storage';
import { ConditioningScreen } from '../src/screens/Conditioning';

/*
 * The native bridge, stubbed to its designed degradation: no strap found, no
 * GPS permission — a session that runs on the clock and banks no zone time,
 * which is a real on-device state, not an invented one. Stubbed here rather
 * than exercised because geoTracker.stop()'s fire-and-forget cleanup does a
 * dynamic `import('expo-location')`, which jest cannot execute (untransformed
 * `import()` in a CJS test env) and which therefore rejects UNHANDLED — jest
 * fails the test on infrastructure, not behaviour. Nothing this file asserts
 * is about the strap or the route; it is about the clock and the store.
 */
jest.mock('../src/native/capabilities', () => ({
  buzz: jest.fn(),
  setKeepAwake: jest.fn(async () => {}),
  createHeartRateMonitor: () => ({ start: jest.fn(async () => {}), stop: jest.fn() }),
  createGeoTracker: () => ({ start: jest.fn(async () => {}), stop: jest.fn() }),
  createFtmsMonitor: () => ({ start: jest.fn(async () => {}), stop: jest.fn() }),
  scheduleRestAlarm: jest.fn(async () => null),
  cancelRestAlarm: jest.fn(async () => {}),
}));

/** The store as it stands on disk — what actually survives the app dying. */
const persisted = (): EngineDB => JSON.parse(storage.getItem(LS_KEY) || '{}');

/** DbProvider debounces the disk write by 400ms, so the blob is only current
 *  once that timer has run. */
const flushSave = () => act(() => jest.advanceTimersByTime(500));

/**
 * Start a run, hold it past MIN_LOGGABLE_SEC (20s), and press Finish — landing
 * on the "How did that feel?" chips. The awaited act() flushes start()'s async
 * tail (the mocked BLE import, the geo permission ask) so their state updates
 * land inside act; the 25s advance also fires the 6s scan-timeout message,
 * which is part of the same real code path.
 */
const finishARun = async () => {
  fireEvent.press(screen.getByText('Start'));
  await act(async () => {});
  act(() => jest.advanceTimersByTime(25_000));
  await act(async () => {});
  fireEvent.press(screen.getByText('Finish'));
};

describe('ConditioningScreen felt RPE', () => {
  afterEach(() => jest.restoreAllMocks());

  it('asks how the run felt, then whether the work was completed, and banks both answers', async () => {
    seed({});
    renderScreen(<ConditioningScreen />, {});

    await finishARun();
    expect(screen.getByText('How did that feel?')).toBeTruthy();

    // Nothing is banked while the first question is open — every answer must
    // ride in on the same store update as the record itself.
    flushSave();
    expect(persisted().settings.conditioning ?? []).toHaveLength(0);

    // Answering RPE advances to the mechanical-completion question — it does
    // NOT bank. The record is still pending, still guarded.
    fireEvent.press(screen.getByText('RPE 7'));
    expect(screen.queryByText('How did that feel?')).toBeNull();
    expect(screen.getByText('Did you complete the work?')).toBeTruthy();
    flushSave();
    expect(persisted().settings.conditioning ?? []).toHaveLength(0);

    fireEvent.press(screen.getByText('Completed it'));
    expect(screen.getByText('Banked')).toBeTruthy();

    flushSave();
    const runs = persisted().settings.conditioning ?? [];
    expect(runs).toHaveLength(1);
    expect(runs[0].felt).toBe('7');
    expect(runs[0].mechanicalCompletion).toBe('met');
    // Strapless run: no zone time banked at all, so the computed cardio
    // verdict falls to the dur denominator and reads not_met.
    expect(runs[0].cardioCompletion).toBe('not_met');
    expect(runs[0].dur).toBeGreaterThanOrEqual(20);
  });

  it('banks the finished run unrated when the athlete backs out of the rating', async () => {
    /*
     * The native back action during the rating phase, simulated the way
     * guidedBuilder.test.tsx does: the screen under test sits ABOVE another
     * route, so the POP that Android back / swipe-back produce has somewhere
     * to go and "did it leave?" is a real question. Alert is spied because the
     * guard's confirmation lives there — the test presses its buttons by hand.
     */
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    seed({});
    const { navRef } = renderStack(<ConditioningScreen />, {});
    act(() => {
      navRef.navigate('Under test', {});
    });

    await finishARun();
    expect(screen.getByText('How did that feel?')).toBeTruthy();

    act(() => {
      navRef.goBack();
    });
    // The guard intercepted the pop: still on the chips, and the confirmation
    // is the rating-phase one, not the live-run "Discard this run?" copy.
    expect(screen.getByText('How did that feel?')).toBeTruthy();
    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [title, , buttons] = alertSpy.mock.calls[0] as [string, string, AlertButton[]];
    expect(title).toBe('Leave without rating?');

    // "Keep rating" is a plain cancel — the preventDefault already kept the
    // screen, so cancelling IS returning to the chips. Confirming the exit
    // must bank the run rather than discard it.
    expect(buttons.find((b) => b.text === 'Keep rating')?.style).toBe('cancel');
    const leave = buttons.find((b) => b.text === 'Bank & leave');
    expect(leave).toBeTruthy();
    act(() => {
      leave!.onPress!();
    });

    // The screen actually left this time…
    expect(screen.queryByText('How did that feel?')).toBeNull();

    // …and the run survived it: banked once, with every unanswered field left
    // unset. A run past MIN_LOGGABLE_SEC always ends up in the store, fully
    // answered or not. cardioCompletion is DERIVED (from zsec/dur, not asked),
    // so it is set on every bank — including this exit path — same as the
    // normal finish path below.
    flushSave();
    const runs = persisted().settings.conditioning ?? [];
    expect(runs).toHaveLength(1);
    expect(runs[0].felt).toBeUndefined();
    expect(runs[0].mechanicalCompletion).toBeUndefined();
    expect(runs[0].cardioCompletion).toBe('not_met');
    expect(runs[0].dur).toBeGreaterThanOrEqual(20);
  });

  it('banks the RPE answer when the athlete backs out between the two questions', async () => {
    /*
     * The NEW interruption point this task introduces: RPE answered, the
     * mechanical-completion chips up, and a back gesture. The record must
     * still be pending (answering the first question banks nothing), the
     * guard must still intercept, and a confirmed exit must bank the felt
     * value that WAS given — with the never-answered mechanical and computed
     * cardio fields left unset, not defaulted.
     */
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    seed({});
    const { navRef } = renderStack(<ConditioningScreen />, {});
    act(() => {
      navRef.navigate('Under test', {});
    });

    await finishARun();
    fireEvent.press(screen.getByText('RPE 7'));
    expect(screen.getByText('Did you complete the work?')).toBeTruthy();

    act(() => {
      navRef.goBack();
    });
    // Intercepted mid-stretch: still on the second question, same guard.
    expect(screen.getByText('Did you complete the work?')).toBeTruthy();
    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [title, , buttons] = alertSpy.mock.calls[0] as [string, string, AlertButton[]];
    expect(title).toBe('Leave without rating?');

    const leave = buttons.find((b) => b.text === 'Bank & leave');
    expect(leave).toBeTruthy();
    act(() => {
      leave!.onPress!();
    });
    expect(screen.queryByText('Did you complete the work?')).toBeNull();

    flushSave();
    const runs = persisted().settings.conditioning ?? [];
    expect(runs).toHaveLength(1);
    expect(runs[0].felt).toBe('7');
    expect(runs[0].mechanicalCompletion).toBeUndefined();
    // cardioCompletion is derived from zsec/dur, not from the unanswered
    // mechanical-completion question — it is set on this exit path too.
    expect(runs[0].cardioCompletion).toBe('not_met');
    expect(runs[0].dur).toBeGreaterThanOrEqual(20);
  });
});
