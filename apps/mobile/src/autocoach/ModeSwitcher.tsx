import { useState } from 'react';
import { View } from 'react-native';
import type { AutonomyPolicy } from '@hybrid/auto-coach';
import { Btn, Card, Kicker, T, Tap } from '../ui';
import {
  allComprehensionCorrect,
  COMPREHENSION_STATEMENTS,
  CONSENT_TEXT_VERSION,
  highestAllowedMode,
  recordComprehensionPassed,
  recordConsent,
  useConsent,
} from './consent';
import { updatePolicy, usePolicy } from './policy';

/**
 * Where the athlete changes Auto-Coached mode on mobile, ported from
 * apps/web/src/autocoach/ModeSwitcher.tsx. Forward movement (shadow →
 * assisted → auto_daily) is gated by consent — a comprehension check the
 * first time, a shorter one-sentence consent the second. Backward movement
 * and pausing need neither.
 */

const MODE_LABEL: Record<AutonomyPolicy['mode'], string> = {
  shadow: 'Shadow',
  assisted: 'Assisted',
  auto_daily: 'Auto-Coached Daily',
};

const MODE_DESCRIPTION: Record<AutonomyPolicy['mode'], string> = {
  shadow: 'Shows what it would do. Nothing is ever applied.',
  assisted: 'Proposes changes to today. You confirm before anything applies.',
  auto_daily:
    'Suggests permitted changes to today automatically — nothing applies until you approve it. Review stays available; pause is one tap.',
};

type Stage = 'idle' | 'explain' | 'quiz' | 'autoApplyConsent';

