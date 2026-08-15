import type { ReactElement } from 'react';
import { act, render, renderHook } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DbProvider } from '../../store/db';
import type { LoadContext, LoggedSet, Session, StrengthBlock } from '@hybrid/engine';

/* `mock`-prefixed so jest's factory hoisting lets the module factory below
   close over them — every other name is out of scope at hoist time. */
const mockHost = {
  activeSession: null as Session | null,
  updateSession: jest.fn(),
  startRest: jest.fn(),
  stopRest: jest.fn(),
  addRest: jest.fn(),
};
const mockWakeLock = { on: jest.fn(), off: jest.fn() };

jest.mock('./bridge', () => ({
  useLoggerHost: () => mockHost,
  useWakeLock: () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useEffect } = require('react') as typeof import('react');
    useEffect(() => {
      mockWakeLock.on();
      return () => mockWakeLock.off();
    }, []);
  },
}));

import { SessionLogger, useLoggerBridge } from './SessionLogger';

/*
 * `./bridge` is mocked rather than provided for real, because the real one
 * reaches `store/rest.tsx` and from there `native/capabilities.ts` — BLE,
 * location, notifications. None of that is what this file is responsible for.
 * What it IS responsible for is the wiring between the hook and those five
 * callables, and that is exercised directly through `useLoggerBridge`.
 */

const workingSet = (): LoggedSet => ({ t: '8', rpe: '8' });

const solo = (sets: LoggedSet[], rest = 120): StrengthBlock<LoggedSet> => ({
  id: 'b1',
  exercises: [{ id: 'e0', name: 'Squat', mode: 'reps_kg', sets, rest }],
});

const activeSession = (blocks: StrengthBlock<LoggedSet>[]): Session => ({
  id: 's1',
  date: '2026-08-13',
  status: 'active',
  blocks,
} as Session);

/* A notched phone, matching `test/harness.tsx`'s own metrics. The screen runs
   with the navigator's header off and takes the insets itself, so a test that
   mounted it bare would be testing a device that does not exist. */
const FRAME = { x: 0, y: 0, width: 390, height: 844 };
const INSETS = { top: 47, left: 0, right: 0, bottom: 34 };

/*
 * `DbProvider` is here because `RunningSession` now reads the store for the
 * athlete's history — the sessions, banked weights and recovery reading the
 * weight field opens from. It takes them from `useDb` and hands them DOWN to
 * `useLoggerBridge` as an argument rather than the bridge reaching for them
 * itself, which is what keeps the hook tests below able to drive the bridge
 * directly with a history of their own choosing.
 */
const mount = (ui: ReactElement) =>
  render(
    <SafeAreaProvider initialMetrics={{ frame: FRAME, insets: INSETS }}>
      <DbProvider>{ui}</DbProvider>
    </SafeAreaProvider>,
  );

beforeEach(() => {
  mockHost.activeSession = null;
  mockHost.updateSession.mockReset();
  mockHost.startRest.mockReset();
  mockHost.stopRest.mockReset();
  mockHost.addRest.mockReset();
  mockWakeLock.on.mockReset();
  mockWakeLock.off.mockReset();
});

describe('SessionLogger', () => {
  it('renders a live session without crashing', () => {
    mockHost.activeSession = activeSession([solo([workingSet(), workingSet()])]);
    expect(() => mount(<SessionLogger />)).not.toThrow();
  });

  it('holds the screen awake for as long as a session is on it', () => {
    mockHost.activeSession = activeSession([solo([workingSet()])]);
    const r = mount(<SessionLogger />);
    expect(mockWakeLock.on).toHaveBeenCalledTimes(1);
    expect(mockWakeLock.off).not.toHaveBeenCalled();
    r.unmount();
    expect(mockWakeLock.off).toHaveBeenCalledTimes(1);
  });

  it('clears the status bar rather than sitting under the notch', () => {
    // The navigator runs this screen with `headerShown: false`, so nothing
    // above it is clearing the status bar. The first port of this screen
    // dropped the insets the logger it replaced had taken, which put the
    // session's name under the notch on every phone that has one.
    mockHost.activeSession = activeSession([solo([workingSet()])]);
    const r = mount(<SessionLogger />);
    const style = Object.assign({}, ...[r.getByTestId('logger-appbar').props.style].flat().filter(Boolean));
    expect(style.paddingTop).toBe(INSETS.top + 14);
  });

  it('holds nothing awake when no session is live', () => {
    const r = mount(<SessionLogger />);
    expect(r.getByText('No live session')).toBeTruthy();
    expect(mockWakeLock.on).not.toHaveBeenCalled();
  });
});

