import { describe, it, expect, vi } from 'vitest';
import { requestWakeLock, releaseWakeLock } from './wakeLock';

describe('requestWakeLock', () => {
  it('requests a screen wake lock when the API is available', async () => {
    const mockLock = { release: vi.fn(), released: false, type: 'screen' } as any;
    const request = vi.fn().mockResolvedValue(mockLock);
    // @ts-expect-error test override
    navigator.wakeLock = { request };

    const lock = await requestWakeLock();

    expect(request).toHaveBeenCalledWith('screen');
    expect(lock).toBe(mockLock);
  });

  it('returns null without throwing when the API is unavailable', async () => {
    // @ts-expect-error test override
    delete navigator.wakeLock;

    const lock = await requestWakeLock();

    expect(lock).toBeNull();
  });

  it('releases a held lock', () => {
    const mockLock = { release: vi.fn() } as any;
    releaseWakeLock(mockLock);
    expect(mockLock.release).toHaveBeenCalled();
  });

  it('does nothing when releasing a null lock', () => {
    expect(() => releaseWakeLock(null)).not.toThrow();
  });
});

describe('cancelled-before-resolve race (Logger/Conditioning effect pattern)', () => {
  // Regression test for the effect pattern used in Logger.tsx and
  // Conditioning.tsx: `requestWakeLock()` is async, so cleanup can run before
  // the promise resolves (unmount, or the gating flag flipping false, inside
  // the small window between the call and the browser resolving it). Without
  // a `cancelled` guard, the lock that resolves late is never released and
  // the screen stays awake indefinitely. This exercises the exact shape of
  // that effect, not just the two underlying functions in isolation.
  function runEffect(deferred: { resolve: (l: WakeLockSentinel | null) => void }) {
    let cancelled = false;
    let lock: WakeLockSentinel | null = null;
    const request = () =>
      new Promise<WakeLockSentinel | null>((resolve) => {
        deferred.resolve = resolve;
      });
    request().then((l) => {
      if (cancelled) {
        l?.release();
        return;
      }
      lock = l;
    });
    return () => {
      cancelled = true;
      releaseWakeLock(lock);
    };
  }

  it('releases the lock when it resolves after cleanup already ran', async () => {
    const mockLock = { release: vi.fn(), released: false, type: 'screen' } as any;
    const deferred: { resolve: (l: WakeLockSentinel | null) => void } = { resolve: () => {} };

    const cleanup = runEffect(deferred);
    // Cleanup fires (unmount / gate flips false) before the promise resolves.
    cleanup();
    expect(mockLock.release).not.toHaveBeenCalled();

    // The late resolution must not orphan the sentinel.
    deferred.resolve(mockLock);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockLock.release).toHaveBeenCalledTimes(1);
  });

  it('still releases normally when cleanup runs after the promise resolved', async () => {
    const mockLock = { release: vi.fn(), released: false, type: 'screen' } as any;
    const deferred: { resolve: (l: WakeLockSentinel | null) => void } = { resolve: () => {} };

    const cleanup = runEffect(deferred);
    deferred.resolve(mockLock);
    await Promise.resolve();
    await Promise.resolve();

    cleanup();
    expect(mockLock.release).toHaveBeenCalledTimes(1);
  });
});
