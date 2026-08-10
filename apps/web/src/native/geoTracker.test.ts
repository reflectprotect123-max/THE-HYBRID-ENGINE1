import { describe, it, expect, vi } from 'vitest';
import { createGeoTracker } from './geoTracker';

describe('createGeoTracker', () => {
  it('starts watching position and forwards points', () => {
    const watchId = 42;
    const watchPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: { latitude: 1.5, longitude: 2.5 } as GeolocationCoordinates,
        timestamp: 1000,
      } as GeolocationPosition);
      return watchId;
    });
    const clearWatch = vi.fn();
    // @ts-expect-error test override
    navigator.geolocation = { watchPosition, clearWatch };

    const tracker = createGeoTracker();
    const onPoint = vi.fn();
    tracker.start(onPoint, vi.fn());

    expect(onPoint).toHaveBeenCalledWith({ lat: 1.5, lon: 2.5, at: 1000 });

    tracker.stop();
    expect(clearWatch).toHaveBeenCalledWith(watchId);
  });

  it('reports an error when geolocation is unavailable', () => {
    // @ts-expect-error test override
    delete navigator.geolocation;

    const tracker = createGeoTracker();
    const onError = vi.fn();
    tracker.start(vi.fn(), onError);

    expect(onError).toHaveBeenCalledWith('This browser does not support location tracking.');
  });
});
