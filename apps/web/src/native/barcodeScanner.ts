/**
 * A thin wrapper over Chrome/Android's `BarcodeDetector` API.
 *
 * `BarcodeScanner.tsx` feeds it live video frames on an interval rather than
 * one still capture — see `camera.ts`'s header for why `captureFrame` does
 * not fit that loop. This module owns nothing about the camera itself, only
 * the detector: is it present, and what did the frame contain.
 *
 * Chrome/Android only, by design — `BarcodeDetector` has no Safari or
 * Firefox implementation, matching this project's Android/Chrome PWA scope.
 */

/** True when this browser exposes `BarcodeDetector` at all. */
export function isBarcodeDetectorSupported(): boolean {
  return 'BarcodeDetector' in globalThis;
}

/**
 * One detection pass over `source`.
 *
 * Returns the FIRST result's raw value, or null when nothing was found in
 * this frame — a miss is the normal case for almost every frame fed in
 * (`BarcodeScanner.tsx` calls this on an interval while nothing is in view),
 * not an error.
 */
export async function detectBarcode(source: ImageBitmapSource): Promise<string | null> {
  const detector = new (globalThis as any).BarcodeDetector();
  const results = await detector.detect(source);
  return results[0]?.rawValue ?? null;
}
