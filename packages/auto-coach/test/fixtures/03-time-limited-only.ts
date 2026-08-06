import { DEFAULT_POLICY } from '../../src/index';
import { mixedCondWorkout, snapshot, constraint, type Fixture } from './helpers';

export const timeLimitedOnly: Fixture = {
  name: 'time_limited only — advisory, conditioning trimmed',
  input: {
    workout: mixedCondWorkout(),
    policy: DEFAULT_POLICY,
    state: snapshot({
      constraints: [
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
    reasonCodes: ['time_limited'],
    confidence: 'high',
    autoApplyAllowed: false,
    operationTypes: ['trim_conditioning_minutes'],
  },
};
