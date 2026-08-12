/*
 * What has to be faked before a screen will mount in node.
 *
 * Everything mocked here is a NATIVE module — a real binary that exists only on
 * a device. None of it is app logic, and nothing here changes a decision the
 * app makes; a mock that altered behaviour would make these tests pass against
 * an app that does not exist.
 */
import '@testing-library/react-native';

/* MMKV is a JSI module: no device, no `NativeModules.MMKV`, and the store
   throws on construction rather than on first use. The engine's Storage port is
   deliberately a plain synchronous interface, so an in-memory Map satisfies it
   exactly — this is the same shim the app itself falls back to in Expo Go. */
jest.mock('react-native-mmkv', () => {
  class MMKV {
    private m = new Map<string, string>();
    getString(k: string) {
      return this.m.get(k);
    }
    set(k: string, v: string) {
      this.m.set(k, String(v));
    }
    delete(k: string) {
      this.m.delete(k);
    }
    getAllKeys() {
      return Array.from(this.m.keys());
    }
  }
  return { MMKV };
});

/* BLE needs a radio. The monitor is never started in these tests; this only
   stops the import throwing while the module graph is built. */
jest.mock('react-native-ble-plx', () => ({
  BleManager: class {
    state() {
      return Promise.resolve('PoweredOff');
    }
    startDeviceScan() {}
    stopDeviceScan() {}
    destroy() {}
  },
  ScanMode: { LowLatency: 2 },
}));

jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn(async () => {}),
  deactivateKeepAwake: jest.fn(async () => {}),
}));

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  scheduleNotificationAsync: jest.fn(async () => 'notif-id'),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  setNotificationChannelAsync: jest.fn(async () => {}),
  AndroidImportance: { HIGH: 4 },
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
}));

/*
 * The camera is a CameraX surface and a permission the OS owns; neither exists
 * in node. `CameraView` becomes an inert host view carrying its props, and the
 * permission hook is driven per test.
 *
 * This mock decides NOTHING the app decides. The scanner's own logic — one
 * scan per code, found vs missing vs unreachable, which permission state gets
 * which button — runs unmocked against it; only the native surface is faked.
 *
 * The permission is settable per test through the mocked module itself —
 * `jest.requireMock('expo-camera').__setPermission(...)` — rather than through
 * an export of this file, because jest hoists the factory above everything
 * here and a factory may not close over this module's bindings.
 */
jest.mock('expo-camera', () => {
  const GRANTED = { granted: true, canAskAgain: true, status: 'granted' };
  let permission: { granted: boolean; canAskAgain: boolean; status: string } | null = GRANTED;
  const request = jest.fn(async () => permission);
  return {
    /* A host view carrying its props — so `onBarcodeScanned` is readable off
       the rendered node, which is how a test fires a frame — plus a shutter on
       the ref, which is how the label reader takes the photo it recognises.
       Built in a plain sibling file because NativeWind's babel plugin rewrites
       JSX and `React.createElement` into its own interop call, and a
       `jest.mock` factory may not reference that module-level import. */
    CameraView: require('./camera-view-mock').CameraViewMock,
    useCameraPermissions: () => [permission, request, request],
    /** Test-only. Drive `takePictureAsync`: a different photo, or a throw. */
    __setShutter: require('./camera-view-mock').__setShutter,
    __resetShutter: require('./camera-view-mock').__resetShutter,
    __photo: require('./camera-view-mock').PHOTO,
    /** Test-only. Null models the frame before the OS has answered. */
    __setPermission: (p: typeof permission) => {
      permission = p;
    },
    __resetPermission: () => {
      permission = GRANTED;
    },
    __request: request,
  };
});

/*
 * ML Kit text recognition needs the ML Kit .aar and a device.
 *
 * `expo-mlkit-ocr` resolves its native module at IMPORT time
 * (`requireNativeModule('ExpoMlkitOcr')`), so merely loading it in node throws.
 * The app already guards that — the label reader imports it dynamically, inside
 * the try that falls back to typed entry — and this is the belt to that braces:
 * it stops an accidental static import anywhere from taking the whole suite
 * down instead of failing the one test that added it.
 *
 * It resolves nothing, on purpose. Every OCR test injects its own recogniser,
 * so a mock that quietly returned plausible blocks would be a second, invisible
 * source of test data.
 */
jest.mock('expo-mlkit-ocr', () => ({
  isSupported: () => false,
  recognizeText: jest.fn(async () => {
    throw new Error('expo-mlkit-ocr: no native module in node — inject a recogniser in the test.');
  }),
}));

/* Supabase would open a real socket on import. Sync and WHOOP are not under
   test here; both providers degrade to "signed out" when the client is null,
   which is the state these tests want anyway. */
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => null,
}));

/* Silences the RN animation-frame warning that fires when a test unmounts
   while a navigation transition is still scheduled. */
jest.useFakeTimers({ doNotFake: ['nextTick'] });
