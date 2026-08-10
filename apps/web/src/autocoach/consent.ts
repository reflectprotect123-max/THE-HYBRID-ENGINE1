import { useSyncExternalStore } from 'react';
import type { AutonomyPolicy } from '@hybrid/auto-coach';

/**
 * Consent for Auto-Coached, scoped to what this repo actually has: a single
 * account, no coach-visibility split. Two consents only —
 *
 *  - proposalsConsent: Auto-Coached may read check-ins/state to PROPOSE
 *    changes (required to leave shadow for assisted).
 *  - autoApplyConsent: permitted changes are SUGGESTED automatically
 *    (required, additionally, for auto_daily).
 *
 * Additive store: its own localStorage key, same useSyncExternalStore shape
 * as policy.ts, never a field on EngineDB.
 */

export const CONSENT_SCHEMA_VERSION = 1 as const;

/** Bump when the consent copy changes materially, so a stale acceptance can
 * be told apart from one made against the current text. */
export const CONSENT_TEXT_VERSION = 2;

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
    const raw = localStorage.getItem(KEY);
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
    localStorage.setItem(KEY, JSON.stringify(consent));
  } catch {
    /* private mode — consent stays session-local */
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

/** Revocation keeps the record — only `accepted` flips, with a fresh
 * timestamp — so consent history is never deleted, only superseded. */
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

/** The five comprehension-check statements shown before proposals consent
 * can be recorded as accepted. Order is fixed so tests can address them by
 * index. */
export const COMPREHENSION_STATEMENTS: ComprehensionStatement[] = [
  { text: 'It can make small changes to today’s session.', correct: true },
  { text: 'It can diagnose an injury.', correct: false },
  { text: 'It can override a safety flag.', correct: false },
  { text: 'It changes your long-term goal without asking.', correct: false },
  { text: 'Material changes are shown before you train.', correct: true },
];

/** All five must be answered and every answer must match. A missing answer
 * (null) never counts as correct — this can never accidentally pass. */
export function allComprehensionCorrect(answers: (boolean | null)[]): boolean {
  if (answers.length !== COMPREHENSION_STATEMENTS.length) return false;
  return answers.every((a, i) => a === COMPREHENSION_STATEMENTS[i].correct);
}

/** The highest mode the athlete's current consent still supports. Used on
 * revocation to clamp mode downward — never to raise it; forward movement
 * always goes through the explicit consent gates in ModeSwitcher. */
export function highestAllowedMode(
  consentState: Pick<AutoCoachConsent, 'proposalsConsent' | 'autoApplyConsent'>,
): AutonomyPolicy['mode'] {
  if (!consentState.proposalsConsent?.accepted) return 'shadow';
  if (!consentState.autoApplyConsent?.accepted) return 'assisted';
  return 'auto_daily';
}
