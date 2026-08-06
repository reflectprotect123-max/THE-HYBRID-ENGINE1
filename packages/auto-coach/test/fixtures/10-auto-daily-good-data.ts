import { strengthWorkout, snapshot, constraint, policy, type Fixture } from './helpers';

export const autoDailyGoodData: Fixture = {
  name: "auto_daily mode with all permissions 'auto' and good data quality — autoApplyAllowed: true",
  input: {
    workout: strengthWorkout(),
    policy: policy({
      mode: 'auto_daily',
      permissions: { cap_intensity: 'auto', trim_conditioning_minutes: 'auto', hold_progression: 'auto' },
    }),
    state: snapshot({ constraints: [constraint({})] }),
  },
  expected: {
    state: 'advisory',
    reasonCodes: ['low_readiness'],
    confidence: 'high',
    autoApplyAllowed: true,
    operationTypes: ['cap_intensity', 'hold_progression'],
  },
};
