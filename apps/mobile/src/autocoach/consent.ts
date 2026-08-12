import { useSyncExternalStore } from 'react';
import type { AutonomyPolicy } from '@hybrid/auto-coach';
import { storage } from '../store/storage';

/**
 * Consent for Auto-Coached, ported from apps/web's consent.ts. Two consents
 * only — proposalsConsent (required to leave shadow for assisted) and
 * autoApplyConsent (required, additionally, for auto_daily). Additive store:
 * its own storage key, same useSyncExternalStore shape as policy.ts, never
 * a field on EngineDB.
 */

export const CONSENT_SCHEMA_VERSION = 1 as const;

/** Bump when the consent copy changes materially, so a stale acceptance can
 * be told apart from one made against the current text. Kept in sync by
 * hand with apps/web/src/autocoach/consent.ts's CONSENT_TEXT_VERSION — the
 * two apps show independently-worded but equivalent consent copy, so this
 * is not required to match web's value, only to bump whenever THIS file's
 * copy changes. */
export const CONSENT_TEXT_VERSION = 1;

export interface ConsentRecord {
  accepted: boolean;
  at: number;
  textVersion: number;
}

export interface AutoCoachConsent {
  schemaVersion: typeof CONSENT_SCHEMA_VERSION;
  version: number;
  proposalsConsent: ConsentRecord | null;
  autoApplyConsent: ConsentRecord | null;
  comprehensionPassed: boolean;
}

export const DEFAULT_CONSENT: AutoCoachConsent = {
  schemaVersion: CONSENT_SCHEMA_VERSION,
  version: 1,
  proposalsConsent: null,
  autoApplyConsent: null,
  comprehensionPassed: false,
};

const KEY = 'hybrid-auto-coach-consent-v1';

let consent: AutoCoachConsent = load();
const listeners = new Set<() => void>();

function load(): AutoCoachConsent {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return DEFAULT_CONSENT;
    const parsed = JSON.parse(raw) as AutoCoachConsent;
    if (parsed?.schemaVersion !== 1) return DEFAULT_CONSENT;
    return { ...DEFAULT_CONSENT, ...parsed };
  } catch {
    return DEFAULT_CONSENT;
  }
}

function set(next: AutoCoachConsent): void {
  consent = { ...next, version: consent.version + 1 };
  try {
    storage.setItem(KEY, JSON.stringify(consent));
  } catch {
    /* storage write failed — consent stays session-local */
  }
  listeners.forEach((l) => l());
}

export function useConsent(): AutoCoachConsent {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => consent,
  );
}

/** Non-hook read, mirrors policy.ts's getPolicy() — needed outside render. */
export function getConsent(): AutoCoachConsent {
  return consent;
}

export function recordConsent(kind: 'proposals' | 'autoApply', accepted: boolean): void {
  const record: ConsentRecord = { accepted, at: Date.now(), textVersion: CONSENT_TEXT_VERSION };
  set({
    ...consent,
    proposalsConsent: kind === 'proposals' ? record : consent.proposalsConsent,
    autoApplyConsent: kind === 'autoApply' ? record : consent.autoApplyConsent,
  });
}

export function recordComprehensionPassed(passed: boolean): void {
  set({ ...consent, comprehensionPassed: passed });
}

/* ---------- pure logic, tested directly ---------- */

export interface ComprehensionStatement {
  text: string;
  correct: boolean;
}

/** Same five true/false statements as web's ModeSwitcher quiz, order fixed
 * so tests can address them by index. */
export const COMPREHENSION_STATEMENTS: ComprehensionStatement[] = [
  { text: "It can make small changes to today's session.", correct: true },
  { text: 'It can diagnose an injury.', correct: false },
  { text: 'It can override a safety flag.', correct: false },
  { text: "It changes your long-term goal without asking.", correct: false },
  { text: 'Material changes are shown before you train.', correct: true },
];

export function allComprehensionCorrect(answers: (boolean | null)[]): boolean {
  if (answers.length !== COMPREHENSION_STATEMENTS.length) return false;
  return answers.every((a, i) => a === COMPREHENSION_STATEMENTS[i].correct);
}

export function highestAllowedMode(
  consentState: Pick<AutoCoachConsent, 'proposalsConsent' | 'autoApplyConsent'>,
): AutonomyPolicy['mode'] {
  if (!consentState.proposalsConsent?.accepted) return 'shadow';
  if (!consentState.autoApplyConsent?.accepted) return 'assisted';
  return 'auto_daily';
}

export function resetConsentForTests(): void {
  try {
    storage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  consent = DEFAULT_CONSENT;
  listeners.clear();
}
