import { strengthWorkout, snapshot, policy, type Fixture } from './helpers';

export const missingData: Fixture = {
  name: "missing/dataQuality: 'missing' — normal, insufficient confidence, abstention reason set",
  input: {
    workout: strengthWorkout(),
    policy: policy({
      mode: 'auto_daily',
      permissions: { cap_intensity: 'auto', trim_conditioning_minutes: 'auto', hold_progression: 'auto' },
    }),
    state: snapshot({
      readiness: { score: null, band: 'unknown', confidence: 'missing', signals: [], rationale: [] },
      dataQuality: 'missing',
    }),
  },
  expected: {
    state: 'normal',
    reasonCodes: ['no_material_conflict'],
    confidence: 'insufficient',
    autoApplyAllowed: false,
    operationTypes: ['keep_as_planned'],
    abstentionReason: 'no_signals',
  },
};
