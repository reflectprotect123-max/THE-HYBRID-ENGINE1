// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { BlockView, HotSet, RestState } from '@hybrid/session-authoring';
import { RestTakeover } from './RestTakeover';

const blocks: BlockView[] = [
  { id: 'b0', title: 'Squat', progress: { done: 1, total: 2 } },
  { id: 'b1', title: 'Bench', progress: { done: 0, total: 2 } },
];

const hot: HotSet = {
  exerciseIndex: 0,
  setIndex: 1,
  exerciseName: 'Squat',
  message: 'Same weight, same reps.',
  planned: { reps: '8', rpe: '8' },
};

const setRest: RestState = { left: 90, total: 90, kind: 'set' };
const blockRest: RestState = { left: 0, total: 0, kind: 'block' };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('RestTakeover', () => {
  it("a 'block' turn renders no dial", () => {
    render(
      <RestTakeover rest={blockRest} hot={null} draftKg={null} blocks={blocks} blockIndex={0} dispatch={vi.fn()} />,
    );
    expect(document.querySelector('[data-parity="rest-dial"]')).toBeNull();
    expect(screen.getByText('block done')).toBeInTheDocument();
    expect(screen.getByText('Bench')).toBeInTheDocument();
  });

  it("a 'set' rest renders the dial", () => {
    render(
      <RestTakeover
        rest={setRest}
        hot={hot}
        draftKg={100}
        blocks={blocks}
        blockIndex={0}
        dispatch={vi.fn()}
      />,
    );
    expect(document.querySelector('[data-parity="rest-dial"]')).toBeInTheDocument();
    expect(screen.getByText('1:30')).toBeInTheDocument();
    expect(screen.getByText('Squat')).toBeInTheDocument();
  });

  it('+15 appears only on a timed rest, and extends both left and total', () => {
    const dispatch = vi.fn();
    render(
      <RestTakeover rest={setRest} hot={hot} draftKg={100} blocks={blocks} blockIndex={0} dispatch={dispatch} />,
    );
    fireEvent.click(screen.getByText('+15'));
    expect(dispatch).toHaveBeenCalledWith({ type: 'extendRest', seconds: 15 });
  });

  it('offers no +15 during a block turn', () => {
    render(
      <RestTakeover rest={blockRest} hot={null} draftKg={null} blocks={blocks} blockIndex={0} dispatch={vi.fn()} />,
    );
    expect(screen.queryByText('+15')).toBeNull();
  });

  it('offers no +15 once a timed rest has already hit zero', () => {
    render(
      <RestTakeover
        rest={{ left: 0, total: 90, kind: 'set' }}
        hot={hot}
        draftKg={100}
        blocks={blocks}
        blockIndex={0}
        dispatch={vi.fn()}
      />,
    );
    expect(screen.queryByText('+15')).toBeNull();
  });

  it('rest-go dismisses a timed rest', () => {
    const dispatch = vi.fn();
    render(
      <RestTakeover rest={setRest} hot={hot} draftKg={100} blocks={blocks} blockIndex={0} dispatch={dispatch} />,
    );
    fireEvent.click(document.querySelector('[data-parity="rest-go"]')!);
    expect(dispatch).toHaveBeenCalledWith({ type: 'dismissRest' });
  });

  it('rest-go advances to the next block on a block turn', () => {
    const dispatch = vi.fn();
    render(
      <RestTakeover rest={blockRest} hot={null} draftKg={null} blocks={blocks} blockIndex={0} dispatch={dispatch} />,
    );
    fireEvent.click(document.querySelector('[data-parity="rest-go"]')!);
    expect(dispatch).toHaveBeenCalledWith({ type: 'goToBlock', index: 1 });
  });

  it('rest-go dismisses rather than advances past the last block', () => {
    const dispatch = vi.fn();
    render(
      <RestTakeover rest={blockRest} hot={null} draftKg={null} blocks={blocks} blockIndex={1} dispatch={dispatch} />,
    );
    expect(screen.getByText('Finish')).toBeInTheDocument();
    fireEvent.click(document.querySelector('[data-parity="rest-go"]')!);
    expect(dispatch).toHaveBeenCalledWith({ type: 'dismissRest' });
  });

  it('ticks a timed rest on an interval it owns, and only while mounted', () => {
    const dispatch = vi.fn();
    const { unmount } = render(
      <RestTakeover rest={setRest} hot={hot} draftKg={100} blocks={blocks} blockIndex={0} dispatch={dispatch} />,
    );
    vi.advanceTimersByTime(3000);
    expect(dispatch).toHaveBeenCalledTimes(3);
    expect(dispatch).toHaveBeenCalledWith({ type: 'tick' });

    unmount();
    dispatch.mockClear();
    vi.advanceTimersByTime(3000);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does not run a tick interval during a block turn', () => {
    const dispatch = vi.fn();
    render(
      <RestTakeover rest={blockRest} hot={null} draftKg={null} blocks={blocks} blockIndex={0} dispatch={dispatch} />,
    );
    vi.advanceTimersByTime(5000);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
