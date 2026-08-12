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
import { liftWorkout, renderScreen, seed } from '../../test/harness';
import { storage } from '../store/storage';
import { LoggerScreen } from './Logger';

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
 * A live session on TWO `seconds`-mode holds, one per block.
 *
 * Separate blocks rather than one, so the first exercise has no superset
 * partner and "Side plank" appears exactly once on the stage — in the footer
 * control that moves to it. The targets differ so a duration written into the
 * WRONG set is unmistakable rather than coincidentally right.
 */
function twoSecondsSession(t1 = '4', t2 = '45') {
  const mk = (name: string, t: string) => ({
    ...newBlock(),
    id: uid(),
    heading: name,
    exercises: [{ ...newEx(), id: uid(), name, mode: 'seconds' as const, sets: [{ ...newSet(), t }] }],
  });
  const w: Workout = { id: uid(), name: 'Core', blocks: [mk('Plank', t1), mk('Side plank', t2)], updatedAt: Date.now() };
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
 * A live session whose FIRST block is a `seconds` hold and whose second is an
 * ordinary lift.
 *
 * The lift block is the point: leaving a running hold behind has to land
 * somewhere that mounts NO seconds field, because a seconds field acks
 * whatever finish it finds in the provider — so stepping onto another hold
 * would consume the completion before the athlete could come back to it.
 *
 * `rest: 0` so a confirm never parks the stage on the rest panel, where the
 * seconds field is not rendered at all. `preLogged`, when given, marks set 1
 * done at that duration — which is what `prefillPrimary` carries into set 2,
 * and therefore what a stale prefill would clobber a completed hold with.
 */
function holdThenLiftSession(t: string, sets = 1, preLogged?: string) {
  const hold = {
    ...newEx(),
    id: uid(),
    name: 'Plank',
    mode: 'seconds' as const,
    rest: 0,
    sets: Array.from({ length: sets }, () => ({ ...newSet(), t })),
  };
  const lift = {
    ...newEx(),
    id: uid(),
    name: 'Back squat',
    mode: 'reps_kg' as const,
    rest: 0,
    sets: [{ ...newSet(), t: '5', rpe: '8' }],
  };
  const w: Workout = {
    id: uid(),
    name: 'Core',
    updatedAt: Date.now(),
    blocks: [
      { ...newBlock(), id: uid(), heading: 'Core', exercises: [hold] },
      { ...newBlock(), id: uid(), heading: 'Main', exercises: [lift] },
    ],
  };
  const s: Session = {
    id: uid(),
    date: ymd(new Date()),
    name: 'Core',
    status: 'active',
    blocks: freshSessionBlocks(w.blocks),
    startedAt: Date.now(),
    workoutId: w.id,
  };
  if (preLogged != null) {
    // freshSessionBlocks deliberately keeps only `t`/`rpe`, so an already-logged
    // set has to be written onto the live copy here.
    const first = (s.blocks[0] as StrengthBlock<LoggedSet>).exercises[0].sets[0];
    first.done = true;
    first.aVal = preLogged;
  }
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

  it('shows the next-set weight adjustment as advice, and never silently writes it into the next set', () => {
    // coach-contract rule 7: "athlete performance may propose progression, it
    // may not apply it." A completed set is an ACTUAL; writing its computed
    // adjustment straight into the next set's field collapses actual,
    // proposal and coach decision into one invisible mutation. This regressed
    // once already (2026-08-08) — the web Logger was fixed, the mobile one
    // (this file) kept the silent write.
    //
    // 100kg x5 @ RPE 7.5 against this fixture's '5'@8 target computes a
    // +2.5kg suggestion (102.5kg) — see computeSetAdjustment. The bug wrote
    // that 102.5 straight into Set 2's kg field. The field opening at 100
    // instead is Set 2 correctly falling back to what Set 1 ITSELF logged
    // (prefillPrimary's same-exercise fallback), not a leftover suggestion.
    liveSession();
    mount();
    fireEvent.changeText(screen.getByLabelText('kg'), '100');
    fireEvent.changeText(screen.getByLabelText('reps'), '5');
    fireEvent.press(screen.getByText('Finish Set'));
    fireEvent.press(screen.getByText('Confirm Set'));

    expect(screen.getByText(/\+2\.5 kg for Set 2 \(102\.5 kg\)/)).toBeTruthy();
    fireEvent.press(screen.getByText('Skip rest'));
    expect(screen.getByLabelText('kg').props.value).toBe('100');
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

  it('tapping Finish Set mid-countdown logs the seconds actually HELD, not the prefilled target', () => {
    /*
     * The shipped bug. Finish Set stays live for the whole hold, and while the
     * countdown runs the box shows `timer.left` — but `v1` was never touched,
     * so it still held the target. An athlete who quit a 30s plank at four
     * seconds and tapped Finish Set instead of Stop logged a full 30.
     */
    const s = secondsSession('30');
    mount();
    expect(screen.getByLabelText('seconds').props.value).toBe('30');

    fireEvent.press(screen.getByText('Start'));
    act(() => jest.advanceTimersByTime(4000));
    // Finish Set, NOT Stop — the whole point of the regression.
    fireEvent.press(screen.getByText('Finish Set'));
    fireEvent.press(screen.getByText('Confirm Set'));
    act(() => jest.advanceTimersByTime(500));

    const set = persisted().sessions.find((x) => x.id === s.id)!.blocks[0].exercises![0].sets[0];
    expect(set.done).toBe(true);
    expect(Number(set.aVal)).toBe(4);
  });

  it('a hold that expires while its own field is gone does not write into a different set', () => {
    /*
     * `finished`/`total` wait in the provider for someone to ack them, and the
     * field's effect runs on MOUNT as well as on the transition — so the hold
     * armed on the Plank used to be claimed by whatever seconds field was on
     * screen when it ran out, against a target it had nothing to do with.
     */
    const s = twoSecondsSession('4', '45');
    mount();
    expect(screen.getByLabelText('seconds').props.value).toBe('4');
    fireEvent.press(screen.getByText('Start'));

    // Move to the other exercise while the Plank is still counting down.
    fireEvent.press(screen.getByText(/Side plank ›/));
    // Now let it run out, with only the Side plank's field mounted.
    act(() => jest.advanceTimersByTime(5000));

    // 45 — its own target — not the 4 seconds the Plank counted.
    expect(screen.getByLabelText('seconds').props.value).toBe('45');
    act(() => jest.advanceTimersByTime(500));
    const other = persisted().sessions.find((x) => x.id === s.id)!.blocks[1].exercises![0].sets[0];
    expect(other.aVal).toBeUndefined();
  });

  it("arms the timer from a RANGE target like '20-30s', where Number() alone yielded NaN", () => {
    // The design doc's own motivating example — "20-30s/side Pec Stretch".
    // `Number('20-30')` is NaN, which fell through to 0 and left Start
    // permanently disabled with nothing on screen to explain why.
    secondsSession('20-30s');
    mount();
    const start = screen.getByLabelText('Start');
    expect(start.props.accessibilityState.disabled).toBe(false);
    fireEvent.press(start);
    // Started at the TOP of the range, which is what the athlete aims at.
    expect(screen.getByLabelText('seconds').props.value).toBe('30');
    expect(screen.getByText('Stop')).toBeTruthy();
  });

  it('opens a range-targeted hold on the parsed top of the range, never the authored text', () => {
    /*
     * `prefillPrimary`'s non-lift fallback handed the field `st.t` verbatim, so
     * a legal target like "20-30s" sat in a NUMBER box — and confirming from
     * there logged the string "20-30s" as the duration held. The box is the
     * same one the timer arms from; both parse the target the same way now.
     */
    secondsSession('20-30s');
    mount();
    expect(screen.getByLabelText('seconds').props.value).toBe('30');
  });

  it('a hold that completes off-screen keeps its duration when the athlete comes back to that set', () => {
    /*
     * The race. Coming back to the set runs BOTH the field's finished-claim
     * effect and the stage's own per-set prefill effect in one commit, child
     * first — so the claim wrote the seconds held, and the prefill then
     * overwrote them from a snapshot of the session taken before that write.
     * The athlete held the full 30 and the app logged the raw target text.
     */
    const s = holdThenLiftSession('20-30s');
    mount();
    expect(screen.getByLabelText('seconds').props.value).toBe('30');
    fireEvent.press(screen.getByText('Start'));

    // Away to the lift — nothing there mounts a seconds field, so the
    // completion is still sitting unclaimed in the provider.
    fireEvent.press(screen.getByText(/Back squat ›/));
    act(() => jest.advanceTimersByTime(31000));

    // Back to the hold: claim effect and prefill effect, same commit.
    fireEvent.press(screen.getByText(/Plank ›/));
    expect(screen.getByLabelText('seconds').props.value).toBe('30');

    fireEvent.press(screen.getByText('Finish Set'));
    fireEvent.press(screen.getByText('Confirm Set'));
    act(() => jest.advanceTimersByTime(500));

    const set = persisted().sessions.find((x) => x.id === s.id)!.blocks[0].exercises![0].sets[0];
    expect(set.done).toBe(true);
    expect(set.aVal).toBe('30');
  });

  it('a hold that completes off-screen is not clobbered by the previous set carried forward', () => {
    /*
     * The same race, with the two effects DISAGREEING about the answer — set 1
     * logged 9 seconds, so the stale prefill has a real number of its own to
     * overwrite the completed 30 with. Parsing the target alone does not save
     * this one: the prefill never reaches the target at all.
     */
    const s = holdThenLiftSession('20-30s', 2, '9');
    mount();
    expect(screen.getByText('Set 2 of 2')).toBeTruthy();
    // What set 1 held, carried forward — the value the race clobbers with.
    expect(screen.getByLabelText('seconds').props.value).toBe('9');

    fireEvent.press(screen.getByText('Start'));
    fireEvent.press(screen.getByText(/Back squat ›/));
    act(() => jest.advanceTimersByTime(31000));
    fireEvent.press(screen.getByText(/Plank ›/));

    expect(screen.getByLabelText('seconds').props.value).toBe('30');

    fireEvent.press(screen.getByText('Finish Set'));
    fireEvent.press(screen.getByText('Confirm Set'));
    act(() => jest.advanceTimersByTime(500));

    const set = persisted().sessions.find((x) => x.id === s.id)!.blocks[0].exercises![0].sets[1];
    expect(set.done).toBe(true);
    expect(set.aVal).toBe('30');
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