/** Drive the bridge directly, with the five host callables stubbed and the
 *  load context under the test's control. */
function setup(session: Session, load: LoadContext = {}) {
  const updateSession = jest.fn();
  const startRest = jest.fn();
  const stopRest = jest.fn();
  const addRest = jest.fn();
  const hook = renderHook(() => useLoggerBridge(session, updateSession, startRest, stopRest, addRest, load));
  return { ...hook, updateSession, startRest, stopRest, addRest };
}

describe('useLoggerBridge', () => {
  function log(result: { current: { dispatch: (a: never) => void } }) {
    act(() => {
      result.current.dispatch({ type: 'setDraft', patch: { felt: 8 } } as never);
    });
    act(() => {
      result.current.dispatch({ type: 'logSet' } as never);
    });
  }

  it('does not persist while a draft is only being typed', () => {
    const { result, updateSession } = setup(activeSession([solo([workingSet(), workingSet()])]));
    act(() => {
      result.current.dispatch({ type: 'setDraft', patch: { felt: 8 } });
    });
    expect(updateSession).not.toHaveBeenCalled();
  });

  it('a logged set reaches updateSession, carrying the set', () => {
    const { result, updateSession } = setup(activeSession([solo([workingSet(), workingSet()])]));
    log(result);

    expect(updateSession).toHaveBeenCalledTimes(1);
    expect(updateSession).toHaveBeenCalledWith('s1', expect.any(Function));

    // Prove the write actually carries the logged set, not just that the
    // function was called — apply the mutator the way `updateSession` would,
    // against a fresh clone.
    const mutator = updateSession.mock.calls[0][1] as (s: Session) => void | false;
    const draft: Session = JSON.parse(JSON.stringify(activeSession([solo([workingSet(), workingSet()])])));
    mutator(draft);
    const block = draft.blocks[0] as StrengthBlock<LoggedSet>;
    expect(block.exercises[0].sets[0].done).toBe(true);
    expect(block.exercises[0].sets[0].felt).toBe('8');
  });

  it("a 'set' rest starts the rest store with the same seconds", () => {
    const { result, startRest, stopRest } = setup(activeSession([solo([workingSet(), workingSet()], 90)]));
    log(result);

    // A second working set is still owed, so `restAfter` opens a timed,
    // `'set'`-kind rest — exactly the case that must reach the store.
    expect(result.current.view.rest).toEqual({ left: 90, total: 90, kind: 'set' });
    expect(startRest).toHaveBeenCalledWith(90);
    expect(stopRest).not.toHaveBeenCalled();
  });

  it("a 'block' page turn does NOT start the rest store", () => {
    const { result, startRest } = setup(activeSession([solo([workingSet()])]));
    log(result);

    // The only set in the block is done, so there is nothing to rest for —
    // `restAfter` returns the zero-total `'block'` page turn, not a rest.
    expect(result.current.view.rest).toEqual({ left: 0, total: 0, kind: 'block' });
    expect(startRest).not.toHaveBeenCalled();
  });

  it('clears the rest store once a bridge-armed rest clears', () => {
    const { result, startRest, stopRest } = setup(activeSession([solo([workingSet(), workingSet()], 90)]));
    log(result);
    expect(startRest).toHaveBeenCalledWith(90);

    act(() => {
      result.current.dispatch({ type: 'dismissRest' });
    });
    expect(result.current.view.rest).toBeNull();
    expect(stopRest).toHaveBeenCalledTimes(1);
  });

  // The trap this bridge exists to close: `tickRest` returns a NEW `RestState`
  // every second, so a bridge keyed on `view.rest`'s object identity would call
  // `startRest` again on every tick and restart the store's own timer once a
  // second — and the athlete's rest-complete notification would never land on
  // time. Keyed on the `armedByUs` flag, it arms exactly once.
  it('starts the rest store exactly once across many ticks of the same rest', () => {
    const { result, startRest, stopRest } = setup(activeSession([solo([workingSet(), workingSet()], 90)]));
    log(result);
    expect(startRest).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 30; i++) {
      act(() => {
        result.current.dispatch({ type: 'tick' });
      });
    }

    expect(result.current.view.rest?.left).toBe(60);
    expect(startRest).toHaveBeenCalledTimes(1);
    expect(stopRest).not.toHaveBeenCalled();
  });

  it('relays extendRest to the store so its background timer stays in step with the dial', () => {
    const { result, startRest, addRest } = setup(activeSession([solo([workingSet(), workingSet()], 90)]));
    log(result);
    expect(startRest).toHaveBeenCalledWith(90);

    act(() => {
      result.current.dispatch({ type: 'extendRest', seconds: 15 });
    });

    expect(result.current.view.rest).toEqual({ left: 105, total: 105, kind: 'set' });
    expect(addRest).toHaveBeenCalledTimes(1);
    expect(addRest).toHaveBeenCalledWith(15);

    // A tick afterward must not re-relay the now-settled total.
    act(() => {
      result.current.dispatch({ type: 'tick' });
    });
    expect(addRest).toHaveBeenCalledTimes(1);
  });
});

