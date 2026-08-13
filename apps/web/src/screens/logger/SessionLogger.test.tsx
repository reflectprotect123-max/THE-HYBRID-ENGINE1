// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { LS_KEY, type EngineDB, type LoggedSet, type Session, type StrengthBlock } from '@hybrid/engine';
import { DbProvider } from '../../store/db';
import { RestProvider } from '../../store/rest';

vi.mock('../../native/wakeLock', () => ({
  requestWakeLock: vi.fn(),
  releaseWakeLock: vi.fn(),
}));

import { requestWakeLock, releaseWakeLock } from '../../native/wakeLock';
import { SessionLogger, useLoggerBridge } from './SessionLogger';

/*
 * The clock is frozen to the seeded session's own date, and the two must
 * stay in step — DbProvider runs `expireStaleSessions` on every mount, which
 * drops an `active` session dated before today. See StartFreshCard.test.tsx
 * for the same trap and why the fixture's date is computed against the
 * frozen `now` rather than hardcoded to a date that will eventually be in
 * the past.
 */
const FIXTURE_DAY = new Date('2026-08-13T09:00:00');
vi.useFakeTimers({ now: FIXTURE_DAY, toFake: ['Date'] });
afterAll(() => {
  vi.useRealTimers();
});

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
});

function seed(session: Session) {
  const db: EngineDB = { workouts: [], sessions: [session], settings: {} };
  localStorage.setItem(LS_KEY, JSON.stringify(db));
}

function renderLogger() {
  return render(
    <MemoryRouter>
      <DbProvider>
        <RestProvider>
          <SessionLogger />
        </RestProvider>
      </DbProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(requestWakeLock).mockReset().mockResolvedValue(null);
  vi.mocked(releaseWakeLock).mockReset();
});

afterEach(() => {
  localStorage.clear();
});

describe('SessionLogger', () => {
  it('renders a seeded active session without crashing', () => {
    seed(activeSession([solo([workingSet(), workingSet()])]));
    expect(() => renderLogger()).not.toThrow();
  });

  it('requests the wake lock on mount and releases it on unmount', async () => {
    const lock = { release: vi.fn() } as unknown as WakeLockSentinel;
    vi.mocked(requestWakeLock).mockResolvedValue(lock);
    seed(activeSession([solo([workingSet()])]));

    const view = renderLogger();
    await act(async () => {
      await Promise.resolve();
    });

    expect(requestWakeLock).toHaveBeenCalledTimes(1);
    expect(releaseWakeLock).not.toHaveBeenCalled();

    view.unmount();
    expect(releaseWakeLock).toHaveBeenCalledWith(lock);
  });

  it('does not request a wake lock when no session is live', async () => {
    const view = renderLogger();
    await act(async () => {
      await Promise.resolve();
    });
    expect(requestWakeLock).not.toHaveBeenCalled();
    view.unmount();
  });
});

/*
 * `useLoggerBridge` is exercised directly, rather than through
 * `SessionLogger`'s render tree, because this task builds the shell only —
 * the block strip and the hot card that would give an athlete something to
 * tap are Tasks 3 and 4. Driving the bridge's own `dispatch` is the direct
 * equivalent of "the athlete logs a set" for what this task is responsible
 * for proving.
 */
