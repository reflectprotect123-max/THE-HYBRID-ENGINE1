import { PermissionsAndroid, Platform, Vibration } from 'react-native';
import type { GeoSample } from '@hybrid/engine';

/*
 * The native bridges, re-implemented.
 *
 * The old Android app was a WebView with `@JavascriptInterface` objects hung on
 * `window`. Everything the web app could do natively went through those. This
 * module is the replacement surface: real React Native modules, and a shape the
 * engine can consume without knowing which platform it is on.
 *
 * Every function degrades rather than throws. A missing strap, a denied
 * permission or an unsupported device must leave the athlete with a session
 * that still runs on the clock — never a crash mid-workout.
 */

/**
 * The states the old `conNativeState` callback reported into the page. Kept
 * verbatim: a screen that cannot tell "scanning" from "Bluetooth permission
 * refused" can only ever print "no strap", which is what the first port did.
 */
export type HrState = 'scanning' | 'connected' | 'error';

export interface HeartRateMonitor {
  /**
   * Resolves once scanning has begun — or, on a failure, once `onState` has
   * been told why it did not. Samples arrive on `onBpm`.
   */
  start(onBpm: (bpm: number) => void, onState?: (state: HrState, msg: string) => void): Promise<void>;
  stop(): void;
}

export type GeoState = 'tracking' | 'error';

export interface GeoTracker {
  /**
   * Resolves once tracking has begun — or, on a failure, once `onState` has
   * been told why it did not. Samples arrive on `onSample`. Degrades like
   * the HR monitor: a denied permission means no samples, never a thrown
   * error mid-session.
   */
  start(onSample: (s: GeoSample) => void, onState?: (state: GeoState, msg: string) => void): Promise<void>;
  stop(): void;
}

/** How long to look before admitting nothing is broadcasting. MainActivity used 6s. */
const SCAN_MS = 6000;

/**
 * Standard BLE Heart Rate service. The measurement characteristic's first byte
 * is a flags byte whose low bit says whether the value that follows is 8- or
 * 16-bit; reading it as the wrong width silently corrupts every beat above 255
 * and, worse, most beats below it.
 */
const HR_SERVICE = '0000180d-0000-1000-8000-00805f9b34fb';
const HR_CHARACTERISTIC = '00002a37-0000-1000-8000-00805f9b34fb';

/* The slice of react-native-ble-plx this file uses. Declared locally so the
   module can be imported lazily without dragging its types in eagerly. */
interface BleManagerLike {
  destroy(): void;
  startDeviceScan(uuids: string[] | null, opts: unknown, cb: (err: unknown, device: unknown) => void): void;
  stopDeviceScan(): void;
}

/**
 * Ask for the permissions a BLE scan needs, in the same split MainActivity used
 * (`neededPerms()`): from Android 12 the two Bluetooth runtime permissions,
 * before it ACCESS_FINE_LOCATION, because a scan counted as a location
 * capability then.
 *
 * react-native-ble-plx does NOT request these itself — it only fails the scan.
 * Without this the strap never connects on any modern phone and the only symptom
 * is a dash where the heart rate should be.
 */
async function ensureBlePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const perms =
    Number(Platform.Version) >= 31
      ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const res = await PermissionsAndroid.requestMultiple(perms);
  return perms.every((p) => res[p] === PermissionsAndroid.RESULTS.GRANTED);
}

