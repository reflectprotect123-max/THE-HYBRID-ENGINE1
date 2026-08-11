/**
 * The camera-permission plumbing shared by every screen that needs a live
 * back-camera feed on Chrome/Android — `LabelReader.tsx` (Task 2.11) today,
 * and `BarcodeScanner.tsx` (Task 2.12) next: request a stream, stop it on the
 * way out, and pull a still frame off a `<video>` element for a one-shot
 * capture such as a photographed label.
 *
 * Deliberately thin — no React, no UI. `BarcodeScanner` reads from the video
 * feed continuously (`BarcodeDetector` against live frames) rather than
 * capturing one still, so only `requestCameraStream`/`stopCameraStream` are
 * expected to carry over there; `captureFrame` is `LabelReader`'s own concern
 * and there is no reason to force a shared abstraction over it before a
 * second caller actually needs one.
 */

/** Requests the environment (back) camera. Rejects when denied or unsupported. */
export async function requestCameraStream(facingMode: 'environment' | 'user' = 'environment'): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser does not support camera access.');
  }
  return navigator.mediaDevices.getUserMedia({ video: { facingMode } });
}

/** Stops every track so the camera light goes off the moment the screen is done with it. */
export function stopCameraStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((track) => track.stop());
}

/**
 * One still frame off a playing `<video>`, as a JPEG `Blob`.
 *
 * Null when the video has no dimensions yet (metadata not loaded) or the
 * canvas cannot be read — the caller's job is to treat that the same as "the
 * camera could not take a photo", not to throw.
 */
export function captureFrame(video: HTMLVideoElement): Promise<Blob | null> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return Promise.resolve(null);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  ctx.drawImage(video, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.92));
}
