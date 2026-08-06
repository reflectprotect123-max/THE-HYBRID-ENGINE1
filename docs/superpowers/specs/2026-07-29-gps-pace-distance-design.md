# GPS-tracked pace and distance for conditioning

**Status:** design, approved · **Date:** 2026-07-29
**Sub-project A of five.** See "Where this sits" at the end.

---

## The problem

`CondBlock` / `CondResult` (`packages/engine/src/types.ts`) describe a
conditioning session entirely in terms of time and heart-rate zone: `minutes`,
`effort`/`targetZone`, `zsec` (seconds banked per zone), `dur`. There is no
field anywhere in the engine, and no code anywhere in `apps/web`,
`apps/mobile`, or `apps/coach`, that represents distance or pace. A run, row,
or ride is recorded exactly the same way a stationary bike interval session
is — by how long you spent in each heart-rate band.

For outdoor cardio this throws away the two numbers most runners and cyclists
actually care about first.

## What we are building

Live GPS tracking on the mobile app, for conditioning sessions done outdoors.
The phone's location is sampled through a conditioning session (foreground
and, via a background task, with the screen locked or the app backgrounded),
turned into total distance and average pace, and — same as everything else
this app tracks — synced and shown back on Recap, History, and Progress
across all three apps.

**This is informational, not a second progression system.** `conAdapt` and
`conProgLevel` keep working exactly as they do today, off HR-zone seconds. A
fast or slow run neither earns nor costs a level. Distance and pace are
recorded and displayed; they do not judge anything.

**GPS tracking is mobile-only.** Background location while the screen is
locked only works natively. Web and the coach builder read the resulting
numbers (distance, pace) as synced data, same as any other field — they never
run tracking themselves and never render a map.

### Why this is a bigger change than sub-project C

Everything shipped this session so far has been JS-only and shipped over the
air. This is not: `expo-location`, `expo-task-manager`, and `react-native-maps`
are native modules. Adding them requires:

- A `runtimeVersion` bump (this repo's own rule: bump by hand, same commit as
  any native change) and an Android `versionCode` bump — this ships as a new
  store build, not an OTA update.
- A Google Maps API key from a Google Cloud Console project, which only the
  account owner can create — supplied as an EAS secret
  (`GOOGLE_MAPS_API_KEY`), not committed.
- Real on-device testing. `checks/react-smoke.mjs` drives headless Chromium —
  it cannot exercise GPS, a background task, or a native map. The engine math
  (distance, downsampling, pace formatting) gets real unit tests; the tracker,
  background behavior, and the map do not have automated coverage, and the
  plan says so rather than implying they do.

## Data model (packages/engine)

### New types (`types.ts`)

```ts
/** One GPS fix during a tracked conditioning session. */
export interface GeoSample {
  /** seconds since session start, matching HrSample's `t` */
  t: number;
  lat: number;
  lon: number;
}

/** A downsampled route, stored the same spirit as `Downsampled` (HR trace)
 *  but carrying coordinate pairs instead of a single number. */
export interface GeoDownsampled {
  every: number;
  pts: ({ lat: number; lon: number } | null)[];
}
```

### `CondResult` gains (all optional — absent means "not tracked this session")

```ts
distanceM?: number;        // total metres covered, jitter-filtered
avgPaceSecPerKm?: number;  // dur / (distanceM/1000), only set when distanceM is
route?: GeoDownsampled;    // downsampled path, capped like the HR trace
```

### `CondBlock` gains one coach-authored field

```ts
targetDistanceM?: number;
```

A plain number the coach types (e.g. "5000" for 5km), shown as an
informational chip on the athlete's card — "Target: 5.0 km" — next to the
existing effort chip. Purely a display target: no pace band, no zone system,
no tie-in to `conAdapt`. Optional, defaults to unset (today's behavior,
unchanged).

### New pure functions (`conditioning.ts`, next to `conDownsample`/`zoneSeconds`)

```ts
/** Haversine distance between two points, in metres. */
function haversineM(a: {lat,lon}, b: {lat,lon}): number

/** Sums consecutive haversine distances across samples. Drops any single
 *  hop implying a speed above a sane cardio ceiling (~10 m/s, ~36km/h) —
 *  a parked-still GPS jittering by a few metres between fixes must not
 *  accumulate into fake distance, and neither must a fix that glitches
 *  across town between two samples. */
function totalDistanceM(samples: GeoSample[]): number

/** Downsamples a route to at most CON_MAX_POINTS, same cap and bucketing
 *  shape as the existing HR trace downsampler. */
function geoDownsample(samples: GeoSample[], durSec: number): GeoDownsampled
```

### New display helper (`num.ts`)

```ts
/** "5:12/km" from seconds-per-km. Mirrors fmtRpe/fmtClock's plainness. */
function fmtPace(secPerKm: number): string

/** "5.2 km" from metres. */
function fmtDistance(m: number): string
```

## Mobile: the GPS capability