export function createHeartRateMonitor(): HeartRateMonitor {
  // Imported lazily: react-native-ble-plx needs a custom native build, and a
  // top-level import would crash Expo Go before the app could explain why.
  let manager: BleManagerLike | null = null;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    async start(onBpm, onState) {
      stopped = false;
      const say = (state: HrState, msg = '') => {
        if (!stopped) onState?.(state, msg);
      };
      try {
        if (!(await ensureBlePermissions())) {
          say('error', 'Bluetooth permission was refused — allow it to read your strap.');
          return;
        }

        const { BleManager } = (await import('react-native-ble-plx')) as unknown as {
          BleManager: new () => BleManagerLike;
        };
        const m = new BleManager();
        manager = m;
        say('scanning');

        // A scan that finds nothing never calls back at all, so the window is
        // closed here rather than left spinning for the whole session.
        timer = setTimeout(() => {
          if (stopped || !manager) return;
          try {
            m.stopDeviceScan();
          } catch {
            /* already stopped */
          }
          say(
            'error',
            'No heart-rate broadcast found. In the WHOOP app: Device Settings → HR Broadcast ON, then try again.',
          );
        }, SCAN_MS);

        m.startDeviceScan([HR_SERVICE], null, async (err, device) => {
          // The scan's own error arrives HERE — Bluetooth off, an unsupported
          // adapter, a permission the OS revoked mid-session. Swallowing it is
          // how a broken strap became indistinguishable from a missing one.
          if (err) {
            if (timer) clearTimeout(timer);
            console.warn('[ble]', err);
            say('error', 'Bluetooth scan failed — check that Bluetooth is on, then try again.');
            return;
          }
          if (!device || stopped) return;
          if (timer) clearTimeout(timer);
          m.stopDeviceScan();
          const d = device as {
            connect(): Promise<{
              discoverAllServicesAndCharacteristics(): Promise<unknown>;
              monitorCharacteristicForService(
                s: string,
                c: string,
                cb: (e: unknown, ch: { value?: string | null } | null) => void,
              ): void;
            }>;
          };
          try {
            const conn = await d.connect();
            await conn.discoverAllServicesAndCharacteristics();
            conn.monitorCharacteristicForService(HR_SERVICE, HR_CHARACTERISTIC, (e, ch) => {
              if (e || !ch?.value || stopped) return;
              const bytes = base64Bytes(ch.value);
              if (bytes.length < 2) return;
              const flags = bytes[0];
              // The wide form needs THREE bytes. Reading byte 2 out of a
              // two-byte packet yields undefined, and `undefined << 8` is 0 in
              // JS — silently right, until a strap sends a short packet with the
              // wide flag set and every beat reads back as the low byte alone.
              const bpm = flags & 1 ? (bytes.length >= 3 ? bytes[1] | (bytes[2] << 8) : bytes[1]) : bytes[1];
              if (bpm > 0) onBpm(bpm);
            });
            say('connected');
          } catch (e) {
            console.warn('[ble]', e);
            say('error', 'Could not connect to that strap — move closer and try again.');
          }
        });
      } catch {
        // No BLE stack in this build (Expo Go). The session runs on the clock
        // and banks no zone time — but say so rather than showing a dash.
        say('error', 'This build has no Bluetooth support — the session still runs on the clock.');
      }
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      try {
        manager?.stopDeviceScan();
        manager?.destroy();
      } catch {
        /* already gone */
      }
      manager = null;
    },
  };
}

/* ------------------------------------------------------------------ *
 * FTMS — the standard Fitness Machine Service a Rogue Echo Bike V3.0 console
 * broadcasts. Same BLE stack, same permission flow, same degrade-not-throw
 * policy as the heart-rate monitor above; only the service and the payload
 * differ. The parser is a byte-for-byte port of the web adapter
 * (apps/web/src/native/echoV3.ts) onto the plain number[] that base64Bytes
 * yields — there is no shared native/web code layer, so this duplication
 * matches how connectStrap/createHeartRateMonitor already coexist.
 * ------------------------------------------------------------------ */

export type FtmsState = 'scanning' | 'connected' | 'error';

/** One decoded FTMS Indoor Bike Data notification. Every field is flag-gated
 *  per notification — a frame that carries only cadence has no power in it,
 *  and the consumer must keep its own last-known values. */
export interface FtmsMetrics {
  flags: number;
  speed_kmh?: number;
  average_speed_kmh?: number;
  cadence_rpm?: number;
  average_cadence_rpm?: number;
  distance_m?: number;
  resistance_level?: number;
  power_w?: number;
  average_power_w?: number;
  calories_total?: number;
  calories_per_hour?: number;
  calories_per_minute?: number;
  heart_rate_bpm?: number;
  metabolic_equivalent?: number;
  elapsed_s?: number;
  remaining_s?: number;
}

export interface FtmsMonitor {
  /**
   * Resolves once scanning has begun — or, on a failure, once `onState` has
   * been told why it did not. Decoded notifications arrive on `onEvent`.
   */
  start(onEvent: (m: FtmsMetrics) => void, onState?: (state: FtmsState, msg: string) => void): Promise<void>;
  stop(): void;
}

/** FTMS service (0x1826) and its Indoor Bike Data characteristic (0x2AD2) —
 *  from the Echo V3 capability registry, identical to the web adapter. */
const FTMS_SERVICE = '00001826-0000-1000-8000-00805f9b34fb';
const FTMS_INDOOR_BIKE_DATA = '00002ad2-0000-1000-8000-00805f9b34fb';

/**
 * Decode one FTMS Indoor Bike Data notification.
 *
 * The field order is fixed and every offset depends on EVERY preceding flag
 * being decoded in order — skipping a field this app doesn't display would
 * misalign everything after it, which is why the walk is complete even though
 * the screen only surfaces power, cadence and distance. Bit 0 is inverted:
 * instantaneous speed is present when the bit is CLEAR. All multi-byte fields
 * are little-endian. Throws RangeError on a truncated frame, exactly like the
 * web parser; the monitor's notification handler catches and drops those.
 */