describe('useLoggerBridge', () => {
  function setup(session: Session) {
    const updateSession = vi.fn();
    const startRest = vi.fn();
    const stopRest = vi.fn();
    const addRest = vi.fn();
    const hook = renderHook(() => useLoggerBridge(session, updateSession, startRest, stopRest, addRest));
    return { ...hook, updateSession, startRest, stopRest, addRest };
  }

  it('does not persist while a draft is only being typed', () => {
    const { result, updateSession } = setup(activeSession([solo([workingSet(), workingSet()])]));
    act(() => {
      result.current.dispatch({ type: 'setDraft', patch: { felt: 8 } });
    });
    expect(updateSession).not.toHaveBeenCalled();
  });

  it('a logged set reaches updateSession', () => {
    const { result, updateSession } = setup(activeSession([solo([workingSet(), workingSet()])]));

    act(() => {
      result.current.dispatch({ type: 'setDraft', patch: { felt: 8 } });
    });
    act(() => {
      result.current.dispatch({ type: 'logSet' });
    });

    expect(updateSession).toHaveBeenCalledTimes(1);
    expect(updateSession).toHaveBeenCalledWith('s1', expect.any(Function));

    // Prove the write actually carries the logged set, not just that the
    // function was called — apply the mutator the way `updateSession` itself
    // would, against a fresh clone of the session.
    const mutator = updateSession.mock.calls[0][1] as (s: Session) => void | false;
    const draft: Session = JSON.parse(JSON.stringify(activeSession([solo([workingSet(), workingSet()])])));
    mutator(draft);
    const block = draft.blocks[0] as StrengthBlock<LoggedSet>;
    expect(block.exercises[0].sets[0].done).toBe(true);
    expect(block.exercises[0].sets[0].felt).toBe('8');
  });

  it("a 'set' rest starts the rest store with the same seconds", () => {
    const { result, startRest, stopRest } = setup(activeSession([solo([workingSet(), workingSet()], 90)]));

    act(() => {
      result.current.dispatch({ type: 'setDraft', patch: { felt: 8 } });
    });
    act(() => {
      result.current.dispatch({ type: 'logSet' });
    });

    // A second working set is still owed, so `restAfter` opens a timed,
    // `'set'`-kind rest — exactly the case that must reach the store.
    expect(result.current.view.rest).toEqual({ left: 90, total: 90, kind: 'set' });
    expect(startRest).toHaveBeenCalledWith(90);
    expect(stopRest).not.toHaveBeenCalled();
  });

  it("a 'block' page turn does NOT start the rest store", () => {
    const { result, startRest } = setup(activeSession([solo([workingSet()])]));

    act(() => {
      result.current.dispatch({ type: 'setDraft', patch: { felt: 8 } });
    });
    act(() => {
      result.current.dispatch({ type: 'logSet' });
    });

    // The only set in the block is now done, so nothing is left to rest for
    // — `restAfter` returns the zero-total `'block'` page turn, not a rest.
    expect(result.current.view.rest).toEqual({ left: 0, total: 0, kind: 'block' });
    expect(startRest).not.toHaveBeenCalled();
  });

  it('clears the rest store once a bridge-armed rest clears', () => {
    const { result, startRest, stopRest } = setup(activeSession([solo([workingSet(), workingSet()], 90)]));

    act(() => {
      result.current.dispatch({ type: 'setDraft', patch: { felt: 8 } });
    });
    act(() => {
      result.current.dispatch({ type: 'logSet' });
    });
    expect(startRest).toHaveBeenCalledWith(90);

    act(() => {
      result.current.dispatch({ type: 'dismissRest' });
    });
    expect(result.current.view.rest).toBeNull();
    expect(stopRest).toHaveBeenCalledTimes(1);
  });

  // The trap this task exists to close: `tickRest` returns a NEW `RestState`
  // every second, so a bridge keyed on `view.rest`'s object identity would
  // call `startRest` again on every one of those ticks and restart the
  // store's own timer once a second. Keyed on the `armedByUs` flag instead,
  // it must arm exactly once no matter how many ticks land.
  it('starts the rest store exactly once across many ticks of the same rest', () => {
    const { result, startRest, stopRest } = setup(activeSession([solo([workingSet(), workingSet()], 90)]));

    act(() => {
      result.current.dispatch({ type: 'setDraft', patch: { felt: 8 } });
    });
    act(() => {
      result.current.dispatch({ type: 'logSet' });
    });
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

    act(() => {
      result.current.dispatch({ type: 'setDraft', patch: { felt: 8 } });
    });
    act(() => {
      result.current.dispatch({ type: 'logSet' });
    });
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