export function ModeSwitcher() {
  const policy = usePolicy();
  const consent = useConsent();
  const [stage, setStage] = useState<Stage>('idle');
  const [answers, setAnswers] = useState<(boolean | null)[]>(() =>
    Array(COMPREHENSION_STATEMENTS.length).fill(null),
  );
  const [showRetry, setShowRetry] = useState(false);

  const resetQuiz = () => {
    setAnswers(Array(COMPREHENSION_STATEMENTS.length).fill(null));
    setShowRetry(false);
  };

  const cancel = () => {
    setStage('idle');
    resetQuiz();
  };

  const submitQuiz = () => {
    if (allComprehensionCorrect(answers)) {
      recordComprehensionPassed(true);
      recordConsent('proposals', true);
      updatePolicy((p) => ({ ...p, mode: 'assisted' }));
      setStage('idle');
      resetQuiz();
    } else {
      setShowRetry(true);
    }
  };

  const acceptAutoApply = () => {
    recordConsent('autoApply', true);
    updatePolicy((p) => ({ ...p, mode: 'auto_daily' }));
    setStage('idle');
  };

  const revokeProposals = () => {
    recordConsent('proposals', false);
    updatePolicy((p) => ({
      ...p,
      mode: highestAllowedMode({
        proposalsConsent: { accepted: false, at: Date.now(), textVersion: CONSENT_TEXT_VERSION },
        autoApplyConsent: consent.autoApplyConsent,
      }),
    }));
  };

  const revokeAutoApply = () => {
    recordConsent('autoApply', false);
    updatePolicy((p) => ({
      ...p,
      mode: highestAllowedMode({
        proposalsConsent: consent.proposalsConsent,
        autoApplyConsent: { accepted: false, at: Date.now(), textVersion: CONSENT_TEXT_VERSION },
      }),
    }));
  };

  const allAnswered = answers.every((a) => a !== null);

  return (
    <Card tone={stage === 'idle' ? 'quiet' : undefined}>
      <View className="flex-row items-baseline gap-1">
        <Kicker>Auto-Coached mode</Kicker>
        <T w="bold" className="ml-auto text-3 text-gold2">{MODE_LABEL[policy.mode]}</T>
      </View>
      <T className="mt-1 text-3 text-muted">{MODE_DESCRIPTION[policy.mode]}</T>

      {stage === 'idle' && (
        <View className="mt-1 flex-row flex-wrap items-center gap-1">
          {policy.mode === 'shadow' && (
            <Btn variant="brass" onPress={() => setStage('explain')}>
              Turn on Assisted
            </Btn>
          )}
          {policy.mode === 'assisted' && (
            <>
              <Btn variant="ghost" onPress={() => updatePolicy((p) => ({ ...p, mode: 'shadow' }))}>
                Back to Shadow
              </Btn>
              <Btn variant="brass" onPress={() => setStage('autoApplyConsent')}>
                Turn on Auto-Coached Daily
              </Btn>
            </>
          )}
          {policy.mode === 'auto_daily' && (
            <Btn variant="ghost" onPress={() => updatePolicy((p) => ({ ...p, mode: 'assisted' }))}>
              Back to Assisted
            </Btn>
          )}
        </View>
      )}

      {stage === 'explain' && (
        <View className="mt-1 rounded-md border border-line bg-well p-1.5">
          <T className="text-3 text-text">
            · It can make small changes to today's session, like capping intensity or trimming
            conditioning minutes, when your check-in supports it.
          </T>
          <T className="mt-0.5 text-3 text-text">
            · It cannot diagnose anything, override a safety flag, or change your long-term goal.
          </T>
          <T className="mt-0.5 text-3 text-text">
            · You choose what it's allowed to touch, and you can pause it any time from the receipt.
          </T>
          <View className="mt-1 flex-row items-center gap-1">
            <Tap onPress={cancel}>
              <T className="text-3 text-dim underline">Cancel</T>
            </Tap>
            <Btn variant="brass" className="ml-auto" onPress={() => setStage('quiz')}>
              Continue
            </Btn>
          </View>
        </View>
      )}

      {stage === 'quiz' && (
        <View className="mt-1 rounded-md border border-line bg-well p-1.5">
          <T className="text-3 text-dim">Quick check — true or false.</T>
          {COMPREHENSION_STATEMENTS.map((s, i) => (
            <View key={i} className="mt-1 flex-row flex-wrap items-center gap-1">
              <T className="text-3 text-text">{s.text}</T>
              {([true, false] as const).map((v) => (
                <Tap
                  key={String(v)}
                  onPress={() => setAnswers((cur) => cur.map((a, ai) => (ai === i ? v : a)))}
                  className={`rounded-pill border px-1 py-0.5 ${
                    answers[i] === v ? 'border-gold-line' : 'border-line'
                  }`}
                >
                  <T className={`text-3 ${answers[i] === v ? 'text-gold2' : 'text-muted'}`}>
                    {v ? 'True' : 'False'}
                  </T>
                </Tap>
              ))}
            </View>
          ))}
          {showRetry && <T className="mt-1 text-3 text-warn">Not quite — let's go over that again.</T>}
          <View className="mt-1 flex-row items-center gap-1">
            <Tap onPress={cancel}>
              <T className="text-3 text-dim underline">Cancel</T>
            </Tap>
            <Btn variant="brass" className="ml-auto" onPress={submitQuiz} disabled={!allAnswered}>
              Submit
            </Btn>
          </View>
        </View>
      )}

      {stage === 'autoApplyConsent' && (
        <View className="mt-1 rounded-md border border-line bg-well p-1.5">
          <T className="text-3 text-text">
            Permitted changes will be suggested for today's session and applied only once you
            approve them — review is always available, and pausing is one tap.
          </T>
          <View className="mt-1 flex-row items-center gap-1">
            <Tap onPress={cancel}>
              <T className="text-3 text-dim underline">Cancel</T>
            </Tap>
            <Btn variant="brass" className="ml-auto" onPress={acceptAutoApply}>
              Agree and turn on
            </Btn>
          </View>
        </View>
      )}

      {(consent.proposalsConsent?.accepted || consent.autoApplyConsent?.accepted) && (
        <View className="mt-1 flex-row flex-wrap items-center gap-1 border-t border-line pt-1">
          <T className="text-2 uppercase tracking-wide text-dim">Consent</T>
          {consent.proposalsConsent?.accepted && (
            <Tap onPress={revokeProposals}>
              <T className="text-3 text-dim underline">Revoke reading & proposing</T>
            </Tap>
          )}
          {consent.autoApplyConsent?.accepted && (
            <Tap onPress={revokeAutoApply}>
              <T className="text-3 text-dim underline">Revoke automatic application</T>
            </Tap>
          )}
        </View>
      )}
    </Card>
  );
}
