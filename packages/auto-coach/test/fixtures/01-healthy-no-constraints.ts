import { DEFAULT_POLICY } from '../../src/index';
import { strengthWorkout, snapshot, type Fixture } from './helpers';

export const healthyNoConstraints: Fixture = {
  name: 'healthy session, no constraints, no policy restrictions',
  input: {
    workout: strengthWorkout(),
    policy: DEFAULT_POLICY,
    state: snapshot({}),
  },
  expected: {
    state: 'normal',
    reasonCodes: ['no_material_conflict'],
    confidence: 'high',
    autoApplyAllowed: false,
    operationTypes: ['keep_as_planned'],
  },
};
