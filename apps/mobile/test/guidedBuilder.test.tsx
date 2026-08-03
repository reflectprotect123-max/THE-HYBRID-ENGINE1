/*
 * The guided builder: mounting it against a seeded store and driving the
 * whole flow for real, the same way training.test.tsx mounts Training.
 */
import { act, fireEvent, screen } from '@testing-library/react-native';
import { LS_KEY, type EngineDB } from '@hybrid/engine';
import { renderScreen, renderStack, seed } from './harness';
import { storage } from '../src/store/storage';
import { GuidedBuilderScreen } from '../src/screens/guided/GuidedBuilder';

/** The store as it stands on disk — what actually survives the app dying. The
 *  same read-back logger.test.tsx verifies a logged set with. */
const persisted = (): EngineDB => JSON.parse(storage.getItem(LS_KEY) || '{}');

/** DbProvider debounces the disk write by 400ms, so the blob is only current
 *  once that timer has run. */
const flushSave = () => act(() => jest.advanceTimersByTime(500));

const newWorkout = () => ({ id: 'w1', name: 'New session', blocks: [], updatedAt: Date.now() });

describe('GuidedBuilderScreen', () => {
  it('builds a lift block end to end, lands on "add another?", and really saves it', () => {
    seed({ workouts: [newWorkout()] });
    renderScreen(<GuidedBuilderScreen />, { id: 'w1' });

    expect(screen.getByText('Session · block 1')).toBeTruthy();

    fireEvent.press(screen.getByText('🏋 Lift'));
    expect(screen.getByText('Which movement?')).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText('movement name'), 'Back Squat');
    fireEvent.press(screen.getByText('Next'));
    expect(screen.getByText('How many sets?')).toBeTruthy();

    fireEvent.press(screen.getByText('Next'));
    expect(screen.getByText('How many reps?')).toBeTruthy();

    fireEvent.press(screen.getByText('8'));
    fireEvent.press(screen.getByText('Next'));
    expect(screen.getByText('How hard should it feel?')).toBeTruthy();

    fireEvent.press(screen.getByText('RPE 8'));
    fireEvent.press(screen.getByText('Next'));

    expect(screen.getByText('Yes, add another')).toBeTruthy();
    expect(screen.getByText('Add another block?')).toBeTruthy();
    expect(screen.getByText('Back Squat added')).toBeTruthy();

    /*
     * Everything above is component state, set unconditionally once `update()`
     * has been CALLED — and `update()`'s contract is to no-op silently when its
     * callback returns false, which is exactly what happens when the workout
     * cannot be found. So "Back Squat added" on screen is no evidence that
     * anything was written. This is: the seeded store, read back off the same
     * key the app persists to.
     */
    flushSave();
    const w = persisted().workouts.find((x) => x.id === 'w1')!;
    expect(w.blocks).toHaveLength(1);
    const ex = w.blocks[0].exercises![0];
    expect(ex.name).toBe('Back Squat');
    expect(ex.sets).toHaveLength(3);
    // Plain '8', not 'W8': nothing in this flow marked the set as a warm-up, and
    // the 'W' prefix is where that flag lives in the stored target.
    expect(ex.sets.map((s) => s.t)).toEqual(['8', '8', '8']);
    expect(ex.sets.map((s) => s.rpe)).toEqual(['8', '8', '8']);
  });

  it('keeps a custom reps target visible after stepping back onto it', () => {
    // The custom box used to be local state, so it reset to '' on the unmount
    // that every Back navigation causes: an empty box, no chip selected, and
    // Next enabled with nothing on screen to say why.
    seed({ workouts: [newWorkout()] });
    renderScreen(<GuidedBuilderScreen />, { id: 'w1' });

    fireEvent.press(screen.getByText('🏋 Lift'));
    fireEvent.changeText(screen.getByLabelText('movement name'), 'Back Squat');
    fireEvent.press(screen.getByText('Next'));
    fireEvent.press(screen.getByText('Next'));

    fireEvent.changeText(screen.getByLabelText('custom reps target'), '8-12');
    fireEvent.press(screen.getByText('Next'));
    expect(screen.getByText('How hard should it feel?')).toBeTruthy();

    fireEvent.press(screen.getByText('‹ Back'));
    expect(screen.getByText('How many reps?')).toBeTruthy();
    expect(screen.getByLabelText('custom reps target').props.value).toBe('8-12');
  });

  it('does not clobber a custom reps target while it is being typed', () => {
    // A native TextInput always reports the FULL new text on each keystroke,
    // built from whatever the box is currently showing -- not from some
    // separate intended-final-string. Deriving the shown value from `value`
    // by blanking it whenever `value` happens to equal a preset ('8', '5', ...)
    // used to reset the box to '' the instant the typed-so-far text matched
    // one, so the next keystroke landed on an empty field: typing "8-12"
    // produced a box (and a stored value) of "-12".
    seed({ workouts: [newWorkout()] });
    renderScreen(<GuidedBuilderScreen />, { id: 'w1' });

    fireEvent.press(screen.getByText('🏋 Lift'));
    fireEvent.changeText(screen.getByLabelText('movement name'), 'Back Squat');
    fireEvent.press(screen.getByText('Next'));
    fireEvent.press(screen.getByText('Next'));

    for (const ch of '8-12') {
      const shown = screen.getByLabelText('custom reps target').props.value;
      fireEvent.changeText(screen.getByLabelText('custom reps target'), shown + ch);
    }
    expect(screen.getByLabelText('custom reps target').props.value).toBe('8-12');

    fireEvent.press(screen.getByText('Next'));
    fireEvent.press(screen.getByText('RPE 8'));
    fireEvent.press(screen.getByText('Next'));

    flushSave();
    const w = persisted().workouts.find((x) => x.id === 'w1')!;
    expect(w.blocks[0].exercises![0].sets.map((s) => s.t)).toEqual(['8-12', '8-12', '8-12']);
  });

  it('cancelling the first question takes the phantom session with it', () => {
    // The Library writes the workout BEFORE this screen opens, so backing out of
    // the first question used to leave a permanent, blockless session behind —
    // listed as "conditioning", because that is how the Library reads any
    // zero-block workout.
    seed({ workouts: [newWorkout()] });
    renderScreen(<GuidedBuilderScreen />, { id: 'w1' });

    fireEvent.press(screen.getByText('‹ Cancel'));
    flushSave();

    expect(persisted().workouts).toHaveLength(0);
    // A tombstone, not just a local splice: without one the next sync restores it.
    expect(persisted().settings.deletedIds?.w1).toBeTruthy();
  });

  it('does not delete a session that already has a block in it', () => {
    // The same control, reached from "Add another?" → a new block type → cancel.
    // A block is already committed, so leaving must not take the session too.
    seed({ workouts: [newWorkout()] });
    renderScreen(<GuidedBuilderScreen />, { id: 'w1' });

    fireEvent.press(screen.getByText('🏋 Lift'));
    fireEvent.changeText(screen.getByLabelText('movement name'), 'Back Squat');
    fireEvent.press(screen.getByText('Next'));
    fireEvent.press(screen.getByText('Next'));
    fireEvent.press(screen.getByText('8'));
    fireEvent.press(screen.getByText('Next'));
    fireEvent.press(screen.getByText('RPE 8'));
    fireEvent.press(screen.getByText('Next'));

    fireEvent.press(screen.getByText('Yes, add another'));
    // The header counts committed blocks, so the next one is block 2.
    expect(screen.getByText('Session · block 2')).toBeTruthy();

    fireEvent.press(screen.getByText('‹ Cancel'));
    flushSave();

    expect(persisted().workouts).toHaveLength(1);
    expect(persisted().workouts[0].blocks).toHaveLength(1);
    expect(persisted().settings.deletedIds?.w1).toBeFalsy();
  });

  it('takes the native back action as a step back, not as an exit', () => {
    /*
     * Android's hardware back and the swipe-back gesture both arrive as the same
     * POP action this fires, and both used to remove the whole screen — losing
     * the block being authored from any step. The screen under test sits ABOVE
     * another route here, so the pop has somewhere to go and "did it leave?" is a
     * real question.
     */
    seed({ workouts: [newWorkout()] });
    const { navRef } = renderStack(<GuidedBuilderScreen />, { id: 'w1' });
    act(() => {
      navRef.navigate('Under test', { id: 'w1' });
    });

    fireEvent.press(screen.getByText('🏋 Lift'));
    fireEvent.changeText(screen.getByLabelText('movement name'), 'Back Squat');
    fireEvent.press(screen.getByText('Next'));
    expect(screen.getByText('How many sets?')).toBeTruthy();

    act(() => {
      navRef.goBack();
    });
    // Still in the flow, one step earlier — not back on the route below.
    expect(screen.getByText('Which movement?')).toBeTruthy();
    expect(screen.getByLabelText('movement name').props.value).toBe('Back Squat');

    act(() => {
      navRef.goBack();
    });
    expect(screen.getByText('What are we doing?')).toBeTruthy();

    // From the first question there IS no earlier step, so this one leaves —
    // and takes the phantom session with it.
    act(() => {
      navRef.goBack();
    });
    expect(screen.queryByText('What are we doing?')).toBeNull();
    flushSave();
    expect(persisted().workouts).toHaveLength(0);
    expect(persisted().settings.deletedIds?.w1).toBeTruthy();
  });

  it('starts each new block from a clean draft', () => {
    // Marking a set as a warm-up used to leak into the NEXT block picked in the
    // same wizard session — which silently skips the RPE step and prefixes the
    // stored target with 'W'.
    seed({ workouts: [newWorkout()] });
    renderScreen(<GuidedBuilderScreen />, { id: 'w1' });

    fireEvent.press(screen.getByText('🏋 Lift'));
    fireEvent.changeText(screen.getByLabelText('movement name'), 'Warm-up squat');
    fireEvent.press(screen.getByText('Next'));
    fireEvent.press(screen.getByText('Next'));
    fireEvent.press(screen.getByLabelText('this is a warm-up'));
    fireEvent.press(screen.getByText('8'));
    // A warm-up set skips RPE entirely, so this commits the block.
    fireEvent.press(screen.getByText('Next'));
    expect(screen.getByText('Yes, add another')).toBeTruthy();

    fireEvent.press(screen.getByText('Yes, add another'));
    fireEvent.press(screen.getByText('🏋 Lift'));
    fireEvent.changeText(screen.getByLabelText('movement name'), 'Back Squat');
    fireEvent.press(screen.getByText('Next'));
    fireEvent.press(screen.getByText('Next'));
    fireEvent.press(screen.getByText('8'));
    fireEvent.press(screen.getByText('Next'));
    // Reached at all only because the warm-up flag did not carry over.
    expect(screen.getByText('How hard should it feel?')).toBeTruthy();
    fireEvent.press(screen.getByText('RPE 8'));
    fireEvent.press(screen.getByText('Next'));

    flushSave();
    const w = persisted().workouts.find((x) => x.id === 'w1')!;
    expect(w.blocks).toHaveLength(2);
    expect(w.blocks[0].exercises![0].sets[0].t).toBe('W8');
    expect(w.blocks[1].exercises![0].sets[0]).toEqual({ t: '8', rpe: '8' });
  });

  it('excludes Conditioning from block-type choices once a strength block exists', () => {
    seed({ workouts: [newWorkout()] });
    renderScreen(<GuidedBuilderScreen />, { id: 'w1' });

    expect(screen.getByText('♥ Conditioning')).toBeTruthy();

    fireEvent.press(screen.getByText('🏋 Lift'));
    fireEvent.changeText(screen.getByLabelText('movement name'), 'Back Squat');
    fireEvent.press(screen.getByText('Next'));
    fireEvent.press(screen.getByText('Next'));
    fireEvent.press(screen.getByText('8'));
    fireEvent.press(screen.getByText('Next'));
    fireEvent.press(screen.getByText('RPE 8'));
    fireEvent.press(screen.getByText('Next'));

    expect(screen.getByText('Yes, add another')).toBeTruthy();
    fireEvent.press(screen.getByText('Yes, add another'));

    expect(screen.getByText('☀ Warm-up / Cooldown')).toBeTruthy();
    expect(screen.queryByText('♥ Conditioning')).toBeNull();
  });
});
