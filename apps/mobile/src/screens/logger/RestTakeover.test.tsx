import { act, fireEvent, render } from '@testing-library/react-native';
import type { BlockView, HotSet, RestState } from '@hybrid/session-authoring';
import { RestTakeover } from './RestTakeover';

const blocks: BlockView[] = [
  { id: 'b0', title: 'Squat + Row', progress: { done: 1, total: 8 } },
  { id: 'b1', title: 'Push-up', progress: { done: 0, total: 4 } },
];

const hot: HotSet = {
  exerciseIndex: 1,
  setIndex: 0,
  exerciseName: 'Dumbbell Row',
  message: 'hold here — earn it twice',
  planned: { reps: '10', rpe: '8' },
};

const setRest = (over: Partial<RestState> = {}): RestState => ({ left: 90, total: 90, kind: 'set', ...over });
const blockRest = (): RestState => ({ left: 0, total: 0, kind: 'block' });

const noop = () => {};

describe('RestTakeover — a timed rest', () => {
  it('shows the dial and the upcoming set', () => {
    const r = render(
      <RestTakeover rest={setRest()} hot={hot} draftKg={22.5} blocks={blocks} blockIndex={0} dispatch={noop} />,
    );
    expect(r.getByTestId('rest-dial')).toBeTruthy();
    expect(r.getByText('1:30')).toBeTruthy();
    expect(r.getByText('Dumbbell Row')).toBeTruthy();
    expect(r.getByText('hold here — earn it twice')).toBeTruthy();
  });

  it('ticks once a second, and stops when it unmounts', () => {
    jest.useFakeTimers();
    const dispatch = jest.fn();
    const r = render(
      <RestTakeover rest={setRest()} hot={hot} draftKg={null} blocks={blocks} blockIndex={0} dispatch={dispatch} />,
    );
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(dispatch.mock.calls.filter(([a]) => a.type === 'tick')).toHaveLength(3);

    r.unmount();
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(dispatch.mock.calls.filter(([a]) => a.type === 'tick')).toHaveLength(3);
    jest.useRealTimers();
  });

  it('extends by 15 rather than restarting', () => {
    const dispatch = jest.fn();
    const r = render(
      <RestTakeover rest={setRest()} hot={hot} draftKg={null} blocks={blocks} blockIndex={0} dispatch={dispatch} />,
    );
    fireEvent.press(r.getByText('+15'));
    expect(dispatch).toHaveBeenCalledWith({ type: 'extendRest', seconds: 15 });
  });

  it('reads Skip while there is time left and Lift once it is spent', () => {
    const a = render(
      <RestTakeover rest={setRest({ left: 12 })} hot={hot} draftKg={null} blocks={blocks} blockIndex={0} dispatch={noop} />,
    );
    expect(a.getByTestId('rest-go')).toBeTruthy();
    expect(a.getByText('Skip')).toBeTruthy();
    a.unmount();

    const b = render(
      <RestTakeover rest={setRest({ left: 0 })} hot={hot} draftKg={null} blocks={blocks} blockIndex={0} dispatch={noop} />,
    );
    expect(b.getByText('Lift')).toBeTruthy();
    expect(b.queryByText('+15')).toBeNull();
  });

  it('dismisses the rest rather than moving block', () => {
    const dispatch = jest.fn();
    const r = render(
      <RestTakeover rest={setRest()} hot={hot} draftKg={null} blocks={blocks} blockIndex={0} dispatch={dispatch} />,
    );
    fireEvent.press(r.getByTestId('rest-go'));
    expect(dispatch).toHaveBeenCalledWith({ type: 'dismissRest' });
  });
});

describe('RestTakeover — a block turn', () => {
  it('draws no dial at all', () => {
    // The prototype originally drew a spent 0:00 dial here and it read as a
    // timer that had run out rather than as a block ending. A page turn has
    // nothing to count down.
    const r = render(
      <RestTakeover rest={blockRest()} hot={null} draftKg={null} blocks={blocks} blockIndex={0} dispatch={noop} />,
    );
    expect(r.queryByTestId('rest-dial')).toBeNull();
    expect(r.getByText('block done')).toBeTruthy();
    expect(r.getByText('Push-up')).toBeTruthy();
  });

  it('dispatches no tick, ever', () => {
    jest.useFakeTimers();
    const dispatch = jest.fn();
    render(<RestTakeover rest={blockRest()} hot={null} draftKg={null} blocks={blocks} blockIndex={0} dispatch={dispatch} />);
    act(() => {
      jest.advanceTimersByTime(10_000);
    });
    expect(dispatch).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('goes to the next block when there is one', () => {
    const dispatch = jest.fn();
    const r = render(
      <RestTakeover rest={blockRest()} hot={null} draftKg={null} blocks={blocks} blockIndex={0} dispatch={dispatch} />,
    );
    expect(r.getByText('Go')).toBeTruthy();
    fireEvent.press(r.getByTestId('rest-go'));
    expect(dispatch).toHaveBeenCalledWith({ type: 'goToBlock', index: 1 });
  });

  it('finishes when it is the last block', () => {
    const dispatch = jest.fn();
    const r = render(
      <RestTakeover rest={blockRest()} hot={null} draftKg={null} blocks={blocks} blockIndex={1} dispatch={dispatch} />,
    );
    expect(r.getByText('Session done')).toBeTruthy();
    expect(r.getByText('Finish')).toBeTruthy();
    fireEvent.press(r.getByTestId('rest-go'));
    expect(dispatch).toHaveBeenCalledWith({ type: 'dismissRest' });
  });
});

describe('RestTakeover — an EMOM window', () => {
  const pacedRest = (over: Partial<RestState> = {}): RestState => ({
    left: 110,
    total: 150,
    kind: 'set',
    paced: true,
    ...over,
  });

  it('calls it a deadline rather than a rest', () => {
    /* "1:50 rest" and "next set in 1:50" are different promises. The second
       one did not start when the set ended — see `RestState.paced`. */
    const r = render(
      <RestTakeover rest={pacedRest()} hot={hot} draftKg={null} blocks={blocks} blockIndex={0} dispatch={noop} />,
    );
    expect(r.getByText('next set in')).toBeTruthy();
    expect(r.queryByText('rest')).toBeNull();
  });

  it('still draws the dial against the whole window', () => {
    const r = render(
      <RestTakeover rest={pacedRest()} hot={hot} draftKg={null} blocks={blocks} blockIndex={0} dispatch={noop} />,
    );
    expect(r.getByTestId('rest-dial')).toBeTruthy();
    expect(r.getByText('1:50')).toBeTruthy();
  });

  it('offers no +15, because pushing the clock out is not EMOM any more', () => {
    const r = render(
      <RestTakeover rest={pacedRest()} hot={hot} draftKg={null} blocks={blocks} blockIndex={0} dispatch={noop} />,
    );
    expect(r.queryByLabelText('Fifteen seconds more')).toBeNull();
    /* And a plain rest still does, so this is the paced case and not a
       regression in the ordinary one. */
    const plain = render(
      <RestTakeover rest={setRest()} hot={hot} draftKg={null} blocks={blocks} blockIndex={0} dispatch={noop} />,
    );
    expect(plain.getByLabelText('Fifteen seconds more')).toBeTruthy();
  });
});
