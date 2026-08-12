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
      /* Truthiness, not `in`: a `geolocation` key that exists but holds
         undefined passed the old check and then threw on `.watchPosition`,
         taking the whole run down instead of degrading to "no tracking". */
      if (!navigator.geolocation) {
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
      /* Guarded for the same reason start() is, and it matters more here:
         stop() runs from finish(), so a throw would take down the banking of a
         real session over a watch that was already gone. Clearing a watch that
         no longer exists is a no-op worth having, not an error worth raising. */
      if (watchId != null) navigator.geolocation?.clearWatch(watchId);
      watchId = null;
    },
  };
}
