import { healthyNoConstraints } from './01-healthy-no-constraints';
import { lowReadinessOnly } from './02-low-readiness-only';
import { timeLimitedOnly } from './03-time-limited-only';
import { lowReadinessAndTimeLimited } from './04-low-readiness-and-time-limited';
import { painHoldHardHighReadiness } from './05-pain-hold-hard-high-readiness';
import { illnessFlagHard } from './06-illness-flag-hard';
import { missingData } from './07-missing-data';
import { policyPausedWithConstraints } from './08-policy-paused-with-constraints';
import { permissionsAllOff } from './09-permissions-all-off';
import { autoDailyGoodData } from './10-auto-daily-good-data';
import { autoDailyLimitedData } from './11-auto-daily-limited-data';
import { constraintWrongDomain } from './12-constraint-wrong-domain';
import type { Fixture } from './helpers';

export const fixtures: Fixture[] = [
  healthyNoConstraints,
  lowReadinessOnly,
  timeLimitedOnly,
  lowReadinessAndTimeLimited,
  painHoldHardHighReadiness,
  illnessFlagHard,
  missingData,
  policyPausedWithConstraints,
  permissionsAllOff,
  autoDailyGoodData,
  autoDailyLimitedData,
  constraintWrongDomain,
];

export type { Fixture, FixtureExpectation } from './helpers';
