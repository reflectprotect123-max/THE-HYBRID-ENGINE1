import {
  allComprehensionCorrect,
  COMPREHENSION_STATEMENTS,
  getConsent,
  highestAllowedMode,
  recordComprehensionPassed,
  recordConsent,
  resetConsentForTests,
} from './consent';

beforeEach(() => resetConsentForTests());

describe('mobile consent store', () => {
  it('starts with no consent recorded', () => {
    const c = getConsent();
    expect(c.proposalsConsent).toBeNull();
    expect(c.autoApplyConsent).toBeNull();
    expect(c.comprehensionPassed).toBe(false);
  });

  it('recordConsent("proposals", true) sets proposalsConsent, leaves autoApply alone', () => {
    recordConsent('proposals', true);
    const c = getConsent();
    expect(c.proposalsConsent?.accepted).toBe(true);
    expect(c.autoApplyConsent).toBeNull();
  });

  it('recordConsent bumps version', () => {
    const before = getConsent().version;
    recordConsent('proposals', true);
    expect(getConsent().version).toBe(before + 1);
  });

  it('recordComprehensionPassed sets the flag independent of consents', () => {
    recordComprehensionPassed(true);
    expect(getConsent().comprehensionPassed).toBe(true);
  });

  it('allComprehensionCorrect requires every answer to match, in order', () => {
    const allCorrect = COMPREHENSION_STATEMENTS.map((s) => s.correct);
    expect(allComprehensionCorrect(allCorrect)).toBe(true);
    const oneWrong = [...allCorrect];
    oneWrong[0] = !oneWrong[0];
    expect(allComprehensionCorrect(oneWrong)).toBe(false);
  });

  it('allComprehensionCorrect fails on a null (unanswered) entry', () => {
    const withNull = COMPREHENSION_STATEMENTS.map((s) => s.correct) as (boolean | null)[];
    withNull[2] = null;
    expect(allComprehensionCorrect(withNull)).toBe(false);
  });

  it('allComprehensionCorrect fails on wrong-length input', () => {
    expect(allComprehensionCorrect([true])).toBe(false);
  });

  it('highestAllowedMode: no proposals consent caps at shadow', () => {
    expect(highestAllowedMode({ proposalsConsent: null, autoApplyConsent: null })).toBe('shadow');
  });

  it('highestAllowedMode: proposals accepted but not autoApply caps at assisted', () => {
    expect(
      highestAllowedMode({
        proposalsConsent: { accepted: true, at: 1, textVersion: 1 },
        autoApplyConsent: null,
      }),
    ).toBe('assisted');
  });

  it('highestAllowedMode: both accepted allows auto_daily', () => {
    expect(
      highestAllowedMode({
        proposalsConsent: { accepted: true, at: 1, textVersion: 1 },
        autoApplyConsent: { accepted: true, at: 1, textVersion: 1 },
      }),
    ).toBe('auto_daily');
  });
});

/*
 * `load()` itself — the localStorage→MMKV swap's actual mobile-specific risk.
 * `resetConsentForTests()` clears storage and resets in-memory `consent`
 * directly; it never calls `load()`. Only a fresh module instance, forced via
 * `jest.resetModules()`, re-runs it against whatever is already in storage —
 * the same path a cold app start takes.
 */
describe('mobile consent store — load() from persisted storage', () => {
  const KEY = 'hybrid-auto-coach-consent-v1';

  beforeEach(() => {
    jest.resetModules();
  });

  it('reads back a valid persisted consent record on load()', () => {
    const { storage } = require('../store/storage');
    const seeded = {
      schemaVersion: 1,
      version: 3,
      proposalsConsent: { accepted: true, at: 1000, textVersion: 1 },
      autoApplyConsent: null,
      comprehensionPassed: true,
    };
    storage.setItem(KEY, JSON.stringify(seeded));
    const fresh = require('./consent');
    expect(fresh.getConsent().proposalsConsent?.accepted).toBe(true);
    expect(fresh.getConsent().comprehensionPassed).toBe(true);
  });

  it('falls back to DEFAULT_CONSENT on a stale schemaVersion', () => {
    const { storage } = require('../store/storage');
    storage.setItem(KEY, JSON.stringify({ schemaVersion: 0, comprehensionPassed: true }));
    const fresh = require('./consent');
    expect(fresh.getConsent().comprehensionPassed).toBe(false);
    expect(fresh.getConsent().proposalsConsent).toBeNull();
  });

  it('falls back to DEFAULT_CONSENT on corrupt JSON', () => {
    const { storage } = require('../store/storage');
    storage.setItem(KEY, '{{{not json');
    const fresh = require('./consent');
    expect(fresh.getConsent().proposalsConsent).toBeNull();
  });

  it('recordConsent degrades to session-local when storage.setItem throws — no throw, state still updates', () => {
    const { storage } = require('../store/storage');
    const fresh = require('./consent');
    jest.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(() => fresh.recordConsent('proposals', true)).not.toThrow();
    expect(fresh.getConsent().proposalsConsent?.accepted).toBe(true);
  });
});