export function parseIndoorBikeData(bytes: number[]): FtmsMetrics {
  const need = (offset: number, size: number, field: string) => {
    if (offset + size > bytes.length) {
      throw new RangeError(`Truncated FTMS Indoor Bike Data before ${field}`);
    }
  };
  const readU8 = (o: number, field: string) => {
    need(o, 1, field);
    return bytes[o];
  };
  const readU16 = (o: number, field: string) => {
    need(o, 2, field);
    return bytes[o] | (bytes[o + 1] << 8);
  };
  // Sign-extended: resistance and power are sint16 in the spec.
  const readI16 = (o: number, field: string) => (readU16(o, field) << 16) >> 16;
  const readU24 = (o: number, field: string) => {
    need(o, 3, field);
    return bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16);
  };

  const flags = readU16(0, 'flags');
  let offset = 2;
  const result: FtmsMetrics = { flags };

  if ((flags & 0x0001) === 0) {
    result.speed_kmh = readU16(offset, 'instantaneous speed') * 0.01;
    offset += 2;
  }
  if (flags & 0x0002) {
    result.average_speed_kmh = readU16(offset, 'average speed') * 0.01;
    offset += 2;
  }
  if (flags & 0x0004) {
    result.cadence_rpm = readU16(offset, 'instantaneous cadence') * 0.5;
    offset += 2;
  }
  if (flags & 0x0008) {
    result.average_cadence_rpm = readU16(offset, 'average cadence') * 0.5;
    offset += 2;
  }
  if (flags & 0x0010) {
    result.distance_m = readU24(offset, 'total distance');
    offset += 3;
  }
  if (flags & 0x0020) {
    result.resistance_level = readI16(offset, 'resistance level');
    offset += 2;
  }
  if (flags & 0x0040) {
    result.power_w = readI16(offset, 'instantaneous power');
    offset += 2;
  }
  if (flags & 0x0080) {
    result.average_power_w = readI16(offset, 'average power');
    offset += 2;
  }
  if (flags & 0x0100) {
    result.calories_total = readU16(offset, 'total energy');
    offset += 2;
    result.calories_per_hour = readU16(offset, 'energy per hour');
    offset += 2;
    result.calories_per_minute = readU8(offset, 'energy per minute');
    offset += 1;
  }
  if (flags & 0x0200) {
    result.heart_rate_bpm = readU8(offset, 'heart rate');
    offset += 1;
  }
  if (flags & 0x0400) {
    result.metabolic_equivalent = readU8(offset, 'metabolic equivalent') * 0.1;
    offset += 1;
  }
  if (flags & 0x0800) {
    result.elapsed_s = readU16(offset, 'elapsed time');
    offset += 2;
  }
  if (flags & 0x1000) {
    result.remaining_s = readU16(offset, 'remaining time');
  }

  return result;
}

export function createFtmsMonitor(): FtmsMonitor {
  // Imported lazily for the same reason as the heart-rate monitor: a build
  // without native BLE (Expo Go) must degrade into the error callback, not
  // crash on load.
  let manager: BleManagerLike | null = null;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    async start(onEvent, onState) {
      stopped = false;
      const say = (state: FtmsState, msg = '') => {
        if (!stopped) onState?.(state, msg);
      };
      try {
        if (!(await ensureBlePermissions())) {
          say('error', 'Bluetooth permission was refused — allow it to read the bike.');
          return;
        }

        const { BleManager } = (await import('react-native-ble-plx')) as unknown as {
          BleManager: new () => BleManagerLike;
        };
        const m = new BleManager();
        manager = m;
        say('scanning');

        // A scan that finds nothing never calls back at all, so the window is
        // closed here rather than left spinning for the whole session.
        timer = setTimeout(() => {
          if (stopped || !manager) return;
          try {
            m.stopDeviceScan();
          } catch {
            /* already stopped */
          }
          say('error', 'No Echo Bike found. Wake the console (start pedalling), then try again.');
        }, SCAN_MS);

        m.startDeviceScan([FTMS_SERVICE], null, async (err, device) => {
          if (err) {
            if (timer) clearTimeout(timer);
            console.warn('[ble]', err);
            say('error', 'Bluetooth scan failed — check that Bluetooth is on, then try again.');
            return;
          }
          if (!device || stopped) return;
          if (timer) clearTimeout(timer);
          m.stopDeviceScan();
          const d = device as {
            connect(): Promise<{
              discoverAllServicesAndCharacteristics(): Promise<unknown>;
              monitorCharacteristicForService(
                s: string,
                c: string,
                cb: (e: unknown, ch: { value?: string | null } | null) => void,
              ): void;
            }>;
          };
          try {
            const conn = await d.connect();
            await conn.discoverAllServicesAndCharacteristics();
            conn.monitorCharacteristicForService(FTMS_SERVICE, FTMS_INDOOR_BIKE_DATA, (e, ch) => {
              if (e || !ch?.value || stopped) return;
              try {
                onEvent(parseIndoorBikeData(base64Bytes(ch.value)));
              } catch {
                /* a truncated or malformed frame — drop it, keep streaming */
              }
            });
            say('connected');
          } catch (e) {
            console.warn('[ble]', e);
            say('error', 'Could not connect to that bike — move closer and try again.');
          }
        });
      } catch {
        // No BLE stack in this build (Expo Go). The session runs on the clock
        // and banks no bike telemetry — but say so rather than showing nothing.
        say('error', 'This build has no Bluetooth support — the session still runs on the clock.');
      }
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      try {
        manager?.stopDeviceScan();
        manager?.destroy();
      } catch {
        /* already gone */
      }
      manager = null;
    },
  };
}

