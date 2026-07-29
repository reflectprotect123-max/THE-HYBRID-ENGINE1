import MapView, { Polyline } from 'react-native-maps';
import type { GeoDownsampled } from '@hybrid/engine';

/**
 * Draws a session's GPS route. `live` gets a small inset sized for the
 * Conditioning screen; the static form (Recap, History) gets the full width
 * it's given by its container.
 */
export function RouteMap({ route, live }: { route: GeoDownsampled; live?: boolean }) {
  const points = route.pts.filter((p): p is { lat: number; lon: number } => p != null);
  if (points.length < 2) return null;

  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const region = {
    latitude: (Math.min(...lats) + Math.max(...lats)) / 2,
    longitude: (Math.min(...lons) + Math.max(...lons)) / 2,
    latitudeDelta: Math.max(0.003, Math.max(...lats) - Math.min(...lats)) * 1.4,
    longitudeDelta: Math.max(0.003, Math.max(...lons) - Math.min(...lons)) * 1.4,
  };

  return (
    <MapView
      style={{ width: '100%', height: live ? 140 : 220, borderRadius: 8 }}
      initialRegion={region}
      region={region}
      scrollEnabled={!live}
      zoomEnabled={!live}
      pitchEnabled={false}
      rotateEnabled={false}
    >
      <Polyline coordinates={points.map((p) => ({ latitude: p.lat, longitude: p.lon }))} strokeWidth={3} />
    </MapView>
  );
}
