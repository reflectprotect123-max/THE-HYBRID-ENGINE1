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
