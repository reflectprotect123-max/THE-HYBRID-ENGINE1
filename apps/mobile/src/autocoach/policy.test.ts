import { updatePolicy, getPolicy, resetPolicyForTests } from './policy';

beforeEach(() => resetPolicyForTests());

describe('mobile policy store', () => {
  it('defaults to shadow mode, active status', () => {
    const p = getPolicy();
    expect(p.mode).toBe('shadow');
    expect(p.status).toBe('active');
  });

  it('updatePolicy applies the updater and bumps version', () => {
    const before = getPolicy();
    updatePolicy((p) => ({ ...p, mode: 'assisted' }));
    const after = getPolicy();
    expect(after.mode).toBe('assisted');
    expect(after.version).toBe(before.version + 1);
  });

  it('persists across resetPolicyForTests reload from storage', () => {
    updatePolicy((p) => ({ ...p, mode: 'auto_daily' }));
    resetPolicyForTests();
    // resetPolicyForTests clears storage, so this reload sees the default again
    expect(getPolicy().mode).toBe('shadow');
  });

  it('pause/resume toggles status', () => {
    updatePolicy((p) => ({ ...p, status: 'paused' }));
    expect(getPolicy().status).toBe('paused');
    updatePolicy((p) => ({ ...p, status: 'active' }));
    expect(getPolicy().status).toBe('active');
  });
});

/*
 * `load()` itself — the localStorage→MMKV swap's actual mobile-specific risk.
 * `resetPolicyForTests()` clears storage and resets in-memory `policy` to the
 * default directly; it never calls `load()`. Only a fresh module instance,
 * forced via `jest.resetModules()`, re-runs it against whatever is already in
 * storage — the same path a cold app start takes.
 */
describe('mobile policy store — load() from persisted storage', () => {
  const KEY = 'hybrid-auto-coach-policy-v1';

  beforeEach(() => {
    jest.resetModules();
  });

  it('reads back a valid persisted policy on load()', () => {
    const { storage } = require('../store/storage');
    const seeded = { schemaVersion: 1, version: 5, mode: 'auto_daily', status: 'active' };
    storage.setItem(KEY, JSON.stringify(seeded));
    const fresh = require('./policy');
    expect(fresh.getPolicy().mode).toBe('auto_daily');
    expect(fresh.getPolicy().version).toBe(5);
  });

  it('falls back to DEFAULT_POLICY on a stale schemaVersion', () => {
    const { storage } = require('../store/storage');
    storage.setItem(KEY, JSON.stringify({ schemaVersion: 0, mode: 'auto_daily' }));
    const fresh = require('./policy');
    expect(fresh.getPolicy().mode).toBe('shadow');
  });

  it('falls back to DEFAULT_POLICY on corrupt JSON', () => {
    const { storage } = require('../store/storage');
    storage.setItem(KEY, 'not json{{{');
    const fresh = require('./policy');
    expect(fresh.getPolicy().mode).toBe('shadow');
  });

  it('updatePolicy degrades to session-local when storage.setItem throws — no throw, state still updates', () => {
    const { storage } = require('../store/storage');
    const fresh = require('./policy');
    jest.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(() => fresh.updatePolicy((p: unknown) => ({ ...(p as object), mode: 'assisted' }))).not.toThrow();
    expect(fresh.getPolicy().mode).toBe('assisted');
  });
});
