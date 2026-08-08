import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSaveCoalescer } from './save-coalescer';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createSaveCoalescer', () => {
  it('coalesces a burst of schedule() calls into one save, with the LAST value', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const coalescer = createSaveCoalescer(save, 500);

    coalescer.schedule('a');
    coalescer.schedule('b');
    coalescer.schedule('c');
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('c');
  });

  it('never has two saves in flight — a schedule() during an in-flight save queues, it does not launch a second call', async () => {
    let resolveFirst: (() => void) | undefined;
    const save = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => { resolveFirst = resolve; }),
    );
    const coalescer = createSaveCoalescer(save, 500);

    coalescer.schedule('a');
    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledTimes(1);

    // An edit arrives while the first save is still unresolved.
    coalescer.schedule('b');
    await vi.advanceTimersByTimeAsync(500);
    // Still only one call — 'b' must not have started a second, concurrent save.
    expect(save).toHaveBeenCalledTimes(1);

    resolveFirst?.();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save).toHaveBeenLastCalledWith('b');
  });

  it('debounces again per burst — three quick edits after a completed save is still one call', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const coalescer = createSaveCoalescer(save, 500);

    coalescer.schedule('a');
    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledTimes(1);

    coalescer.schedule('b');
    coalescer.schedule('c');
    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith('c');
  });
});
