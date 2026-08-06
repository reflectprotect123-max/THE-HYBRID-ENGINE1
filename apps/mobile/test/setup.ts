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

/* Supabase would open a real socket on import. Sync and WHOOP are not under
   test here; both providers degrade to "signed out" when the client is null,
   which is the state these tests want anyway. */
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => null,
}));

/* Silences the RN animation-frame warning that fires when a test unmounts
   while a navigation transition is still scheduled. */
jest.useFakeTimers({ doNotFake: ['nextTick'] });
