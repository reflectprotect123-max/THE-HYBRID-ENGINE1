import { useState } from 'react';
import type { AutonomyPolicy } from '@hybrid/auto-coach';
import { Button, Card, Kicker, cx } from '../ui';
import {
  allComprehensionCorrect,
  COMPREHENSION_STATEMENTS,
  CONSENT_TEXT_VERSION,
  highestAllowedMode,
  recordComprehensionPassed,
  recordConsent,
  useConsent,
} from './consent';
import { updatePolicy, usePolicy } from '../store/policy';

/**
 * Where the athlete actually changes Auto-Coached mode. Forward movement
 * (shadow → assisted → auto_daily) is gated by consent — a comprehension
 * check the first time, a shorter one-sentence consent the second. Backward
 * movement and pausing need neither: nothing here should make it harder to
 * step down.
 */

const MODE_LABEL: Record<AutonomyPolicy['mode'], string> = {
  shadow: 'Shadow',
  assisted: 'Assisted',
  auto_daily: 'Auto-Coached Daily',
};

const MODE_DESCRIPTION: Record<AutonomyPolicy['mode'], string> = {
  shadow: 'Shows what it would do. Nothing is ever applied.',
  assisted: 'Proposes changes to today. You confirm before anything applies.',
  auto_daily: 'Suggests permitted changes to today automatically — nothing applies until you approve it. Review stays available; pause is one tap.',
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
    <Card tone={stage === 'idle' ? 'quiet' : undefined} className="flex flex-col gap-1">
      <div className="flex items-baseline gap-1">
        <Kicker>Auto-Coached mode</Kicker>
        <span className="ml-auto text-3 font-[650] text-gold2">{MODE_LABEL[policy.mode]}</span>
      </div>
      <p className="text-3 text-muted">{MODE_DESCRIPTION[policy.mode]}</p>

      {stage === 'idle' && (
        <div className="flex flex-wrap items-center gap-1">
          {policy.mode === 'shadow' && (
            <Button variant="brass" onClick={() => setStage('explain')}>
              Turn on Assisted
            </Button>
          )}
          {policy.mode === 'assisted' && (
            <>
              <Button variant="ghost" onClick={() => updatePolicy((p) => ({ ...p, mode: 'shadow' }))}>
                Back to Shadow
              </Button>
              <Button variant="brass" onClick={() => setStage('autoApplyConsent')}>
                Turn on Auto-Coached Daily
              </Button>
            </>
          )}
          {policy.mode === 'auto_daily' && (
            <Button variant="ghost" onClick={() => updatePolicy((p) => ({ ...p, mode: 'assisted' }))}>
              Back to Assisted
            </Button>
          )}
        </div>
      )}

      {stage === 'explain' && (
        <div className="flex flex-col gap-1 rounded-md border border-line bg-well p-1.5">
          <ul className="flex flex-col gap-0.5 text-3 text-text">
            <li>· It can make small changes to today’s session, like capping intensity or trimming conditioning minutes, when your check-in supports it.</li>
            <li>· It cannot diagnose anything, override a safety flag, or change your long-term goal.</li>
            <li>· You choose what it’s allowed to touch, and you can pause it any time from the receipt.</li>
          </ul>
          <div className="flex items-center gap-1">
            <button className="text-3 text-dim underline hover:text-text" onClick={cancel}>
              Cancel
            </button>
            <Button variant="brass" className="ml-auto" onClick={() => setStage('quiz')}>
              Continue
            </Button>
          </div>
        </div>
      )}

      {stage === 'quiz' && (
        <div className="flex flex-col gap-1 rounded-md border border-line bg-well p-1.5">
          <p className="text-3 text-dim">Quick check — true or false.</p>
          <ul className="flex flex-col gap-1">
            {COMPREHENSION_STATEMENTS.map((s, i) => (
              <li key={i} className="flex flex-wrap items-center gap-1">
                <span className="text-3 text-text">{s.text}</span>
                {([true, false] as const).map((v) => (
                  <button
                    key={String(v)}
                    onClick={() => setAnswers((cur) => cur.map((a, ai) => (ai === i ? v : a)))}
                    aria-pressed={answers[i] === v}
                    className={cx(
                      'rounded-full px-1 py-0.5 text-3 outline outline-1 transition-colors focus-visible:outline-2 focus-visible:outline-gold2 focus-visible:outline-offset-2',
                      answers[i] === v
                        ? 'text-gold2 outline-gold-line'
                        : 'text-muted outline-line hover:text-text',
                    )}
                  >
                    {v ? 'True' : 'False'}
                  </button>
                ))}
              </li>
            ))}
          </ul>
          {showRetry && (
            <p className="text-3 text-warn">Not quite — let’s go over that again.</p>
          )}
          <div className="flex items-center gap-1">
            <button className="text-3 text-dim underline hover:text-text" onClick={cancel}>
              Cancel
            </button>
            <Button variant="brass" className="ml-auto" onClick={submitQuiz} disabled={!allAnswered}>
              Submit
            </Button>
          </div>
        </div>
      )}

      {stage === 'autoApplyConsent' && (
        <div className="flex flex-col gap-1 rounded-md border border-line bg-well p-1.5">
          <p className="text-3 text-text">
            Permitted changes will be suggested for today’s session and applied only once you approve them — review is always available, and pausing is one tap.
          </p>
          <div className="flex items-center gap-1">
            <button className="text-3 text-dim underline hover:text-text" onClick={cancel}>
              Cancel
            </button>
            <Button variant="brass" className="ml-auto" onClick={acceptAutoApply}>
              Agree and turn on
            </Button>
          </div>
        </div>
      )}

      {(consent.proposalsConsent?.accepted || consent.autoApplyConsent?.accepted) && (
        <div className="mt-0.5 flex flex-wrap items-center gap-1 border-t border-line pt-1">
          <span className="text-2 uppercase tracking-wide text-dim">Consent</span>
          {consent.proposalsConsent?.accepted && (
            <button className="text-3 text-dim underline hover:text-text" onClick={revokeProposals}>
              Revoke reading &amp; proposing
            </button>
          )}
          {consent.autoApplyConsent?.accepted && (
            <button className="text-3 text-dim underline hover:text-text" onClick={revokeAutoApply}>
              Revoke automatic application
            </button>
          )}
        </div>
      )}
    </Card>
  );
}
