import { describe, it, expect, vi, afterEach } from 'vitest';
import { requestCameraStream, stopCameraStream, captureFrame } from './camera';

describe('requestCameraStream', () => {
  afterEach(() => {
    // @ts-expect-error test cleanup
    delete navigator.mediaDevices;
  });

  it('asks for the environment camera by default', async () => {
    const getUserMedia = vi.fn().mockResolvedValue('stream' as unknown as MediaStream);
    // @ts-expect-error test override
    navigator.mediaDevices = { getUserMedia };

    const stream = await requestCameraStream();

    expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: 'environment' } });
    expect(stream).toBe('stream');
  });

  it('throws when the browser has no getUserMedia', async () => {
    // @ts-expect-error test override
    navigator.mediaDevices = undefined;

    await expect(requestCameraStream()).rejects.toThrow('This browser does not support camera access.');
  });
});

describe('stopCameraStream', () => {
  it('stops every track', () => {
    const track = { stop: vi.fn() };
    stopCameraStream({ getTracks: () => [track, track] } as unknown as MediaStream);
    expect(track.stop).toHaveBeenCalledTimes(2);
  });

  it('does nothing for a null stream', () => {
    expect(() => stopCameraStream(null)).not.toThrow();
  });
});

describe('captureFrame', () => {
  it('resolves null when the video has no dimensions yet', async () => {
    const video = { videoWidth: 0, videoHeight: 0 } as HTMLVideoElement;
    await expect(captureFrame(video)).resolves.toBeNull();
  });
});
