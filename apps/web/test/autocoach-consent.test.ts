import { describe, expect, it } from 'vitest';
import {
  allComprehensionCorrect,
  COMPREHENSION_STATEMENTS,
  highestAllowedMode,
} from '../src/autocoach/consent';

const CORRECT: (boolean | null)[] = COMPREHENSION_STATEMENTS.map((s) => s.correct);

describe('allComprehensionCorrect', () => {
  it('passes when every answer matches', () => {
    expect(allComprehensionCorrect(CORRECT)).toBe(true);
  });

  it('fails when any single answer is wrong', () => {
    const wrong = [...CORRECT];
    wrong[1] = !wrong[1];
    expect(allComprehensionCorrect(wrong)).toBe(false);
  });

  it('fails when an answer is missing', () => {
    const missing = [...CORRECT];
    missing[3] = null;
    expect(allComprehensionCorrect(missing)).toBe(false);
  });

  it('fails on a mismatched answer count', () => {
    expect(allComprehensionCorrect(CORRECT.slice(0, 3))).toBe(false);
  });
});

describe('highestAllowedMode', () => {
  it('is shadow when proposals consent was never accepted', () => {
    expect(highestAllowedMode({ proposalsConsent: null, autoApplyConsent: null })).toBe('shadow');
  });

  it('is shadow when proposals consent is revoked, regardless of autoApply', () => {
    expect(
      highestAllowedMode({
        proposalsConsent: { accepted: false, at: 1, textVersion: 1 },
        autoApplyConsent: { accepted: true, at: 1, textVersion: 1 },
      }),
    ).toBe('shadow');
  });

  it('is assisted when proposals is accepted but autoApply is not', () => {
    expect(
      highestAllowedMode({
        proposalsConsent: { accepted: true, at: 1, textVersion: 1 },
        autoApplyConsent: null,
      }),
    ).toBe('assisted');
  });

  it('is assisted when autoApply consent is revoked after having been granted', () => {
    expect(
      highestAllowedMode({
        proposalsConsent: { accepted: true, at: 1, textVersion: 1 },
        autoApplyConsent: { accepted: false, at: 2, textVersion: 1 },
      }),
    ).toBe('assisted');
  });

  it('is auto_daily only when both consents are accepted', () => {
    expect(
      highestAllowedMode({
        proposalsConsent: { accepted: true, at: 1, textVersion: 1 },
        autoApplyConsent: { accepted: true, at: 1, textVersion: 1 },
      }),
    ).toBe('auto_daily');
  });
});
