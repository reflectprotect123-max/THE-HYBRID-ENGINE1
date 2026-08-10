/**
 * Foreground-only GPS, Chrome/Android. Deliberately NOT equivalent to
 * mobile's background-surviving expo-location tracker — there is no
 * reliable browser API for that, and this project's design spec says so
 * explicitly rather than papering over the gap.
 */
export interface GeoPoint { lat: number; lon: number; at: number }

export function createGeoTracker() {
  let watchId: number | null = null;

  return {
    start(onPoint: (point: GeoPoint) => void, onError: (message: string) => void): void {
      if (!('geolocation' in navigator)) {
        onError('This browser does not support location tracking.');
        return;
      }
      watchId = navigator.geolocation.watchPosition(
        (pos) => onPoint({ lat: pos.coords.latitude, lon: pos.coords.longitude, at: pos.timestamp }),
        () => onError('Location tracking failed. Check your browser permissions.'),
        { enableHighAccuracy: true },
      );
    },
    stop(): void {
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      watchId = null;
    },
  };
}
