import { strengthWorkout, snapshot, constraint, policy, type Fixture } from './helpers';

export const autoDailyLimitedData: Fixture = {
  name: "auto_daily mode with all permissions 'auto' but dataQuality: 'limited' — autoApplyAllowed: false",
  input: {
    workout: strengthWorkout(),
    policy: policy({
      mode: 'auto_daily',
      permissions: { cap_intensity: 'auto', trim_conditioning_minutes: 'auto', hold_progression: 'auto' },
    }),
    state: snapshot({ dataQuality: 'limited', constraints: [constraint({})] }),
  },
  expected: {
    state: 'advisory',
    reasonCodes: ['low_readiness'],
    confidence: 'limited',
    autoApplyAllowed: false,
    operationTypes: ['cap_intensity', 'hold_progression'],
  },
};
