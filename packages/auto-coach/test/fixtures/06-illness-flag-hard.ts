import { DEFAULT_POLICY } from '../../src/index';
import { mixedCondWorkout, snapshot, constraint, type Fixture } from './helpers';

export const illnessFlagHard: Fixture = {
  name: 'illness_flag_active (hard) — safety_stop',
  input: {
    workout: mixedCondWorkout(),
    policy: DEFAULT_POLICY,
    state: snapshot({
      illness: { status: 'active', source: 'manual' },
      constraints: [
        constraint({
          code: 'illness_flag_active',
          hard: true,
          reason: 'Illness flag',
          adjustment: 'Recover first',
        }),
      ],
    }),
  },
  expected: {
    state: 'safety_stop',
    reasonCodes: ['illness_flag_active'],
    confidence: 'high',
    autoApplyAllowed: false,
    operationTypes: ['rest_or_pause'],
  },
};
