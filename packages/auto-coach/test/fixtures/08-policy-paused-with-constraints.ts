import { strengthWorkout, snapshot, constraint, policy, type Fixture } from './helpers';

export const policyPausedWithConstraints: Fixture = {
  name: "policy status: 'paused' with active constraints present — nothing evaluated",
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
    state: 'normal',
    reasonCodes: ['policy_paused'],
    confidence: 'high',
    autoApplyAllowed: false,
    operationTypes: [],
    abstentionReason: 'policy_not_active',
  },
};