/*
 * THE WEIGHT FIELD OPENS AT THE WEIGHT THE LAST SESSION EARNED.
 *
 * The regression these exist to catch is not a wrong number — it is a
 * FORGOTTEN ARGUMENT. `load` is optional on both `useLoggerBridge` and
 * `useSession`, deliberately: its absence means "the fold alone", which is a
 * defined answer rather than a crash. That is the right default and it is also
 * exactly how this broke in the first place. Nothing about the types would
 * have complained; the field just quietly read zero, and `liftAdapt` went on
 * banking a number after every session that nothing read back.
 *
 * So the guard has to be here, at the screen, asserting on the number an
 * athlete would actually see. A type cannot catch this and neither can a test
 * inside the engine, where every rung of the ladder already passes.
 */
describe('useLoggerBridge — the weight the athlete is offered', () => {
  const squat = (sets: LoggedSet[]): Session =>
    activeSession([{ id: 'b1', exercises: [{ id: 'e0', name: 'Squat', mode: 'reps_kg', sets, rest: 120 }] }]);

  const banked = (kg: number): LoadContext => ({
    settings: { liftProgress: { squat: { kg, at: 1000, reps: 5 } } },
  });

  it('opens at the banked weight, not at zero', () => {
    const { result } = setup(squat([workingSet(), workingSet()]), banked(120));
    expect(result.current.view.draft?.kg).toBe(120);
  });

  it('opens at ZERO with no history — the state this task found and fixed', () => {
    /* Kept as a positive assertion rather than deleted, because it is the
       behaviour a caller that forgets `load` still gets. If this ever starts
       returning a number, something is guessing. */
    const { result } = setup(squat([workingSet(), workingSet()]));
    expect(result.current.view.draft?.kg).toBe(0);
  });

  it('eases the offer on a red morning, and does not spend the banked weight doing it', () => {
    /* `nextWorkingWeight` owns the gate; this proves it survives the trip
       through two packages to the screen. One step off 120, and the athlete
       can still type over it. */
    const red = { ...banked(120), whoop: { recoveryScore: 20, at: Date.now() } as never };
    const { result } = setup(squat([workingSet(), workingSet()]), red);
    expect(result.current.view.draft?.kg).toBe(117.5);
  });

  it('lets TODAY outrank the bank once a set is logged', () => {
    /* The first set is logged at a rating, so the fold has something to say
       and it must win — a set you have already done is a fact, the banked
       weight is an inference from last week. */
    const { result } = setup(squat([workingSet(), workingSet()]), banked(120));
    act(() => {
      result.current.dispatch({ type: 'setDraft', patch: { kg: 100, reps: 8, felt: 6 } });
    });
    act(() => {
      result.current.dispatch({ type: 'logSet' });
    });
    const next = result.current.view.draft?.kg ?? 0;
    expect(next).toBeGreaterThan(100);
    expect(next).not.toBe(120);
  });
});
