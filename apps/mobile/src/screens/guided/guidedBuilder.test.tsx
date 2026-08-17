/*
 * The guided builder: mounting it against a seeded store and driving the
 * whole flow for real, the same way training.test.tsx mounts Training.
 *
 * The 'lift' block kind — its own movement/sets/reps/rpe steps — went with
 * the rest of strength on 17 August 2026, and every test that drove it went
 * with it. What remains authors a conditioning block or a text block
 * (warm-up/cooldown or metcon/notes).
 */
import { act, fireEvent, screen } from '@testing-library/react-native';
import { LS_KEY, type EngineDB } from '@hybrid/engine';
import { renderScreen, renderStack, seed } from '../../../test/harness';
import { storage } from '../../store/storage';
import { GuidedBuilderScreen } from './GuidedBuilder';

/** The store as it stands on disk — what actually survives the app dying. The
 *  same read-back logger.test.tsx verifies a logged set with. */
const persisted = (): EngineDB => JSON.parse(storage.getItem(LS_KEY) || '{}');

/** DbProvider debounces the disk write by 400ms, so the blob is only current
 *  once that timer has run. */
const flushSave = () => act(() => jest.advanceTimersByTime(500));

const newWorkout = () => ({ id: 'w1', name: 'New session', blocks: [], updatedAt: Date.now() });

describe('GuidedBuilderScreen', () => {
  it('builds a conditioning block end to end, lands on "add another?", and really saves it', () => {
    seed({ workouts: [newWorkout()] });
    renderScreen(<GuidedBuilderScreen />, { id: 'w1' });

    expect(screen.getByText('Session · block 1')).toBeTruthy();

    fireEvent.press(screen.getByText('♥ Conditioning'));
    expect(screen.getByText('What kind of conditioning?')).toBeTruthy();

    fireEvent.press(screen.getByText('Steady-state'));
    fireEvent.press(screen.getByText('Next'));

    expect(screen.getByText('Yes, add another')).toBeTruthy();
    expect(screen.getByText('Add another block?')).toBeTruthy();
    expect(screen.getByText('Conditioning added')).toBeTruthy();

    /*
     * Everything above is component state, set unconditionally once `update()`
     * has been CALLED — and `update()`'s contract is to no-op silently when its
     * callback returns false, which is exactly what happens when the workout
     * cannot be found. So "Conditioning added" on screen is no evidence that
     * anything was written. This is: the seeded store, read back off the same
     * key the app persists to.
     */
    flushSave();
    const w = persisted().workouts.find((x) => x.id === 'w1')!;
    expect(w.kind).toBe('conditioning');
    expect(w.blocks).toHaveLength(1);
    expect(w.blocks[0].kind).toBe('conditioning');
    expect((w.blocks[0] as { condFmt: string }).condFmt).toBe('steady');
  });

  it('builds a metcon/notes text block end to end', () => {
    seed({ workouts: [newWorkout()] });
    renderScreen(<GuidedBuilderScreen />, { id: 'w1' });

    fireEvent.press(screen.getByText('✎ Metcon / notes'));
    expect(screen.getByText("What's the workout?")).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText("What's the workout?"), 'AMRAP 12 — 10 burpees, 200m run');
    fireEvent.press(screen.getByText('Done'));

    expect(screen.getByText('Yes, add another')).toBeTruthy();
    expect(screen.getByText('Metcon / notes added')).toBeTruthy();

    flushSave();
    const w = persisted().workouts.find((x) => x.id === 'w1')!;
    expect(w.kind).toBe('strength');
    expect(w.blocks).toHaveLength(1);
    expect(w.blocks[0].kind).toBe('text');
    expect((w.blocks[0] as { body?: string }).body).toBe('AMRAP 12 — 10 burpees, 200m run');
  });

  it('the warm-up/cooldown block asks its own question', () => {
    seed({ workouts: [newWorkout()] });
    renderScreen(<GuidedBuilderScreen />, { id: 'w1' });

    fireEvent.press(screen.getByText('☀ Warm-up / Cooldown'));
    expect(screen.getByText("What's the warm-up?")).toBeTruthy();
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

    fireEvent.press(screen.getByText('♥ Conditioning'));
    fireEvent.press(screen.getByText('Steady-state'));
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

    fireEvent.press(screen.getByText('♥ Conditioning'));
    expect(screen.getByText('What kind of conditioning?')).toBeTruthy();

    act(() => {
      navRef.goBack();
    });
    // Still in the flow, one step earlier — not back on the route below.
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

  it('excludes Conditioning from block-type choices once a text block exists', () => {
    seed({ workouts: [newWorkout()] });
    renderScreen(<GuidedBuilderScreen />, { id: 'w1' });

    expect(screen.getByText('♥ Conditioning')).toBeTruthy();

    fireEvent.press(screen.getByText('✎ Metcon / notes'));
    fireEvent.changeText(screen.getByLabelText("What's the workout?"), '10 min bike');
    fireEvent.press(screen.getByText('Done'));

    expect(screen.getByText('Yes, add another')).toBeTruthy();
    fireEvent.press(screen.getByText('Yes, add another'));

    expect(screen.getByText('☀ Warm-up / Cooldown')).toBeTruthy();
    expect(screen.queryByText('♥ Conditioning')).toBeNull();

    flushSave();
    expect(persisted().workouts.find((x) => x.id === 'w1')!.kind).toBe('strength');
  });

  // The mirror of the test above. A split that only holds in one direction is
  // half a split: a conditioning workout must stop offering text blocks just
  // as firmly as a text-block workout stops offering conditioning.
  it('excludes Warm-up / Metcon from block-type choices once a conditioning block exists', () => {
    seed({ workouts: [newWorkout()] });
    renderScreen(<GuidedBuilderScreen />, { id: 'w1' });

    expect(screen.getByText('✎ Metcon / notes')).toBeTruthy();

    fireEvent.press(screen.getByText('♥ Conditioning'));
    expect(screen.getByText('What kind of conditioning?')).toBeTruthy();
    fireEvent.press(screen.getByText('Steady-state'));
    fireEvent.press(screen.getByText('Next'));

    expect(screen.getByText('Yes, add another')).toBeTruthy();
    fireEvent.press(screen.getByText('Yes, add another'));

    expect(screen.getByText('♥ Conditioning')).toBeTruthy();
    expect(screen.queryByText('☀ Warm-up / Cooldown')).toBeNull();
    expect(screen.queryByText('✎ Metcon / notes')).toBeNull();

    flushSave();
    expect(persisted().workouts.find((x) => x.id === 'w1')!.kind).toBe('conditioning');
  });
});
