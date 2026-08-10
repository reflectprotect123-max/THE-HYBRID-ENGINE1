/**
 * Screen Wake Lock, Chrome/Android only (this repo's whole native-capability
 * surface is Android-scoped). Silently returns null anywhere the API is
 * absent — mirrors this file's siblings' "degrade, never throw" convention.
 */
export async function requestWakeLock(): Promise<WakeLockSentinel | null> {
  if (!('wakeLock' in navigator)) return null;
  try {
    return await (navigator as Navigator & { wakeLock: WakeLock }).wakeLock.request('screen');
  } catch {
    return null;
  }
}

export function releaseWakeLock(lock: WakeLockSentinel | null): void {
  lock?.release();
}