### `native/capabilities.ts` gains a `GeoTracker`, shaped like `HeartRateMonitor`

```ts
export type GeoState = 'tracking' | 'error';

export interface GeoTracker {
  /** Resolves once tracking has begun, or once onState explains why not.
   *  Samples arrive on onSample. Degrades like the HR monitor: a denied
   *  permission means no samples, never a thrown error. */
  start(onSample: (s: GeoSample) => void, onState?: (state: GeoState, msg: string) => void): Promise<void>;
  stop(): void;
}

export function createGeoTracker(): GeoTracker
```

Implementation: `expo-location`'s `startLocationUpdatesAsync` registered
against an `expo-task-manager` background task, so tracking survives a locked
screen — the same reason `react-native-ble-plx` needed
`isBackgroundEnabled`. Foreground permission is requested first; background
permission is requested only if the athlete accepts (Android and iOS both
gate background location behind a second, explicit prompt — never bundle the
two into one ask).

### Conditioning screen (`apps/mobile/src/screens/Conditioning.tsx`)

Wires in `createGeoTracker()` alongside the existing
`createHeartRateMonitor()`: a `geoSamples = useRef<GeoSample[]>([])` fills the
same way `samples` already does. At session finish, alongside
`conDownsample(samples.current, dur)`, compute
`totalDistanceM(geoSamples.current)` and `geoDownsample(geoSamples.current,
dur)` and set them on the `CondResult`. If tracking never started (permission
denied, no fix acquired), these three fields are simply left unset — the rest
of the result is unaffected, exactly like a session with no HR strap.

## Map UI (mobile only)

A new `RouteMap` component (`apps/mobile/src/ui/RouteMap.tsx` or similar,
alongside other shared UI) wrapping `react-native-maps`:

- **Live**, on the Conditioning screen while tracking: a small inset showing
  current position and the route walked so far.
- **Static**, on Recap and in History's session detail: the full stored route
  drawn as a line, read straight from `CondResult.route`.

Web and coach never import `react-native-maps` and never render a map — they
show `fmtDistance`/`fmtPace` text pulled from the synced `CondResult`, same
treatment as the existing zone-seconds tally.

## Native config (`apps/mobile/app.json`)

- `plugins` gains `expo-location` (with the two usage-description strings)
  and `expo-task-manager`, alongside the existing `react-native-ble-plx` and
  `expo-notifications` entries.
- `android.permissions` gains `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`,
  `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`,
  `FOREGROUND_SERVICE_LOCATION`.
- `ios.infoPlist` gains `NSLocationWhenInUseUsageDescription`,
  `NSLocationAlwaysAndWhenInUseUsageDescription`, and `UIBackgroundModes:
  ["location"]`.
- `react-native-maps`'s config plugin reads
  `config.googleMaps.apiKey` from an EAS secret (`GOOGLE_MAPS_API_KEY`) rather
  than a committed value — the plan will call out exactly where you need to
  create the Google Cloud project and hand over the key.
- `runtimeVersion` bumped by hand (currently `"1"` → `"2"`) and Android
  `versionCode` incremented, in the same commit as these native changes — per
  this repo's own documented rule. This means the change ships as a new store
  build, and the mobile-ota.yml workflow's next OTA publish will only reach
  phones already running that new native build.

## Error handling

Every failure degrades to "session runs exactly as it does today, with less
data" — never a thrown error, matching `capabilities.ts`'s existing
philosophy for the HR strap:

| Failure | Behavior |
|---|---|
| Location permission denied | Session proceeds with no distance/route recorded |
| Background permission denied, foreground granted | Tracking works while the app is open; pauses when backgrounded, resumes on return, gap not double-counted |
| GPS signal lost mid-session | Tracking pauses; no jump-distance credited across the dropout |
| Background task killed by the OS | Whatever was captured before the kill is saved at session end |
| No `GOOGLE_MAPS_API_KEY` configured (Android) | Native build fails at the `react-native-maps` config-plugin step — caught at build time, not at runtime |

## Testing

- **Engine (TDD, real unit tests):** `haversineM`, `totalDistanceM`
  (including the jitter-filter ceiling), `geoDownsample` (bucketing, cap,
  null-gap handling), `fmtPace`, `fmtDistance`. All pure and deterministic —
  same testing bar as the rest of `packages/engine`.
- **Not automatable, stated plainly:** the native tracker's actual GPS
  behavior, background task survival, and the map rendering. These need real
  on-device testing by you before this ships; the plan will not claim
  `react-smoke` coverage that does not exist.

## Where this sits

Five sub-projects total, from this session's roadmap:

- **A — this one.** Pace/distance in the data model.
- **B — coach as multi-athlete product.** Designed, explicitly deferred until
  other athletes exist.
- **C — coach authors engine types.** Shipped (2026-07-29): full parity with
  the athlete Planner, CI green, OTA published.
- **D — insights maturation.** Move the three untested Dashboard note rules
  into the engine.
- **E — widen the stored WHOOP row.**
