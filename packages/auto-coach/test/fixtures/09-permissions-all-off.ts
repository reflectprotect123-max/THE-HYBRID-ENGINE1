import { strengthWorkout, snapshot, constraint, policy, type Fixture } from './helpers';

export const permissionsAllOff: Fixture = {
  name: "a permission set entirely to 'off' with constraints present — keep_as_planned only",
  input: {
    workout: strengthWorkout(),
    policy: policy({
      permissions: { cap_intensity: 'off', trim_conditioning_minutes: 'off', hold_progression: 'off' },
    }),
    state: snapshot({ constraints: [constraint({})] }),
  },
  expected: {
    state: 'normal',
    reasonCodes: ['no_material_conflict'],
    confidence: 'high',
    autoApplyAllowed: false,
    operationTypes: ['keep_as_planned'],
  },
};