function base64Bytes(b64: string): number[] {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = b64.replace(/=+$/, '');
  const out: number[] = [];
  let bits = 0;
  let acc = 0;
  for (const c of clean) {
    const i = chars.indexOf(c);
    if (i < 0) continue;
    acc = (acc << 6) | i;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * The rest alarm. On the old app this was `AndroidHR.scheduleBuzz`, scheduled
 * natively precisely because a WebView's JS is throttled with the screen off —
 * a timer held in JS simply does not fire when the phone is in a pocket. A
 * scheduled notification is the equivalent that survives the same conditions.
 * ------------------------------------------------------------------ */

let restChannelReady: Promise<boolean> | null = null;

/**
 * One-time notification setup, done lazily so a build without the module still
 * boots. Three things have to be true before a scheduled rest alarm is
 * ANYTHING more than a no-op, and none of them are defaults:
 *
 *  1. POST_NOTIFICATIONS must be granted (Android 13+). Unasked, every
 *     notification is dropped by the OS without an error.
 *  2. The 'rest' channel must EXIST. Android 8+ discards a notification posted
 *     to an unknown channel.
 *  3. A notification handler must be set. expo-notifications' documented
 *     default when no handler is installed is NOT to show the notification —
 *     and the app being in the foreground is the normal case for a rest timer.
 */
async function prepareNotifications(): Promise<boolean> {
  if (!restChannelReady) {
    restChannelReady = (async () => {
      try {
        const N = await import('expo-notifications');
        N.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowBanner: true,
            shouldShowList: true,
            shouldPlaySound: true,
            shouldSetBadge: false,
          }),
        });
        if (Platform.OS === 'android') {
          await N.setNotificationChannelAsync('rest', {
            name: 'Rest timer',
            importance: N.AndroidImportance.HIGH,
            vibrationPattern: [0, 200, 120, 200],
            sound: 'default',
          });
        }
        const cur = await N.getPermissionsAsync();
        if (cur.granted) return true;
        const asked = await N.requestPermissionsAsync();
        return asked.granted;
      } catch {
        return false;
      }
    })();
  }
  return restChannelReady;
}

export async function scheduleRestAlarm(seconds: number): Promise<string | null> {
  try {
    if (!(await prepareNotifications())) return null;
    const N = await import('expo-notifications');
    return await N.scheduleNotificationAsync({
      content: { title: 'Rest is up', body: 'Next set.', sound: true },
      // `type` is not optional. Without it the trigger falls through every
      // schedulable branch and lands on the Android channel trigger, which is
      // "post this NOW on that channel" — the alarm fired the instant the rest
      // started instead of at the end of it.
      trigger: {
        type: N.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: Math.max(1, Math.round(seconds)),
        repeats: false,
        channelId: 'rest',
      },
    });
  } catch {
    return null;
  }
}

export async function cancelRestAlarm(id: string | null): Promise<void> {
  if (!id) return;
  try {
    const N = await import('expo-notifications');
    await N.cancelScheduledNotificationAsync(id);
  } catch {
    /* nothing scheduled */
  }
}

export function buzz(): void {
  try {
    Vibration.vibrate(Platform.OS === 'android' ? [0, 200, 100, 200] : 400);
  } catch {
    /* no vibrator */
  }
}

