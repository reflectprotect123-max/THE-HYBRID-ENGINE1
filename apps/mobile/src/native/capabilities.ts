import { PermissionsAndroid, Platform, Vibration } from 'react-native';

/*
 * The four native bridges, re-implemented.
 *
 * The old Android app was a WebView with `@JavascriptInterface` objects hung on
 * `window` — AndroidHR, AndroidOCR, AndroidVoice, AndroidSteps. Everything the
 * web app could do natively went through those four. This module is the
 * replacement surface: same capabilities, real React Native modules, and a
 * shape the engine can consume without knowing which platform it is on.
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
            say('error', String((err as { message?: string })?.message || 'Bluetooth scan failed.'));
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
            say('error', String((e as Error)?.message || 'Could not connect to that strap.'));
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

/* ------------------------------------------------------------------ *
 * Text in, two ways.
 *
 * The old WebView had AndroidOCR.recognise and AndroidVoice.start/stop, both
 * of which handed the page a STRING. That is the whole contract, and it is
 * kept: everything that turns a string into workouts is `impParse` in
 * @hybrid/engine, shared with the web app and unit-tested there. Nothing in
 * this file parses, splits or guesses at meaning — the moment it did, the two
 * apps would drift and only one of them would be tested.
 * ------------------------------------------------------------------ */

/**
 * Ask the user for an image and return its local URI.
 *
 * The camera roll rather than the camera by default: a whiteboard is usually
 * already photographed by the time someone thinks to import it.
 *
 * `why` exists because a bare null conflated three different situations, and
 * the importer then told everyone their build was broken when they had simply
 * tapped cancel.
 */
export interface PickResult {
  uri: string | null;
  why: 'ok' | 'cancelled' | 'denied' | 'unavailable';
}

export async function pickImage(): Promise<PickResult> {
  try {
    const P = (await import('expo-image-picker')) as {
      requestMediaLibraryPermissionsAsync(): Promise<{ granted: boolean }>;
      launchImageLibraryAsync(opts: {
        quality?: number;
        allowsMultipleSelection?: boolean;
      }): Promise<{ canceled: boolean; assets?: { uri: string }[] | null }>;
    };
    const perm = await P.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return { uri: null, why: 'denied' };
    const res = await P.launchImageLibraryAsync({ quality: 1, allowsMultipleSelection: false });
    if (res.canceled) return { uri: null, why: 'cancelled' };
    const uri = res.assets?.[0]?.uri ?? null;
    return uri ? { uri, why: 'ok' } : { uri: null, why: 'cancelled' };
  } catch {
    return { uri: null, why: 'unavailable' };
  }
}

/**
 * Photograph-to-text, replacing AndroidOCR.
 *
 * ML Kit runs on-device: no upload, no key, works in a gym with no signal —
 * which is the point, since the alternative the web app falls back to is a
 * WASM Tesseract build that takes seconds a phone does not need to spend.
 *
 * `imageUri` is optional: called with one, that image is read; called with
 * nothing, the user is asked for a photo first. Both shapes exist because the
 * import screen owns neither the picker nor the model and should not have to.
 *
 * Returns null rather than throwing when a module is absent (Expo Go, or a
 * build made before the dependencies landed), when the user cancels, or when
 * the image simply has no legible text — so the caller can offer the manual
 * paste box instead of showing a crash.
 */
export async function recogniseText(imageUri?: string): Promise<string | null> {
  const uri = imageUri || (await pickImage()).uri;
  if (!uri) return null;
  try {
    const mod = (await import('@react-native-ml-kit/text-recognition')) as unknown as {
      default?: { recognize(uri: string): Promise<{ text?: string } | null> };
      recognize?: (uri: string) => Promise<{ text?: string } | null>;
    };
    const api = mod.default ?? (mod as { recognize?: (uri: string) => Promise<{ text?: string } | null> });
    if (!api?.recognize) return null;
    const res = await api.recognize(uri);
    const text = String(res?.text || '').trim();
    return text || null;
  } catch {
    // Not installed, unsupported device, or an unreadable URI. The importer's
    // paste box is always available, so this is a degradation and not a fault.
    return null;
  }
}

/* The slice of @react-native-voice/voice used here. Declared locally so the
   module stays a lazy import and its types are not required at build time. */
interface VoiceLike {
  onSpeechResults?: ((e: { value?: string[] }) => void) | null;
  onSpeechPartialResults?: ((e: { value?: string[] }) => void) | null;
  onSpeechError?: ((e: unknown) => void) | null;
  start(locale?: string): Promise<void>;
  stop(): Promise<void>;
  destroy(): Promise<void>;
  removeAllListeners(): void;
}

let voice: VoiceLike | null = null;

/**
 * Dictation, replacing AndroidVoice.
 *
 * `onText` is called with the recogniser's best transcript so far — partials
 * included, because a session dictated into a phone propped against a rack
 * needs to show something before the athlete stops talking. It is plain text
 * and stays plain text; `impParse` turns it into a workout.
 *
 * Resolves FALSE when dictation is unavailable — module missing, permission
 * denied, or no recogniser on the device — so the caller can fall back to the
 * keyboard rather than sit waiting for words that will never arrive. It never
 * throws.
 */
export async function startDictation(onText: (text: string) => void): Promise<boolean> {
  try {
    // Android will not surface a permission dialog from inside the recogniser;
    // asking first is the difference between a prompt and a silent failure.
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) return false;
    }

    const mod = (await import('@react-native-voice/voice')) as unknown as {
      default?: VoiceLike;
    };
    const v = (mod.default ?? (mod as unknown as VoiceLike)) || null;
    if (!v || typeof v.start !== 'function') return false;

    // A second start without a stop leaves two recognisers fighting over the
    // microphone and the older one's results arriving after the newer one's.
    await stopDictation();
    voice = v;

    const emit = (e: { value?: string[] }) => {
      const text = String(e?.value?.[0] || '').trim();
      if (text) onText(text);
    };
    v.onSpeechResults = emit;
    v.onSpeechPartialResults = emit;
    v.onSpeechError = () => {
      void stopDictation();
    };

    await v.start('en-US');
    return true;
  } catch {
    voice = null;
    return false;
  }
}

/** Always safe to call, including when dictation never started. */
export async function stopDictation(): Promise<void> {
  const v = voice;
  voice = null;
  if (!v) return;
  try {
    v.onSpeechResults = null;
    v.onSpeechPartialResults = null;
    v.onSpeechError = null;
    await v.stop();
    await v.destroy();
    v.removeAllListeners();
  } catch {
    /* the recogniser is already gone — the microphone is what matters and the
       OS releases it with the session either way */
  }
}
