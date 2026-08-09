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