/** Keeps the screen on during a live session. Was AndroidHR.keepAwake. */
export async function setKeepAwake(on: boolean): Promise<void> {
  try {
    const K = await import('expo-keep-awake');
    if (on) await K.activateKeepAwakeAsync('session');
    else K.deactivateKeepAwake('session');
  } catch {
    /* not available */
  }
}

const GEO_TASK = 'hybrid-geo-tracking';
let taskRegistered = false;

/**
 * Foreground permission first, background only if the athlete accepts it —
 * both platforms gate background location behind a second, explicit prompt,
 * and bundling the two into one ask is the surest way to get both denied.
 */
async function ensureLocationPermissions(): Promise<{ foreground: boolean; background: boolean }> {
  const Location = await import('expo-location');
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) return { foreground: false, background: false };
  const bg = await Location.requestBackgroundPermissionsAsync();
  return { foreground: true, background: bg.granted };
}

export function createGeoTracker(): GeoTracker {
  let stopped = false;
  let onSampleRef: ((s: GeoSample) => void) | null = null;
  let startedAt = 0;
  let subscription: { remove(): void } | null = null;

  return {
    async start(onSample, onState) {
      stopped = false;
      onSampleRef = onSample;
      startedAt = Date.now();
      const say = (state: GeoState, msg = '') => {
        if (!stopped) onState?.(state, msg);
      };
      try {
        const perms = await ensureLocationPermissions();
        if (!perms.foreground) {
          say('error', 'Location permission was refused — the route and distance will not be recorded.');
          return;
        }

        const Location = await import('expo-location');
        const TaskManager = await import('expo-task-manager');

        if (!taskRegistered && !TaskManager.isTaskDefined(GEO_TASK)) {
          TaskManager.defineTask(GEO_TASK, async ({ data, error }: { data?: unknown; error?: unknown }) => {
            if (error || !data) return;
            const { locations } = data as { locations: { coords: { latitude: number; longitude: number }; timestamp: number }[] };
            locations.forEach((loc) => {
              onSampleRef?.({
                t: Math.floor((loc.timestamp - startedAt) / 1000),
                lat: loc.coords.latitude,
                lon: loc.coords.longitude,
              });
            });
          });
          taskRegistered = true;
        }

        if (perms.background) {
          await Location.startLocationUpdatesAsync(GEO_TASK, {
            accuracy: Location.Accuracy.BestForNavigation,
            timeInterval: 2000,
            distanceInterval: 0,
            foregroundService: {
              notificationTitle: 'Tracking your session',
              notificationBody: 'Recording your route and pace.',
            },
          });
        } else {
          subscription = await Location.watchPositionAsync(
            { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 2000, distanceInterval: 0 },
            (loc) => {
              onSampleRef?.({
                t: Math.floor((loc.timestamp - startedAt) / 1000),
                lat: loc.coords.latitude,
                lon: loc.coords.longitude,
              });
            },
          );
        }
        say('tracking');
      } catch (e) {
        console.warn('[gps]', e);
        say('error', 'GPS is not available right now — the run still counts by time and heart rate.');
      }
    },
    stop() {
      stopped = true;
      onSampleRef = null;
      try {
        subscription?.remove();
        subscription = null;
        void (async () => {
          const Location = await import('expo-location');
          const TaskManager = await import('expo-task-manager');
          if (await TaskManager.isTaskRegisteredAsync(GEO_TASK)) {
            await Location.stopLocationUpdatesAsync(GEO_TASK);
          }
        })();
      } catch {
        /* already stopped, or never started */
      }
    },
  };
}

/*
 * `stepsToday()` used to live here and has been REMOVED rather than fixed.
 *
 * It was the replacement for AndroidSteps, and it could not work: it was built
 * on `Pedometer.getStepCountAsync`, which is iOS-only — it is backed by
 * CMPedometer's historical query, and Android's TYPE_STEP_COUNTER has no
 * equivalent, so on the only platform this app ships to it returned null
 * unconditionally. Android's counter can only be SUBSCRIBED to
 * (`watchStepCount`), which counts from the moment you subscribe and would need
 * a foreground service plus its own persistence to add up to "today".
 *
 * That work was not done because nothing anywhere in the product consumes a
 * step count: no engine field, no screen in the athlete or coach app, no term
 * in any training calculation. Writing a foreground service to feed a number
 * nobody reads is worse than the honest absence. If steps ever earn a place in
 * the model, this is the note that says what implementing them actually costs.
 *
 * `expo-sensors` was the only dependency this needed, so it has been removed
 * from package.json along with it. Restoring steps means adding it back AND
 * writing the foreground service above.
 */
