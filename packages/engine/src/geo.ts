import { CON_MAX_POINTS } from './constants';
import type { GeoDownsampled, GeoSample } from './types';

/*
 * Distance and route math for GPS-tracked conditioning, mirroring hr.ts's
 * conDownsample/zoneSeconds exactly — same bucketing shape, same cap — so a
 * route is stored with the same discipline as an HR trace.
 */

const EARTH_RADIUS_M = 6371000;

/**
 * Above this speed a "movement" between two fixes is GPS drift, not the
 * athlete — no outdoor conditioning format in this app is run faster than
 * ~10 m/s (36km/h), and a jittering fix parked still can otherwise
 * accumulate fake distance one metre at a time all session.
 */
const MAX_PLAUSIBLE_MPS = 10;

/** Great-circle distance between two points, in metres. */
export function haversineM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(s));
}

/**
 * Sums consecutive haversine distances across a session's raw fixes,
 * dropping any single hop whose implied speed exceeds MAX_PLAUSIBLE_MPS —
 * see the constant's comment for why.
 */
export function totalDistanceM(samples: GeoSample[]): number {
  let total = 0;
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const cur = samples[i];
    const dt = cur.t - prev.t;
    if (dt <= 0) continue;
    const d = haversineM(prev, cur);
    if (d / dt > MAX_PLAUSIBLE_MPS) continue;
    total += d;
  }
  return total;
}

/**
 * Compress a session's GPS fixes to a storable route. Same bin-widens-to-fit
 * bucketing as conDownsample, for the same reason: fixing the bin width at
 * session start means a long session's later fixes all fold into the final
 * bin once CON_MAX_POINTS is reached.
 */
export function geoDownsample(samples: GeoSample[], durSec: number): GeoDownsampled {
  const every = Math.max(2, Math.ceil(Math.max(0, durSec) / (CON_MAX_POINTS - 1)));
  const n = Math.max(1, Math.min(Math.ceil(durSec / every) + 1, CON_MAX_POINTS));
  const sumLat = new Array<number>(n).fill(0);
  const sumLon = new Array<number>(n).fill(0);
  const cnt = new Array<number>(n).fill(0);
  samples.forEach((s) => {
    const i = Math.max(0, Math.min(n - 1, Math.floor(s.t / every)));
    sumLat[i] += s.lat;
    sumLon[i] += s.lon;
    cnt[i] += 1;
  });
  return {
    every,
    pts: sumLat.map((v, i) => (cnt[i] ? { lat: v / cnt[i], lon: sumLon[i] / cnt[i] } : null)),
  };
}

/** Average pace, in seconds per kilometre. Null when there is no distance to divide by. */
export function paceSecPerKm(distanceM: number, durSec: number): number | null {
  if (!Number.isFinite(distanceM) || distanceM <= 0) return null;
  return durSec / (distanceM / 1000);
}
