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

export interface HeartRateMonitor {
  /** Resolves once scanning has begun. Samples arrive on the callback. */
  start(onBpm: (bpm: number) => void): Promise<void>;
  stop(): void;
}

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

export function createHeartRateMonitor(): HeartRateMonitor {
  // Imported lazily: react-native-ble-plx needs a custom native build, and a
  // top-level import would crash Expo Go before the app could explain why.
  let manager: BleManagerLike | null = null;
  let stopped = false;

  return {
    async start(onBpm) {
      stopped = false;
      try {
        const { BleManager } = (await import('react-native-ble-plx')) as unknown as {
          BleManager: new () => BleManagerLike;
        };
        const m = new BleManager();
        manager = m;

        m.startDeviceScan([HR_SERVICE], null, async (err, device) => {
          if (err || !device || stopped) return;
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
          const conn = await d.connect();
          await conn.discoverAllServicesAndCharacteristics();
          conn.monitorCharacteristicForService(HR_SERVICE, HR_CHARACTERISTIC, (e, ch) => {
            if (e || !ch?.value || stopped) return;
            const bytes = base64Bytes(ch.value);
            if (bytes.length < 2) return;
            const flags = bytes[0];
            onBpm(flags & 1 ? bytes[1] | (bytes[2] << 8) : bytes[1]);
          });
        });
      } catch {
        // No BLE stack in this build (Expo Go), or Bluetooth is off. The
        // session runs on the clock and banks no zone time.
      }
    },
    stop() {
      stopped = true;
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

/**
 * The rest alarm. On the old app this was `AndroidHR.scheduleBuzz`, scheduled
 * natively precisely because a WebView's JS is throttled with the screen off —
 * a timer held in JS simply does not fire when the phone is in a pocket. A
 * scheduled notification is the equivalent that survives the same conditions.
 */
export async function scheduleRestAlarm(seconds: number): Promise<string | null> {
  try {
    const N = await import('expo-notifications');
    return await N.scheduleNotificationAsync({
      content: { title: 'Rest is up', body: 'Next set.', sound: true },
      trigger: { seconds: Math.max(1, Math.round(seconds)), channelId: 'rest' } as never,
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

/**
 * Steps from the phone's own pedometer. WHOOP's developer API exposes no step
 * data, so the on-device hardware counter is the free source — the same reason
 * the old app declared ACTIVITY_RECOGNITION.
 */
export async function stepsToday(): Promise<number | null> {
  try {
    const { Pedometer } = await import('expo-sensors');
    const ok = await Pedometer.isAvailableAsync();
    if (!ok) return null;
    const { status } = await Pedometer.requestPermissionsAsync();
    if (status !== 'granted') return null;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const res = await Pedometer.getStepCountAsync(start, new Date());
    return res?.steps ?? null;
  } catch {
    return null;
  }
}

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
 * already photographed by the time someone thinks to import it. Null on
 * cancel, on a denied permission, or on a build without expo-image-picker.
 */
async function pickImageUri(): Promise<string | null> {
  try {
    // @ts-ignore — optional dependency, not yet in package.json.
    const P = (await import('expo-image-picker')) as {
      requestMediaLibraryPermissionsAsync(): Promise<{ granted: boolean }>;
      launchImageLibraryAsync(opts: {
        quality?: number;
        allowsMultipleSelection?: boolean;
      }): Promise<{ canceled: boolean; assets?: { uri: string }[] | null }>;
    };
    const perm = await P.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return null;
    const res = await P.launchImageLibraryAsync({ quality: 1, allowsMultipleSelection: false });
    if (res.canceled) return null;
    return res.assets?.[0]?.uri ?? null;
  } catch {
    return null;
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
  const uri = imageUri || (await pickImageUri());
  if (!uri) return null;
  try {
    // @ts-ignore — optional dependency: not yet in package.json, so TS cannot
    // resolve the specifier. Deliberately @ts-ignore and not @ts-expect-error,
    // which would itself become an error the day the package is installed.
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

    // @ts-ignore — optional dependency, see recogniseText above.
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
