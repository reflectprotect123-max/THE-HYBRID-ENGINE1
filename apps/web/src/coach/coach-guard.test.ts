import { describe, expect, it } from 'vitest';
import { coachAllowed } from './guard';

describe('coachAllowed', () => {
  it('admits an allowlisted user, dev or prod', () => {
    expect(coachAllowed('u1', 'u1,u2', false)).toBe(true);
    expect(coachAllowed('u2', 'u1, u2', true)).toBe(true);
  });

  it('denies a user missing from a set allowlist, even in dev', () => {
    expect(coachAllowed('intruder', 'u1,u2', true)).toBe(false);
    expect(coachAllowed('intruder', 'u1,u2', false)).toBe(false);
  });

  it('denies signed-out users whenever an allowlist is set', () => {
    expect(coachAllowed(null, 'u1', true)).toBe(false);
    expect(coachAllowed(undefined, 'u1', false)).toBe(false);
  });

  it('fails closed in production when the allowlist is unset or blank', () => {
    expect(coachAllowed('anyone', undefined, false)).toBe(false);
    expect(coachAllowed('anyone', '', false)).toBe(false);
    expect(coachAllowed('anyone', ' , ', false)).toBe(false);
  });

  it('opens in dev only when no allowlist exists', () => {
    expect(coachAllowed(null, undefined, true)).toBe(true);
    expect(coachAllowed('anyone', '', true)).toBe(true);
  });
});
