import { DEFAULT_POLICY } from '../../src/index';
import { mixedCondWorkout, snapshot, constraint, type Fixture } from './helpers';

export const lowReadinessAndTimeLimited: Fixture = {
  name: 'low_readiness + time_limited together — both operations present',
  input: {
    workout: mixedCondWorkout(),
    policy: DEFAULT_POLICY,
    state: snapshot({
      constraints: [
        constraint({}),
        constraint({
          code: 'time_limited',
          reason: 'Under 30 minutes today',
          adjustment: 'Minimum viable session',
        }),
      ],
    }),
  },
  expected: {
    state: 'advisory',
    reasonCodes: ['low_readiness', 'time_limited'],
    confidence: 'high',
    autoApplyAllowed: false,
    operationTypes: ['cap_intensity', 'trim_conditioning_minutes', 'hold_progression'],
  },
};
