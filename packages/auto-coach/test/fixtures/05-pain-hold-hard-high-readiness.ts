import { strengthWorkout, snapshot, constraint, policy, type Fixture } from './helpers';

export const painHoldHardHighReadiness: Fixture = {
  name: 'pain_hold_active (hard) with a high readiness score — safety_stop regardless',
  input: {
    workout: strengthWorkout(),
    policy: policy({
      mode: 'auto_daily',
      permissions: { cap_intensity: 'auto', trim_conditioning_minutes: 'auto', hold_progression: 'auto' },
    }),
    state: snapshot({
      readiness: { score: 95, band: 'high', confidence: 'good', signals: [], rationale: [] },
      constraints: [
        constraint({
          code: 'pain_hold_active',
          hard: true,
          reason: 'Pain hold is active',
          adjustment: 'Stop the affected work',
        }),
      ],
    }),
  },
  expected: {
    state: 'safety_stop',
    reasonCodes: ['pain_hold_active'],
    confidence: 'high',
    autoApplyAllowed: false,
    operationTypes: ['rest_or_pause'],
  },
};
