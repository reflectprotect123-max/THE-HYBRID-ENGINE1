import { Platform, Vibration } from 'react-native';

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
