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
