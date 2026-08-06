import { DEFAULT_POLICY } from '../../src/index';
import { strengthWorkout, snapshot, constraint, type Fixture } from './helpers';

export const constraintWrongDomain: Fixture = {
  name: "a constraint scoped to conditioning against a strength workout — no effect",
  input: {
    workout: strengthWorkout(),
    policy: DEFAULT_POLICY,
    state: snapshot({ constraints: [constraint({ domain: 'conditioning' })] }),
  },
  expected: {
    state: 'normal',
    reasonCodes: ['no_material_conflict'],
    confidence: 'high',
    autoApplyAllowed: false,
    operationTypes: ['keep_as_planned'],
  },
};
