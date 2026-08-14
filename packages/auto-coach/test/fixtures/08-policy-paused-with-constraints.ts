import { strengthWorkout, snapshot, constraint, policy, type Fixture } from './helpers';

/**
 * REVERSED 14 August 2026. This vector used to assert the opposite, and the
 * old expectation is kept here rather than deleted because a golden vector
 * that quietly changes its mind is worse than no vector at all:
 *
 *     expected: { state: 'normal', reasonCodes: ['policy_paused'],
 *                 operationTypes: [], abstentionReason: 'policy_not_active' }
 *
 * It was written when the policy gate sat above the hard-safety gate in
 * `resolveSession`, so a paused policy returned before the constraints were
 * ever filtered. The consequence was only visible once a coach could publish
 * a week: an athlete with Auto-Coached paused and a live pain flag was told
 * "Today runs exactly as planned", saw no hold, and — because the held-receipt
 * producer keys off `state === 'safety_stop'` — their coach was never told the
 * session had been stopped either. It read to the coach as a skipped workout.
 *
 * The two gates now sit the other way round. Pausing still switches off every
 * adaptation below it; it no longer switches off the stop.
 */
export const policyPausedWithConstraints: Fixture = {
  name: "policy status: 'paused' with a HARD constraint — safety still stops the session",
  input: {
    workout: strengthWorkout(),
    policy: policy({ status: 'paused' }),
    state: snapshot({
      constraints: [
        constraint({}),
        constraint({ code: 'pain_hold_active', hard: true, reason: 'Pain', adjustment: 'Stop' }),
      ],
    }),
  },
  expected: {
    state: 'safety_stop',
    /* The soft constraint is NOT here. Pausing still suppresses everything
       readiness-shaped — only the hard one crosses the gate. */
    reasonCodes: ['pain_hold_active'],
    confidence: 'high',
    autoApplyAllowed: false,
    operationTypes: ['rest_or_pause'],
  },
};
