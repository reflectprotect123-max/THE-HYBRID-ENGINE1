import { DEFAULT_POLICY } from '../../src/index';
import { strengthWorkout, snapshot, constraint, type Fixture } from './helpers';

export const lowReadinessOnly: Fixture = {
  name: 'low_readiness only — advisory, intensity capped',
  input: {
    workout: strengthWorkout(),
    policy: DEFAULT_POLICY,
    state: snapshot({ constraints: [constraint({})] }),
  },
  expected: {
    state: 'advisory',
    reasonCodes: ['low_readiness'],
    confidence: 'high',
    autoApplyAllowed: false,
    operationTypes: ['cap_intensity', 'hold_progression'],
  },
};
